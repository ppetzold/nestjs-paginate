import { FilterComparator, parseFilter, parseFilterToken, TYPEORM_PARAM_REGEX } from './filter'
import { isISODate } from './helper'

function createQueryBuilderMock(columns: Array<{ propertyName: string; type: unknown }>): any {
    return {
        expressionMap: {
            mainAlias: {
                metadata: {
                    columns,
                    relations: [],
                    findColumnWithPropertyPath: () => undefined,
                    findColumnWithPropertyName: (propertyName: string) =>
                        columns.find((column) => column.propertyName === propertyName),
                },
            },
        },
    }
}

describe('parseFilter', () => {
    it('casts $in values to numbers for numeric columns', () => {
        const qb = createQueryBuilderMock([{ propertyName: 'age', type: Number }])

        const result = parseFilter(
            { path: '', filter: { age: '$in:1, 2,3' } },
            {
                age: true,
            },
            qb
        )

        expect((result.age[0].findOperator as any).value).toEqual([1, 2, 3])
    })
})

describe('isISODate', () => {
    it('returns false when a valid ISO date is only part of the input', () => {
        expect(isISODate('prefix 2024-01-01T12:30:45Z suffix')).toBe(false)
    })
})

describe('parseFilterToken', () => {
    it('parses a plain value with default AND comparator', () => {
        const token = parseFilterToken('Ball')
        expect(token).not.toBeNull()
        expect(token!.comparator).toBe(FilterComparator.AND)
        expect(token!.value).toBe('Ball')
    })
})

describe('parameter rename regex (TYPEORM_PARAM_REGEX)', () => {
    // Helper that applies the module-level regex (must reset lastIndex before each use).
    const rename = (s: string, suffix: string) => {
        TYPEORM_PARAM_REGEX.lastIndex = 0
        return s.replace(TYPEORM_PARAM_REGEX, (_, spread, name) => `:${spread ?? ''}${name}${suffix}`)
    }

    it('renames a simple named parameter', () => {
        expect(rename(':name_1', '_e0')).toBe(':name_1_e0')
    })

    it('renames multiple parameters in one string', () => {
        expect(rename(':foo = :bar', '_e1')).toBe(':foo_e1 = :bar_e1')
    })

    it('does not rename PostgreSQL :: cast syntax', () => {
        expect(rename('col::text = :value', '_e0')).toBe('col::text = :value_e0')
    })

    it('does not rename :: in the middle of an expression', () => {
        expect(rename(':param::integer > 0', '_e0')).toBe(':param_e0::integer > 0')
    })

    it('renames embedded-path parameters (containing dots)', () => {
        expect(rename(':size.height0', '_e0')).toBe(':size.height0_e0')
    })

    it('renames :...spread parameters (used by $in)', () => {
        expect(rename(':...vals', '_e0')).toBe(':...vals_e0')
    })

    it('renames :...spread alongside a cast', () => {
        expect(rename('col IN (:...vals) AND col2::text = :other', '_e1')).toBe(
            'col IN (:...vals_e1) AND col2::text = :other_e1'
        )
    })

    it('handles jsonb cast: :param::jsonb is renamed correctly', () => {
        expect(rename('col @> :json::jsonb', '_e0')).toBe('col @> :json_e0::jsonb')
    })
})
