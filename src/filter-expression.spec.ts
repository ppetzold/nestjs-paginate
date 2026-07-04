import {
    parseFilterExpression,
    normalizeFilterExpression,
    DEFAULT_FILTER_EXPRESSION_MAX_COMPLEXITY,
} from './filter-expression'

describe('parseFilterExpression', () => {
    it('parses a single leaf', () => {
        expect(parseFilterExpression('name=$eq:Milo')).toEqual({
            type: 'leaf',
            column: 'name',
            value: '$eq:Milo',
        })
    })

    it('keeps the value untouched (operators, suffixes, lists, dotted columns)', () => {
        expect(parseFilterExpression('home.config.theme=$not:$in:a,b,c')).toEqual({
            type: 'leaf',
            column: 'home.config.theme',
            value: '$not:$in:a,b,c',
        })
    })

    it('parses AND/OR with correct precedence (AND binds tighter than OR)', () => {
        expect(parseFilterExpression('a=$eq:1 AND b=$eq:2 OR c=$eq:3')).toEqual({
            type: 'or',
            children: [
                {
                    type: 'and',
                    children: [
                        { type: 'leaf', column: 'a', value: '$eq:1' },
                        { type: 'leaf', column: 'b', value: '$eq:2' },
                    ],
                },
                { type: 'leaf', column: 'c', value: '$eq:3' },
            ],
        })
    })

    it('respects parentheses over precedence', () => {
        expect(parseFilterExpression('(a=$eq:1 OR b=$eq:2) AND c=$eq:3')).toEqual({
            type: 'and',
            children: [
                {
                    type: 'or',
                    children: [
                        { type: 'leaf', column: 'a', value: '$eq:1' },
                        { type: 'leaf', column: 'b', value: '$eq:2' },
                    ],
                },
                { type: 'leaf', column: 'c', value: '$eq:3' },
            ],
        })
    })

    it('keywords are case-insensitive', () => {
        expect(parseFilterExpression('a=$eq:1 and b=$eq:2')).toEqual(parseFilterExpression('a=$eq:1 AND b=$eq:2'))
    })

    it('parses NOT', () => {
        expect(parseFilterExpression('NOT name=$eq:Leche')).toEqual({
            type: 'not',
            child: { type: 'leaf', column: 'name', value: '$eq:Leche' },
        })
    })

    it('handles parens adjacent to leaves', () => {
        expect(parseFilterExpression('(b=$eq:4 AND a.c=$lt:7)')).toEqual({
            type: 'and',
            children: [
                { type: 'leaf', column: 'b', value: '$eq:4' },
                { type: 'leaf', column: 'a.c', value: '$lt:7' },
            ],
        })
    })

    it('allows spaces inside a quoted value', () => {
        expect(parseFilterExpression('home.name=$eq:"Cat Mansion" AND name=$eq:Milo')).toEqual({
            type: 'and',
            children: [
                { type: 'leaf', column: 'home.name', value: '$eq:Cat Mansion' },
                { type: 'leaf', column: 'name', value: '$eq:Milo' },
            ],
        })
    })

    it('accepts single quotes as well as double quotes', () => {
        expect(parseFilterExpression("home.name=$eq:'Cat Mansion'")).toEqual({
            type: 'leaf',
            column: 'home.name',
            value: '$eq:Cat Mansion',
        })
    })

    it('concatenates quoted and unquoted spans within one token', () => {
        // `foo" bar"baz` -> the quoted span only protects its own whitespace.
        expect(parseFilterExpression('name=$eq:foo" bar"baz')).toEqual({
            type: 'leaf',
            column: 'name',
            value: '$eq:foo barbaz',
        })
    })

    it('allows a boolean keyword as a literal value when quoted', () => {
        expect(parseFilterExpression('name=$eq:"a AND b"')).toEqual({
            type: 'leaf',
            column: 'name',
            value: '$eq:a AND b',
        })
    })

    it('splits a leaf on the first "=" only, keeping later "=" in the value', () => {
        expect(parseFilterExpression('name=$eq:a=b')).toEqual({
            type: 'leaf',
            column: 'name',
            value: '$eq:a=b',
        })
    })

    it('allows an empty value after "="', () => {
        expect(parseFilterExpression('name=')).toEqual({ type: 'leaf', column: 'name', value: '' })
    })

    it('binds NOT tighter than AND (NOT a AND b -> (NOT a) AND b)', () => {
        expect(parseFilterExpression('NOT a=$eq:1 AND b=$eq:2')).toEqual({
            type: 'and',
            children: [
                { type: 'not', child: { type: 'leaf', column: 'a', value: '$eq:1' } },
                { type: 'leaf', column: 'b', value: '$eq:2' },
            ],
        })
    })

    it('parses NOT applied to a parenthesised group', () => {
        expect(parseFilterExpression('NOT (a=$eq:1 OR b=$eq:2)')).toEqual({
            type: 'not',
            child: {
                type: 'or',
                children: [
                    { type: 'leaf', column: 'a', value: '$eq:1' },
                    { type: 'leaf', column: 'b', value: '$eq:2' },
                ],
            },
        })
    })

    it('flattens redundant nested parentheses', () => {
        expect(parseFilterExpression('((a=$eq:1 OR b=$eq:2) AND c=$eq:3)')).toEqual({
            type: 'and',
            children: [
                {
                    type: 'or',
                    children: [
                        { type: 'leaf', column: 'a', value: '$eq:1' },
                        { type: 'leaf', column: 'b', value: '$eq:2' },
                    ],
                },
                { type: 'leaf', column: 'c', value: '$eq:3' },
            ],
        })
    })

    it('treats tabs and newlines as token separators', () => {
        expect(parseFilterExpression('a=$eq:1\tAND\nb=$eq:2')).toEqual(parseFilterExpression('a=$eq:1 AND b=$eq:2'))
    })

    it('keeps an operator/suffix/quantifier chain in the value untouched', () => {
        expect(parseFilterExpression('toys.name=$none:$not:$eq:String')).toEqual({
            type: 'leaf',
            column: 'toys.name',
            value: '$none:$not:$eq:String',
        })
    })

    describe('errors', () => {
        it.each([
            ['', 'Empty filter expression'],
            ['   ', 'Empty filter expression'],
            ['name=$eq:"unterminated', 'Unterminated quote'],
            ["name=$eq:'unterminated", 'Unterminated quote'],
            ['(a=$eq:1', 'Expected ")"'],
            ['justacolumn', 'expected "column=value"'],
            ['=novalue', 'expected "column=value"'],
            ['a=$eq:1 AND', 'Unexpected end'],
            ['NOT', 'Unexpected end'],
            ['a=$eq:1 b=$eq:2', 'trailing tokens'],
            ['a=$eq:1)', 'trailing tokens'],
            ['OR a=$eq:1', 'Unexpected "or"'],
            [')', 'Unexpected "rparen"'],
            ['()', 'Unexpected "rparen"'],
            ['a=$eq:1 AND AND b=$eq:2', 'Unexpected "and"'],
        ])('rejects %p', (input, message) => {
            expect(() => parseFilterExpression(input)).toThrow(message)
        })
    })

    describe('complexity guard', () => {
        // Each leaf plus each AND joining them is one node: N leaves ANDed together = 2N-1 nodes.
        const chain = (leaves: number) =>
            Array.from({ length: leaves }, (_, i) => `c${i}=$eq:${i}`).join(' AND ')

        it('accepts an expression exactly at the limit', () => {
            // 3 nodes: leaf AND leaf.
            expect(() => parseFilterExpression(chain(2), 3)).not.toThrow()
        })

        it('rejects an expression one node over the limit', () => {
            // 3 nodes exceeds a limit of 2.
            expect(() => parseFilterExpression(chain(2), 2)).toThrow('too complex (max 2 nodes)')
        })

        it('counts NOT operators toward complexity', () => {
            expect(() => parseFilterExpression('NOT NOT a=$eq:1', 2)).toThrow('too complex')
        })

        it('counts parenthesised groups toward complexity, catching deep nesting', () => {
            // Nested parens create no extra leaves but still consume the recursion stack, so
            // each descent must be charged: `(((a=$eq:1)))` is 3 groups + 1 leaf = 4 nodes.
            expect(() => parseFilterExpression('(((a=$eq:1)))', 3)).toThrow('too complex')
        })

        it('is bounded by a safe default when no limit is supplied', () => {
            const overDefault = chain(DEFAULT_FILTER_EXPRESSION_MAX_COMPLEXITY)
            expect(() => parseFilterExpression(overDefault)).toThrow('too complex')
        })
    })
})

