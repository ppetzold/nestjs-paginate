import { BadRequestException } from '@nestjs/common'

/**
 * Boolean filter expression parsed from a single `filter=` query parameter.
 *
 * Grammar (precedence: NOT > AND > OR), case-insensitive keywords:
 *   expr    := or
 *   or      := and (OR and)*
 *   and     := not (AND not)*
 *   not     := NOT not | primary
 *   primary := '(' expr ')' | leaf
 *   leaf    := column '=' value          // value uses the existing $op:operand syntax
 *
 * Tokens are whitespace-delimited; `(` and `)` are punctuation. A value containing
 * whitespace or a `(` `)` must be quoted with `"` or `'`.
 */
export type FilterExpression =
    | { type: 'and'; children: FilterExpression[] }
    | { type: 'or'; children: FilterExpression[] }
    | { type: 'not'; child: FilterExpression }
    | { type: 'leaf'; column: string; value: string }

/**
 * Default cap on the number of nodes (leaves, AND/OR/NOT operators, and parenthesised
 * groups) a single `filter=` expression may contain. Because the parser is recursive, an
 * unbounded expression is a denial-of-service vector: a deeply nested or very wide payload
 * can exhaust the call stack or blow up the generated SQL. 100 nodes comfortably covers any
 * realistic query while keeping the parse cheap. Override per-endpoint via
 * `PaginateConfig.filterExpressionMaxComplexity`.
 */
export const DEFAULT_FILTER_EXPRESSION_MAX_COMPLEXITY = 100

/** Filter expression with negation pushed onto the leaves, so only AND/OR groups remain. */
export type NormalizedFilterExpression =
    | { type: 'and'; children: NormalizedFilterExpression[] }
    | { type: 'or'; children: NormalizedFilterExpression[] }
    | { type: 'leaf'; column: string; value: string; negated: boolean }

type Token =
    | { type: 'lparen' }
    | { type: 'rparen' }
    | { type: 'and' }
    | { type: 'or' }
    | { type: 'not' }
    | { type: 'leaf'; raw: string }

const WHITESPACE = new Set([' ', '\t', '\n', '\r'])

function tokenize(input: string): Token[] {
    const tokens: Token[] = []
    let i = 0
    while (i < input.length) {
        const c = input[i]
        if (WHITESPACE.has(c)) {
            i++
            continue
        }
        if (c === '(') {
            tokens.push({ type: 'lparen' })
            i++
            continue
        }
        if (c === ')') {
            tokens.push({ type: 'rparen' })
            i++
            continue
        }

        let raw = ''
        let quoted = false
        while (i < input.length) {
            const ch = input[i]
            if (WHITESPACE.has(ch) || ch === '(' || ch === ')') break
            if (ch === '"' || ch === "'") {
                quoted = true
                i++
                while (i < input.length && input[i] !== ch) {
                    raw += input[i]
                    i++
                }
                if (i >= input.length) {
                    throw new BadRequestException('Unterminated quote in filter expression')
                }
                i++
                continue
            }
            raw += ch
            i++
        }

        if (!quoted) {
            const keyword = raw.toUpperCase()
            if (keyword === 'AND' || keyword === 'OR' || keyword === 'NOT') {
                tokens.push({ type: keyword.toLowerCase() as 'and' | 'or' | 'not' })
                continue
            }
        }
        tokens.push({ type: 'leaf', raw })
    }
    return tokens
}

function parse(tokens: Token[], maxComplexity: number): FilterExpression {
    let pos = 0
    const peek = () => tokens[pos]

    // Every leaf, AND/OR/NOT operator, and parenthesised descent counts as one unit of
    // complexity. Tallied as the tree is built and checked eagerly, so a hostile payload is
    // rejected before it can nest deep enough to overflow the recursion stack.
    let complexity = 0
    const spend = () => {
        if (++complexity > maxComplexity) {
            throw new BadRequestException(`Filter expression is too complex (max ${maxComplexity} nodes)`)
        }
    }

    function parseOr(): FilterExpression {
        const children = [parseAnd()]
        while (peek()?.type === 'or') {
            pos++
            spend()
            children.push(parseAnd())
        }
        return children.length === 1 ? children[0] : { type: 'or', children }
    }

    function parseAnd(): FilterExpression {
        const children = [parseNot()]
        while (peek()?.type === 'and') {
            pos++
            spend()
            children.push(parseNot())
        }
        return children.length === 1 ? children[0] : { type: 'and', children }
    }

    function parseNot(): FilterExpression {
        if (peek()?.type === 'not') {
            pos++
            spend()
            return { type: 'not', child: parseNot() }
        }
        return parsePrimary()
    }

    function parsePrimary(): FilterExpression {
        const token = peek()
        if (!token) {
            throw new BadRequestException('Unexpected end of filter expression')
        }
        if (token.type === 'lparen') {
            pos++
            spend()
            const expr = parseOr()
            if (peek()?.type !== 'rparen') {
                throw new BadRequestException('Expected ")" in filter expression')
            }
            pos++
            return expr
        }
        if (token.type === 'leaf') {
            pos++
            spend()
            const eq = token.raw.indexOf('=')
            if (eq < 1) {
                throw new BadRequestException(`Invalid filter expression term "${token.raw}", expected "column=value"`)
            }
            return { type: 'leaf', column: token.raw.slice(0, eq), value: token.raw.slice(eq + 1) }
        }
        throw new BadRequestException(`Unexpected "${token.type}" in filter expression`)
    }

    if (tokens.length === 0) {
        throw new BadRequestException('Empty filter expression')
    }
    const expr = parseOr()
    if (pos < tokens.length) {
        throw new BadRequestException('Unexpected trailing tokens in filter expression')
    }
    return expr
}

export function parseFilterExpression(
    input: string,
    maxComplexity: number = DEFAULT_FILTER_EXPRESSION_MAX_COMPLEXITY
): FilterExpression {
    return parse(tokenize(input), maxComplexity)
}

/** Pushes every NOT down onto the leaves via De Morgan, leaving only AND/OR groups. */
export function normalizeFilterExpression(node: FilterExpression, negated = false): NormalizedFilterExpression {
    switch (node.type) {
        case 'leaf':
            return { type: 'leaf', column: node.column, value: node.value, negated }
        case 'not':
            return normalizeFilterExpression(node.child, !negated)
        case 'and':
            return {
                type: negated ? 'or' : 'and',
                children: node.children.map((child) => normalizeFilterExpression(child, negated)),
            }
        case 'or':
            return {
                type: negated ? 'and' : 'or',
                children: node.children.map((child) => normalizeFilterExpression(child, negated)),
            }
    }
}
