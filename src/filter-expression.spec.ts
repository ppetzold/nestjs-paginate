import { parseFilterExpression, normalizeFilterExpression } from './filter-expression'

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

    it('allows a boolean keyword as a literal value when quoted', () => {
        expect(parseFilterExpression('name=$eq:"a AND b"')).toEqual({
            type: 'leaf',
            column: 'name',
            value: '$eq:a AND b',
        })
    })

    describe('errors', () => {
        it.each([
            ['', 'Empty filter expression'],
            ['name=$eq:"unterminated', 'Unterminated quote'],
            ['(a=$eq:1', 'Expected ")"'],
            ['justacolumn', 'expected "column=value"'],
            ['a=$eq:1 AND', 'Unexpected end'],
            ['a=$eq:1 b=$eq:2', 'trailing tokens'],
        ])('rejects %p', (input, message) => {
            expect(() => parseFilterExpression(input)).toThrow(message)
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
})