describe('normalizeFilterExpression', () => {
    const leaf = (column: string, value: string, negated = false) => ({ type: 'leaf', column, value, negated })

    it('marks a bare leaf as not negated', () => {
        expect(normalizeFilterExpression(parseFilterExpression('a=$eq:1'))).toEqual(leaf('a', '$eq:1'))
    })

    it('pushes a single NOT onto the leaf', () => {
        expect(normalizeFilterExpression(parseFilterExpression('NOT a=$eq:1'))).toEqual(leaf('a', '$eq:1', true))
    })

    it('collapses double negation', () => {
        expect(normalizeFilterExpression(parseFilterExpression('NOT NOT a=$eq:1'))).toEqual(leaf('a', '$eq:1', false))
    })

    it('applies De Morgan to NOT (a AND b) -> (NOT a) OR (NOT b)', () => {
        expect(normalizeFilterExpression(parseFilterExpression('NOT (a=$eq:1 AND b=$eq:2)'))).toEqual({
            type: 'or',
            children: [leaf('a', '$eq:1', true), leaf('b', '$eq:2', true)],
        })
    })

    it('applies De Morgan to NOT (a OR b) -> (NOT a) AND (NOT b)', () => {
        expect(normalizeFilterExpression(parseFilterExpression('NOT (a=$eq:1 OR b=$eq:2)'))).toEqual({
            type: 'and',
            children: [leaf('a', '$eq:1', true), leaf('b', '$eq:2', true)],
        })
    })

    it('preserves all children when applying De Morgan to a 3-way group', () => {
        expect(normalizeFilterExpression(parseFilterExpression('NOT (a=$eq:1 AND b=$eq:2 AND c=$eq:3)'))).toEqual({
            type: 'or',
            children: [leaf('a', '$eq:1', true), leaf('b', '$eq:2', true), leaf('c', '$eq:3', true)],
        })
    })

    it('recurses De Morgan through a nested mixed group', () => {
        // NOT (a AND (b OR c)) -> (NOT a) OR ((NOT b) AND (NOT c))
        expect(normalizeFilterExpression(parseFilterExpression('NOT (a=$eq:1 AND (b=$eq:2 OR c=$eq:3))'))).toEqual({
            type: 'or',
            children: [
                leaf('a', '$eq:1', true),
                { type: 'and', children: [leaf('b', '$eq:2', true), leaf('c', '$eq:3', true)] },
            ],
        })
    })

    it('collapses a double negation wrapping a group', () => {
        expect(normalizeFilterExpression(parseFilterExpression('NOT NOT (a=$eq:1 OR b=$eq:2)'))).toEqual(
            normalizeFilterExpression(parseFilterExpression('a=$eq:1 OR b=$eq:2'))
        )
    })

    it('marks the leaf negated without touching a value-level $not suffix', () => {
        expect(normalizeFilterExpression(parseFilterExpression('NOT color=$not:$eq:white'))).toEqual(
            leaf('color', '$not:$eq:white', true)
        )
    })
})
