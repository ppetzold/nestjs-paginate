import { FilterComparator, parseFilter, parseFilterToken, translateLegacyFilterToExpression, TYPEORM_PARAM_REGEX } from './filter'
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

describe('translateLegacyFilterToExpression', () => {
    it('returns undefined for empty filter', () => {
        expect(translateLegacyFilterToExpression({})).toBeUndefined()
    })

    it('translates a single column with no comparator prefix', () => {
        expect(translateLegacyFilterToExpression({ id: '$gt:3' })).toBe('id=$gt:3')
    })

    it('translates a single column with $and: prefix', () => {
        expect(translateLegacyFilterToExpression({ 'toys.name': '$and:Ball' })).toBe('toys.name=Ball')
    })

    it('translates a single column with $or: prefix (single value, no parens needed)', () => {
        expect(translateLegacyFilterToExpression({ id: '$or:$eq:7' })).toBe('id=$eq:7')
    })

    it('translates multiple values with mixed AND/OR within a column', () => {
        const result = translateLegacyFilterToExpression({ id: ['$gt:3', '$and:$lt:5', '$or:$eq:7'] })
        expect(result).toBe('(id=$gt:3 AND id=$lt:5 OR id=$eq:7)')
    })

    it('translates AND-only multiple values without wrapping in parens', () => {
        const result = translateLegacyFilterToExpression({ 'toys.name': ['$and:Ball', '$and:Mouse'] })
        expect(result).toBe('toys.name=Ball AND toys.name=Mouse')
    })

    it('quotes a token value that contains whitespace', () => {
        const result = translateLegacyFilterToExpression({ 'toys.name': ['$and:Fuzzy Thing', '$and:Stuffed Mouse'] })
        expect(result).toBe('toys.name="Fuzzy Thing" AND toys.name="Stuffed Mouse"')
    })

    it('wraps column group in parens when it contains OR', () => {
        const result = translateLegacyFilterToExpression({
            roles: ['$contains:moderator', '$or:$contains:admin'],
        })
        expect(result).toBe('(roles=$contains:moderator OR roles=$contains:admin)')
    })

    it('joins multiple columns with AND', () => {
        const result = translateLegacyFilterToExpression({ id: '$gt:3', name: 'Milo' })
        expect(result).toBe('id=$gt:3 AND name=Milo')
    })

    it('wraps OR column group when combined with other columns', () => {
        const result = translateLegacyFilterToExpression({ id: ['5', '$or:7'], name: 'Milo' })
        expect(result).toBe('(id=5 OR id=7) AND name=Milo')
    })

    it('handles relation AND-mode filters for multiple values', () => {
        const result = translateLegacyFilterToExpression({
            'toys.name': ['$and:Ball', '$and:Mouse'],
        })
        expect(result).toBe('toys.name=Ball AND toys.name=Mouse')
    })

    it('OR-mode single-value columns from different columns are merged into one OR group', () => {
        const result = translateLegacyFilterToExpression({ name: '$or:Milo', color: '$or:white', age: '$btw:1,10' })
        expect(result).toBe('(name=Milo OR color=white) AND age=$btw:1,10')
    })

    it('all OR-mode columns merge into a flat OR expression without AND', () => {
        const result = translateLegacyFilterToExpression({
            name: ['$or:Milo', '$or:Garfield'],
            color: ['$or:brown', '$or:white'],
        })
        expect(result).toBe('name=Milo OR name=Garfield OR color=brown OR color=white')
    })

    it('OR group followed by AND terms produces correctly grouped expression', () => {
        const result = translateLegacyFilterToExpression({
            name: ['$or:Milo', '$or:Garfield'],
            age: '$or:$null',
            color: ['brown', '$or:white'],
            cutenessLevel: ['high', '$or:low'],
        })
        expect(result).toBe('(name=Milo OR name=Garfield OR age=$null) AND (color=brown OR color=white) AND (cutenessLevel=high OR cutenessLevel=low)')
    })
})
