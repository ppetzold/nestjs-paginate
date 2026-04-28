import {
    FilterComparator,
    FilterOperator,
    FilterQuantifier,
    hasExplicitAndComparator,
    parseFilter,
    parseFilterToken,
    TYPEORM_PARAM_REGEX,
} from './filter'
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

    it('parses $and comparator explicitly', () => {
        const token = parseFilterToken('$and:Ball')
        expect(token).not.toBeNull()
        expect(token!.comparator).toBe(FilterComparator.AND)
        expect(token!.value).toBe('Ball')
    })

    it('parses $and with an explicit operator', () => {
        const token = parseFilterToken('$and:$eq:Ball')
        expect(token).not.toBeNull()
        expect(token!.comparator).toBe(FilterComparator.AND)
        expect(token!.operator).toBe(FilterOperator.EQ)
        expect(token!.value).toBe('Ball')
    })

    it('parses $and combined with a quantifier', () => {
        const token = parseFilterToken('$none:$and:$eq:Ball')
        expect(token).not.toBeNull()
        expect(token!.quantifier).toBe(FilterQuantifier.NONE)
        expect(token!.comparator).toBe(FilterComparator.AND)
        expect(token!.value).toBe('Ball')
    })
})

describe('parseFilter $and gating', () => {
    const qb = {
        expressionMap: {
            mainAlias: {
                metadata: {
                    columns: [{ propertyName: 'name', type: String }],
                    relations: [],
                    findColumnWithPropertyPath: () => undefined,
                    findColumnWithPropertyName: (p: string) =>
                        p === 'name' ? { propertyName: 'name', type: String } : undefined,
                },
            },
        },
    } as any

    it('allows $and when FilterComparator.AND is in filterableColumns', () => {
        const result = parseFilter(
            { path: '', filter: { name: '$and:Ball' } },
            { name: [FilterOperator.EQ, FilterComparator.AND] },
            qb
        )
        expect(result.name).toBeDefined()
        expect(result.name.length).toBe(1)
    })

    it('blocks $and when FilterComparator.AND is not in filterableColumns', () => {
        const result = parseFilter({ path: '', filter: { name: '$and:Ball' } }, { name: [FilterOperator.EQ] }, qb)
        // The $and token should be filtered out
        expect(!result.name || result.name.length === 0).toBe(true)
    })

    it('allows a plain filter (no explicit $and) even without FilterComparator.AND in filterableColumns', () => {
        const result = parseFilter({ path: '', filter: { name: 'Ball' } }, { name: [FilterOperator.EQ] }, qb)
        expect(result.name).toBeDefined()
        expect(result.name.length).toBe(1)
    })

    it('allows $and when filterableColumns is true (all allowed)', () => {
        const result = parseFilter({ path: '', filter: { name: '$and:Ball' } }, { name: true }, qb)
        expect(result.name).toBeDefined()
        expect(result.name.length).toBe(1)
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

describe('hasExplicitAndComparator', () => {
    it('returns true for $and:Ball', () => {
        expect(hasExplicitAndComparator('$and:Ball')).toBe(true)
    })

    it('returns true for $and:$eq:Ball', () => {
        expect(hasExplicitAndComparator('$and:$eq:Ball')).toBe(true)
    })

    it('returns true for $none:$and:Ball', () => {
        expect(hasExplicitAndComparator('$none:$and:Ball')).toBe(true)
    })

    it('returns false for a plain value (no $and prefix)', () => {
        expect(hasExplicitAndComparator('Ball')).toBe(false)
    })

    it('returns false for $eq:Ball (default AND comparator, not explicit)', () => {
        expect(hasExplicitAndComparator('$eq:Ball')).toBe(false)
    })

    it('returns false for $eq:$and (value is the literal string $and, not the comparator)', () => {
        // parseFilterToken sees $eq as operator, value = '$and' — comparator stays default AND
        // but $and is NOT in the consumed prefix as a comparator token.
        expect(hasExplicitAndComparator('$eq:$and')).toBe(false)
    })

    it('returns true for bare $and (no value after colon — user explicitly wrote $and)', () => {
        // parseFilterToken: $and is consumed as comparator, value = undefined.
        // hasExplicitAndComparator should still return true (the user wrote $and explicitly).
        expect(hasExplicitAndComparator('$and')).toBe(true)
    })
})
