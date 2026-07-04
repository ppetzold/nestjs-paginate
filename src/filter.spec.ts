import {
    FilterComparator,
    FilterOperator,
    FilterQuantifier,
    hasExplicitAndComparator,
    parseFilter,
    parseFilterToken,
    TYPEORM_PARAM_REGEX,
} from './filter'
import {
    isBooleanColumnType,
    isDateOnlyColumnType,
    isFiniteNumericString,
    isISODate,
    isISODateOnly,
    isNumberColumnType,
    parseBooleanToken,
} from './helper'

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

describe('parseFilter value coercion (type classifier)', () => {
    // Drives a single-column filter through parseFilter and returns the coerced FindOperator
    // value, i.e. exactly what gets bound as the query parameter. Asserting the JavaScript type
    // here is what guarantees correct behaviour on type-strict drivers (better-sqlite3), where a
    // string bound against a number/boolean/date column never matches.
    const coerce = (type: unknown, filter: string, column = 'x') => {
        const qb = createQueryBuilderMock([{ propertyName: column, type }])
        const result = parseFilter({ path: '', filter: { [column]: filter } }, { [column]: true }, qb)
        return (result[column]?.[0]?.findOperator as any)?.value
    }

    describe('numbers', () => {
        it.each([
            ['Number ctor', Number],
            ['int', 'int'],
            ['integer', 'integer'],
            ['smallint', 'smallint'],
            ['float8 (double)', 'float8'],
            ['real', 'real'],
        ])('coerces to a JS number for %s columns', (_label, type) => {
            expect(coerce(type, '$eq:42')).toBe(42)
        })

        it('keeps bigint values as strings to preserve precision', () => {
            // 9007199254740993 = 2^53 + 1, unrepresentable as a JS double.
            expect(coerce('bigint', '$eq:9007199254740993')).toBe('9007199254740993')
        })

        it('keeps decimal/numeric values as strings to preserve precision', () => {
            expect(coerce('decimal', '$gt:5.50')).toBe('5.50')
            expect(coerce('numeric', '$eq:1.10')).toBe('1.10')
        })

        it('does not coerce a non-numeric value on a numeric column', () => {
            expect(coerce('int', '$eq:abc')).toBe('abc')
        })

        it('does not coerce an empty value to 0 on a numeric column', () => {
            expect(coerce('int', '$eq:')).toBe('')
        })

        it('does not coerce a numeric-looking value on a string column', () => {
            expect(coerce('varchar', '$eq:007')).toBe('007')
        })
    })

    describe('booleans', () => {
        it.each([
            ['true', true],
            ['false', false],
            ['1', true],
            ['0', false],
            ['TRUE', true],
        ])('coerces "%s" to %s for boolean columns', (token, expected) => {
            expect(coerce('boolean', `$eq:${token}`)).toBe(expected)
        })

        it('coerces for the Boolean ctor type', () => {
            expect(coerce(Boolean, '$eq:true')).toBe(true)
        })

        it('leaves a non-boolean token as a string', () => {
            expect(coerce('boolean', '$eq:yes')).toBe('yes')
        })

        it('does not coerce true/false on a string column', () => {
            expect(coerce('varchar', '$eq:true')).toBe('true')
        })
    })

    describe('dates', () => {
        it('coerces a full ISO timestamp on a timestamp column', () => {
            const value = coerce('timestamp', '$eq:2024-01-02T03:04:05Z')
            expect(value).toBeInstanceOf(Date)
            expect((value as Date).toISOString()).toBe('2024-01-02T03:04:05.000Z')
        })

        it('coerces a date-only value on a date column', () => {
            const value = coerce('date', '$eq:2024-01-02')
            expect(value).toBeInstanceOf(Date)
        })

        it('coerces both bounds of a $btw range on a date column', () => {
            const qb = createQueryBuilderMock([{ propertyName: 'd', type: 'date' }])
            const result = parseFilter({ path: '', filter: { d: '$btw:2024-01-01,2024-12-31' } }, { d: true }, qb)
            const [from, to] = (result.d[0].findOperator as any).value
            expect(from).toBeInstanceOf(Date)
            expect(to).toBeInstanceOf(Date)
        })

        it('does not coerce a date-only value on a non-temporal column', () => {
            expect(coerce('varchar', '$eq:2024-01-02')).toBe('2024-01-02')
        })
    })
})

describe('column type predicates', () => {
    it('isNumberColumnType recognises double-safe numeric types only', () => {
        expect(isNumberColumnType(Number)).toBe(true)
        expect(isNumberColumnType('int')).toBe(true)
        expect(isNumberColumnType('float8')).toBe(true)
        expect(isNumberColumnType('bigint')).toBe(false)
        expect(isNumberColumnType('int8')).toBe(false)
        expect(isNumberColumnType('decimal')).toBe(false)
        expect(isNumberColumnType('numeric')).toBe(false)
        expect(isNumberColumnType('varchar')).toBe(false)
    })

    it('isBooleanColumnType recognises boolean types', () => {
        expect(isBooleanColumnType(Boolean)).toBe(true)
        expect(isBooleanColumnType('boolean')).toBe(true)
        expect(isBooleanColumnType('bool')).toBe(true)
        expect(isBooleanColumnType('BOOLEAN')).toBe(true)
        expect(isBooleanColumnType('int')).toBe(false)
    })

    it('isDateOnlyColumnType recognises only the date-only type', () => {
        expect(isDateOnlyColumnType('date')).toBe(true)
        expect(isDateOnlyColumnType('timestamp')).toBe(false)
        expect(isDateOnlyColumnType(Date)).toBe(false)
    })
})

describe('value token predicates', () => {
    it('isFiniteNumericString accepts finite numbers and rejects blanks/garbage', () => {
        expect(isFiniteNumericString('5')).toBe(true)
        expect(isFiniteNumericString('-3.14')).toBe(true)
        expect(isFiniteNumericString('1e3')).toBe(true)
        expect(isFiniteNumericString('')).toBe(false)
        expect(isFiniteNumericString('   ')).toBe(false)
        expect(isFiniteNumericString('abc')).toBe(false)
        expect(isFiniteNumericString('Infinity')).toBe(false)
    })

    it('parseBooleanToken parses the closed token set case-insensitively', () => {
        expect(parseBooleanToken('true')).toBe(true)
        expect(parseBooleanToken('TRUE')).toBe(true)
        expect(parseBooleanToken('1')).toBe(true)
        expect(parseBooleanToken('false')).toBe(false)
        expect(parseBooleanToken('0')).toBe(false)
        expect(parseBooleanToken('yes')).toBeUndefined()
        expect(parseBooleanToken('')).toBeUndefined()
    })

    it('isISODateOnly matches YYYY-MM-DD only', () => {
        expect(isISODateOnly('2024-01-02')).toBe(true)
        expect(isISODateOnly('2024-1-2')).toBe(false)
        expect(isISODateOnly('2024-01-02T00:00:00Z')).toBe(false)
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
