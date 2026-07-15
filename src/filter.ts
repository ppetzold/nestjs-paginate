import { BadRequestException } from '@nestjs/common'
import { values } from 'lodash'
import {
    ArrayContains,
    Between,
    Brackets,
    EntityMetadata,
    Equal,
    FindOperator,
    ILike,
    In,
    IsNull,
    JsonContains,
    LessThan,
    LessThanOrEqual,
    MoreThan,
    MoreThanOrEqual,
    Not,
    SelectQueryBuilder,
} from 'typeorm'
import { WherePredicateOperator } from 'typeorm/query-builder/WhereClause'
import { PaginateQuery } from './decorator'
import { normalizeFilterExpression, NormalizedFilterExpression, parseFilterExpression } from './filter-expression'
import {
    andWhereAllExist,
    andWhereNoneExist,
    checkIsArray,
    checkIsEmbedded,
    checkIsRelation,
    createRelationSchema,
    extractVirtualProperty,
    fixColumnAlias,
    getPropertiesByColumnName,
    isDateColumnType,
    isISODate,
    JoinMethod,
    JSON_COLUMN_TYPES,
    mergeRelationSchema,
    quoteColumn,
    resolveJsonbPath,
} from './helper'
import { EmbeddedMetadata } from 'typeorm/metadata/EmbeddedMetadata'
import { RelationMetadata } from 'typeorm/metadata/RelationMetadata'
import { addRelationsFromSchema } from './paginate'

export enum FilterOperator {
    EQ = '$eq',
    GT = '$gt',
    GTE = '$gte',
    IN = '$in',
    NULL = '$null',
    LT = '$lt',
    LTE = '$lte',
    BTW = '$btw',
    ILIKE = '$ilike',
    SW = '$sw',
    CONTAINS = '$contains',
}

export function isOperator(value: unknown): value is FilterOperator {
    return values(FilterOperator).includes(value as any)
}

export enum FilterSuffix {
    // Used to negate a filter
    NOT = '$not',
}

export function isSuffix(value: unknown): value is FilterSuffix {
    return values(FilterSuffix).includes(value as any)
}

export enum FilterQuantifier {
    ALL = '$all',
    ANY = '$any',
    NONE = '$none',
}

export function isQuantifier(value: unknown): value is FilterQuantifier {
    return values(FilterQuantifier).includes(value as any)
}

/** Internal: how a built `Filter` combines with the previous one (JSONB `$in` ORs its terms). */
export enum FilterComparator {
    AND = '$and',
    OR = '$or',
}

export const OperatorSymbolToFunction = new Map<
    FilterOperator | FilterSuffix,
    (...args: any[]) => FindOperator<string>
>([
    [FilterOperator.EQ, Equal],
    [FilterOperator.GT, MoreThan],
    [FilterOperator.GTE, MoreThanOrEqual],
    [FilterOperator.IN, In],
    [FilterOperator.NULL, IsNull],
    [FilterOperator.LT, LessThan],
    [FilterOperator.LTE, LessThanOrEqual],
    [FilterOperator.BTW, Between],
    [FilterOperator.ILIKE, ILike],
    [FilterSuffix.NOT, Not],
    [FilterOperator.SW, ILike],
    [FilterOperator.CONTAINS, ArrayContains],
])

type Filter = { quantifier: FilterQuantifier; comparator: FilterComparator; findOperator: FindOperator<string> }
type ColumnFilters = { [columnName: string]: Filter[] }
type ColumnJoinMethods = { [columnName: string]: JoinMethod }

/**
 * Matches TypeORM named parameters (`:name` and `:...name` spread form) while skipping
 * PostgreSQL cast syntax (`::type`).
 *
 * TypeORM parameter names may contain letters, digits, underscores, and dots (the latter
 * for embedded-property paths, e.g. `size.height0`). The pattern captures the full name
 * including any embedded-path dots.
 *
 * Capture groups:
 *   1 — optional `...` spread prefix (present for IN parameters)
 *   2 — parameter name (may contain dots for embedded paths)
 *
 * Examples:
 *   `:name`          → matches, spread=undefined, name='name'
 *   `:...vals`       → matches, spread='...', name='vals'
 *   `:size.height0`  → matches, spread=undefined, name='size.height0'
 *   `col::text`      → no match (lookbehind rejects `::`)
 *   `:param::int`    → matches `:param`, skips `::int`
 */
/** @internal Exported for testing only. */
export const TYPEORM_PARAM_REGEX = /(?<!:):(\.\.\.)?([a-zA-Z0-9_.]+)/g

export interface FilterToken {
    quantifier: FilterQuantifier
    comparator: FilterComparator
    suffix?: FilterSuffix
    operator: FilterOperator
    value: string
}

// This function is used to fix the query parameters when using relation, embeded or virtual properties
// It will replace the column name with the alias name and return the new parameters
export function fixQueryParam(
    alias: string,
    column: string,
    filter: Filter,
    condition: WherePredicateOperator,
    parameters: { [key: string]: string }
): { [key: string]: string } {
    const isNotOperator = (condition.operator as string) === 'not'

    const conditionFixer = (
        alias: string,
        column: string,
        filter: Filter,
        operator: WherePredicateOperator['operator'],
        parameters: { [key: string]: string }
    ): { condition_params: any; params: any } => {
        let condition_params: any = undefined
        let params = parameters
        switch (operator) {
            case 'between':
                condition_params = [alias, `:${column}_from`, `:${column}_to`]
                params = {
                    [column + '_from']: filter.findOperator.value[0],
                    [column + '_to']: filter.findOperator.value[1],
                }
                break
            case 'in':
                condition_params = [alias, `:...${column}`]
                break
            default:
                condition_params = [alias, `:${column}`]
                break
        }
        return { condition_params, params }
    }

    const { condition_params, params } = conditionFixer(
        alias,
        column,
        filter,
        isNotOperator ? condition['condition']['operator'] : condition.operator,
        parameters
    )

    if (isNotOperator) {
        condition['condition']['parameters'] = condition_params
    } else {
        condition.parameters = condition_params
    }

    return params
}

export function generatePredicateCondition(
    qb: SelectQueryBuilder<unknown>,
    column: string,
    filter: Filter,
    alias: string,
    isVirtualProperty = false
): WherePredicateOperator {
    return qb['getWherePredicateCondition'](
        isVirtualProperty ? column : alias,
        filter.findOperator
    ) as WherePredicateOperator
}

/**
 * Validates the parts of a polymorphic `a~b` column and left-joins any to-one relation parts
 * (without selecting them). Must run on the main query builder — joins cannot be added from
 * inside a `Brackets` where-callback. Each part must be a plain or to-one relation column.
 *
 * Relation parts may be nested (`a.b.c.leaf`): every segment before the leaf column is a hop that
 * is joined step by step (the database cannot resolve a multi-level path in one join). Each hop is
 * joined under a path-derived alias (`<parent>_<segment>_rel`) that matches exactly what
 * `fixColumnAlias`/`buildPolymorphicCoalesce` reference for the leaf, and hops shared across parts
 * (e.g. a common `a.b` prefix) reuse the already-created join by alias rather than colliding.
 */
export function preparePolymorphicColumn(qb: SelectQueryBuilder<any>, column: string) {
    for (const part of column.split('~')) {
        const props = getPropertiesByColumnName(part)
        const { isVirtualProperty } = extractVirtualProperty(qb, props)
        const isEmbedded = checkIsEmbedded(qb, props.propertyPath)
        if (isVirtualProperty || isEmbedded || resolveJsonbPath(qb, props.column).isJsonb) {
            throw new BadRequestException(
                `Polymorphic filter groups (using "~") support only plain and to-one relation columns, not "${part}".`
            )
        }

        // Every path segment except the trailing column is a relation hop to join.
        const relationPath = part.split('.').slice(0, -1)
        let parentAlias = qb.alias
        let metadata = qb.expressionMap.mainAlias.metadata
        for (const relationName of relationPath) {
            const relation = metadata.relations.find((r) => r.propertyPath === relationName)
            if (!relation) {
                throw new BadRequestException(
                    `Polymorphic filter groups (using "~") support only plain and to-one relation columns, not "${part}".`
                )
            }
            if (relation.isOneToMany || relation.isManyToMany) {
                throw new BadRequestException(
                    `Polymorphic filter groups (using "~") support only to-one relations, not "${part}".`
                )
            }
            const joinAlias = `${parentAlias}_${relationName}_rel`
            if (!qb.expressionMap.joinAttributes.some((attr) => attr.alias?.name === joinAlias)) {
                qb.leftJoin(`${parentAlias}.${relationName}`, joinAlias)
            }
            parentAlias = joinAlias
            metadata = relation.inverseEntityMetadata
        }
    }
}

/**
 * Builds `COALESCE(colA, colB, ...)` for a polymorphic column `colA~colB`. Identifiers are escaped
 * because this raw expression is not escaped by the query builder. The parts must already have been
 * validated and joined by `preparePolymorphicColumn`.
 */
function buildPolymorphicCoalesce(qb: SelectQueryBuilder<any>, column: string): string {
    const escape = (identifier: string) => qb.connection.driver.escape(identifier)
    const refs = column.split('~').map((part) => {
        const props = getPropertiesByColumnName(part)
        const isRelation = checkIsRelation(qb, props.propertyPath)
        const ref = fixColumnAlias(props, qb.alias, isRelation, false, false, undefined, qb)
        const separator = ref.indexOf('.')
        return separator === -1 ? escape(ref) : `${escape(ref.slice(0, separator))}.${escape(ref.slice(separator + 1))}`
    })
    return `COALESCE(${refs.join(', ')})`
}

export function addWhereCondition<T>(
    qb: SelectQueryBuilder<T>,
    column: string,
    filter: ColumnFilters,
    paramKeySuffix = ''
) {
    const isPolymorphic = column.includes('~')
    const columnProperties = getPropertiesByColumnName(column)
    const { isVirtualProperty, query: virtualQuery } = isPolymorphic
        ? { isVirtualProperty: false, query: undefined }
        : extractVirtualProperty(qb, columnProperties)
    const isRelation = !isPolymorphic && checkIsRelation(qb, columnProperties.propertyPath)
    const isEmbedded = !isPolymorphic && checkIsEmbedded(qb, columnProperties.propertyPath)
    const isArray = !isPolymorphic && checkIsArray(qb, columnProperties.propertyName)

    const alias = isPolymorphic
        ? buildPolymorphicCoalesce(qb, column)
        : fixColumnAlias(columnProperties, qb.alias, isRelation, isVirtualProperty, isEmbedded, virtualQuery, qb)

    // `~` is not a valid parameter-name character, so sanitise it for polymorphic columns.
    const paramColumn = isPolymorphic ? column.replace(/[^a-zA-Z0-9_]/g, '_') : columnProperties.column

    filter[column].forEach((columnFilter: Filter, index: number) => {
        // The suffix keeps parameter names unique when the same column appears in several
        // leaves of a filter expression (e.g. `color=$eq:a OR color=$eq:b`).
        const columnNamePerIteration = `${paramColumn}${index}${paramKeySuffix}`
        const condition = generatePredicateCondition(qb, paramColumn, columnFilter, alias, isVirtualProperty)
        const parameters = fixQueryParam(alias, columnNamePerIteration, columnFilter, condition, {
            [columnNamePerIteration]: columnFilter.findOperator.value,
        })
        if (
            isArray &&
            condition.parameters?.length &&
            !['not', 'isNull', 'arrayContains'].includes(condition.operator)
        ) {
            condition.parameters[0] = `cardinality(${condition.parameters[0]})`
        }
        const expression = qb['createWhereConditionExpression'](condition)
        if (columnFilter.comparator === FilterComparator.OR) {
            qb.orWhere(expression, parameters)
        } else {
            qb.andWhere(expression, parameters)
        }
    })
}

export function parseFilterToken(raw?: string): FilterToken | null {
    if (raw === undefined || raw === null) {
        return null
    }

    const token: FilterToken = {
        quantifier: FilterQuantifier.ANY,
        comparator: FilterComparator.AND,
        suffix: undefined,
        operator: FilterOperator.EQ,
        value: raw,
    }

    const MAX_OPERATOR = 5 // max 4 operators: $none:$not:$eq:$null
    const OPERAND_SEPARATOR = ':'

    const matches = raw.split(OPERAND_SEPARATOR)
    const maxOperandCount = matches.length > MAX_OPERATOR ? MAX_OPERATOR : matches.length
    const notValue: (FilterOperator | FilterSuffix | FilterQuantifier | FilterComparator)[] = []

    for (let i = 0; i < maxOperandCount; i++) {
        const match = matches[i]
        if (isQuantifier(match)) {
            token.quantifier = match
        } else if (isComparator(match)) {
            token.comparator = match
        } else if (isSuffix(match)) {
            token.suffix = match
        } else if (isOperator(match)) {
            token.operator = match
        } else {
            break
        }
        notValue.push(match)
    }

    if (notValue.length) {
        token.value =
            !raw.includes(OPERAND_SEPARATOR) || token.operator === FilterOperator.NULL
                ? // things like `$null`, `$none`, and `$any`, have no token value
                  undefined
                : // otherwise, remove the operators and separators from the raw string to obtain the token value
                  raw.replace(`${notValue.join(OPERAND_SEPARATOR)}${OPERAND_SEPARATOR}`, '')
    }

    return token
}

/**
 * Resolves the type of a (possibly nested) relation column's leaf, e.g. `a.b.leaf`, by walking the
 * relation chain hop by hop — `extractVirtualProperty` only resolves a single hop. Used to coerce
 * polymorphic (`~`) filter values, whose raw COALESCE has no query-builder-typed parameter and so
 * would otherwise compare as text on type-strict drivers (SQLite). Returns undefined if any hop or
 * the leaf column can't be resolved.
 */
function resolveLeafColumnType(qb: SelectQueryBuilder<unknown>, column: string): unknown {
    const segments = column.split('.')
    const leaf = segments[segments.length - 1]
    let metadata = qb?.expressionMap?.mainAlias?.metadata
    for (const relationName of segments.slice(0, -1)) {
        const relation = metadata?.relations.find((r) => r.propertyPath === relationName)
        if (!relation) return undefined
        metadata = relation.inverseEntityMetadata
    }
    return metadata?.columns?.find((c) => c.propertyName === leaf)?.type
}

function fixColumnFilterValue<T>(column: string, qb: SelectQueryBuilder<T>, isJsonb = false) {
    const isPolymorphic = column.includes('~')
    // A polymorphic `a~b` column has no metadata of its own; coerce values using its first part,
    // so e.g. a numeric COALESCE compares numerically on type-strict drivers (SQLite). The first
    // part may be nested (`a.b.leaf`), so walk the relation chain to the leaf's type.
    const typeColumn = isPolymorphic ? column.split('~')[0] : column
    const columnProperties = getPropertiesByColumnName(typeColumn)
    const columnType = isPolymorphic
        ? resolveLeafColumnType(qb, typeColumn)
        : extractVirtualProperty(qb, columnProperties).type

    return (value: string) => {
        if ((isDateColumnType(columnType) || isJsonb) && isISODate(value)) {
            return new Date(value)
        }

        if ((columnType === Number || columnType === 'number' || isJsonb) && !isNaN(Number(value))) {
            return Number(value)
        }

        return value
    }
}
export function isComparator(value: unknown): value is FilterComparator {
    return values(FilterComparator).includes(value as any)
}
export function parseFilter<T>(
    query: PaginateQuery,
    filterableColumns?: {
        [column: string]: (FilterOperator | FilterSuffix | FilterQuantifier)[] | true
    },
    qb?: SelectQueryBuilder<T>,
    throwOnInvalidFilter = false
): ColumnFilters {
    const filter: ColumnFilters = {}
    if (!filterableColumns || !query.filter) {
        return {}
    }
    for (const column of Object.keys(query.filter)) {
        if (!(column in filterableColumns)) {
            if (throwOnInvalidFilter) {
                throw new BadRequestException(`Column '${column}' is not filterable`)
            }
            continue
        }
        const allowedOperators = filterableColumns[column]
        const input = query.filter[column]
        const statements = !Array.isArray(input) ? [input] : input
        for (const raw of statements) {
            const token = parseFilterToken(raw)
            if (!token) {
                continue
            }
            if (allowedOperators === true) {
                if (token.operator && !isOperator(token.operator)) {
                    if (throwOnInvalidFilter) {
                        throw new BadRequestException(
                            `Invalid filter operator '${token.operator}' for column '${column}'`
                        )
                    }
                    continue
                }
                if (token.suffix && !isSuffix(token.suffix)) {
                    if (throwOnInvalidFilter) {
                        throw new BadRequestException(`Invalid filter suffix '${token.suffix}' for column '${column}'`)
                    }
                    continue
                }
            } else {
                if (
                    token.operator &&
                    token.operator !== FilterOperator.EQ &&
                    !allowedOperators.includes(token.operator)
                ) {
                    if (throwOnInvalidFilter) {
                        throw new BadRequestException(
                            `Filter operator '${token.operator}' is not allowed for column '${column}'`
                        )
                    }
                    continue
                }
                if (token.suffix && !allowedOperators.includes(token.suffix)) {
                    if (throwOnInvalidFilter) {
                        throw new BadRequestException(
                            `Filter suffix '${token.suffix}' is not allowed for column '${column}'`
                        )
                    }
                    continue
                }
                if (token.quantifier !== FilterQuantifier.ANY && !allowedOperators.includes(token.quantifier)) {
                    continue
                }
            }

            const params: (typeof filter)[0][0] = {
                quantifier: token.quantifier,
                comparator: token.comparator,
                findOperator: undefined,
            }

            const fixValue = fixColumnFilterValue(column, qb)

            const columnProperties = getPropertiesByColumnName(column)
            const jsonbResolution = resolveJsonbPath(qb, columnProperties.column)

            switch (token.operator) {
                case FilterOperator.BTW:
                    params.findOperator = OperatorSymbolToFunction.get(token.operator)(
                        ...token.value.split(',').map(fixValue)
                    )
                    break
                case FilterOperator.IN:
                case FilterOperator.CONTAINS:
                    params.findOperator = OperatorSymbolToFunction.get(token.operator)(
                        token.value.split(',').map((v) => fixValue(v.trim()))
                    )
                    break
                case FilterOperator.ILIKE:
                    params.findOperator = OperatorSymbolToFunction.get(token.operator)(`%${token.value}%`)
                    break
                case FilterOperator.SW:
                    params.findOperator = OperatorSymbolToFunction.get(token.operator)(`${token.value}%`)
                    break
                default:
                    params.findOperator = OperatorSymbolToFunction.get(token.operator)(fixValue(token.value))
            }

            if (jsonbResolution.isJsonb) {
                const supportJsonContains = [FilterOperator.EQ, FilterOperator.IN, FilterOperator.CONTAINS].includes(
                    token.operator
                )

                if (supportJsonContains) {
                    const jsonFixValue = fixColumnFilterValue(column, qb, true)

                    // Use a stable filter key that preserves the relation path so that
                    // addWhereCondition can later resolve the correct JOIN alias.
                    // e.g. 'detail.referrer.source.platform' → filterKey = 'detail.referrer'
                    //      'metadata.length'                 → filterKey = 'metadata'
                    //      'underCoat.metadata.length'       → filterKey = 'underCoat.metadata'
                    const filterKey = [...jsonbResolution.relationPath, jsonbResolution.jsonbColumn].join('.')

                    // Build a JsonContains containment object for a single leaf value.
                    // e.g. jsonPath=['source','platform'], value='web' → { source: { platform: 'web' } }
                    //      jsonPath=['length'],            value=5     → { length: 5 }
                    const buildContainment = (rawValue: string) => {
                        const leafValue = jsonFixValue(rawValue)
                        return jsonbResolution.jsonPath.reduceRight<Record<string, unknown>>(
                            (acc, key) => ({ [key]: acc }),
                            leafValue as unknown as Record<string, unknown>
                        )
                    }

                    if (token.operator === FilterOperator.IN) {
                        token.value.split(',').forEach((val, i) => {
                            filter[filterKey] = [
                                ...(filter[filterKey] || []),
                                {
                                    comparator: i === 0 ? params.comparator : FilterComparator.OR,
                                    findOperator: JsonContains(buildContainment(val.trim())),
                                    quantifier: FilterQuantifier.ANY,
                                },
                            ]
                        })
                    } else {
                        filter[filterKey] = [
                            ...(filter[filterKey] || []),
                            {
                                comparator: params.comparator,
                                findOperator: JsonContains(buildContainment(token.value)),
                                quantifier: FilterQuantifier.ANY,
                            },
                        ]
                    }
                } else {
                    filter[column] = [...(filter[column] || []), params]
                }
            } else {
                filter[column] = [...(filter[column] || []), params]
            }

            // suffix ($not) is applied on the filter key used above.
            // For JSONB $in, $not must be applied to every expanded entry so that
            // NOT (col @> '{a}') AND NOT (col @> '{b}') is produced (NOT IN semantics).
            if (token.suffix) {
                const isJsonbAndSupportsJsonContains =
                    jsonbResolution.isJsonb &&
                    [FilterOperator.EQ, FilterOperator.IN, FilterOperator.CONTAINS].includes(token.operator)

                const filterKey = isJsonbAndSupportsJsonContains
                    ? [...jsonbResolution.relationPath, jsonbResolution.jsonbColumn].join('.')
                    : column
                const isJsonbIn = isJsonbAndSupportsJsonContains && token.operator === FilterOperator.IN
                const applyFrom = isJsonbIn
                    ? filter[filterKey].length - token.value.split(',').length
                    : filter[filterKey].length - 1
                for (let i = applyFrom; i < filter[filterKey].length; i++) {
                    filter[filterKey][i].findOperator = OperatorSymbolToFunction.get(token.suffix)(
                        filter[filterKey][i].findOperator
                    )
                    // $not:$in means NOT IN — all expanded values are AND'd with NOT
                    if (isJsonbIn && i > applyFrom) {
                        filter[filterKey][i].comparator = FilterComparator.AND
                    }
                }
            }
        }
    }
    return filter
}

class RelationPathError extends Error {}

/**
 * Retrieves the relation path for a given column name within the provided metadata.
 *
 * This method analyzes the column name's segments to identify corresponding relations or embedded entities
 * within the hierarchy described by the given metadata and returns a structured path.
 *
 * @param {string} columnName - The dot-delimited name of the column whose relation path is to be determined.
 * @param {EntityMetadata | EmbeddedMetadata} metadata - The metadata of the entity or embedded component
 * which holds the relations or embedded items.
 * @return {[string, RelationMetadata | EmbeddedMetadata][]} The ordered array describing the path,
 * where each element contains a field name and its corresponding relation or embedded metadata.
 * Throws an error if no matching relation or embedded metadata is found.
 */
export function getRelationPath(
    columnName: string,
    metadata: EntityMetadata | EmbeddedMetadata
): [string, RelationMetadata | EmbeddedMetadata][] {
    const relationSegments = columnName.split('.')
    const deeper = relationSegments.slice(1).join('.')
    const fieldName = relationSegments[0].replace(/[()]/g, '')

    try {
        // Check if there's a relation with this property name
        const relation = metadata.relations.find((r) => r.propertyName === fieldName)
        if (relation) {
            return [
                [fieldName, relation] as const,
                ...(relationSegments.length > 1 ? getRelationPath(deeper, relation.inverseEntityMetadata) : []),
            ]
        }

        // Check if there's something embedded with this property name
        const embedded = metadata.embeddeds.find((embedded) => embedded.propertyName === fieldName)
        if (embedded) {
            return [
                [fieldName, embedded] as const,
                ...(relationSegments.length > 1 ? getRelationPath(deeper, embedded) : []),
            ]
        }

        // A JSON(B) column followed by a key path (e.g. `metadata.length`) is a direct filter,
        // not a relation chain: the remaining segments index into the JSON value, they are not
        // relations. Terminate the path here rather than treating `length` as a missing relation.
        if ('findColumnWithPropertyName' in metadata) {
            const columnType = metadata.findColumnWithPropertyName(fieldName)?.type
            if (JSON_COLUMN_TYPES.includes(columnType as string)) {
                return []
            }
        }
    } catch (e) {
        if (e instanceof RelationPathError) {
            throw new RelationPathError(`No relation or embedded found for property path ${columnName}`)
        }
        throw e
    }
    if (relationSegments.length > 1)
        throw new RelationPathError(`No relation or embedded found for property path ${columnName}`)
    return []
}

/**
 * Finds the first 'to-many' relationship in a given entity metadata or embedded metadata
 * given a column name. A 'to-many' relationship can be either a one-to-many or a
 * many-to-many relationship.
 *
 * @param {string} columnName - The column name to traverse through its segments and find relationships.
 * @param {EntityMetadata | EmbeddedMetadata} metadata - The metadata of the entity or
 * embedded object in which relationships are defined.
 * @return {{ path: string[]; relation: RelationMetadata } | undefined} An object containing
 * the path to the 'to-many' relationship and the relationship metadata, or undefined if no
 * 'to-many' relationships are found.
 */
function findFirstToManyRelationship(
    columnName: string,
    metadata: EntityMetadata | EmbeddedMetadata
): { path: string[]; relation: RelationMetadata } | undefined {
    let relationPath: ReturnType<typeof getRelationPath>
    try {
        relationPath = getRelationPath(columnName, metadata)
    } catch (e) {
        if (e instanceof RelationPathError) return undefined
        throw e
    }
    const relationSegments = columnName.split('.')
    const firstToMany = relationPath.findIndex(
        ([, relation]) => 'isOneToMany' in relation && (relation.isOneToMany || relation.isManyToMany)
    )
    if (firstToMany > -1)
        return {
            path: relationSegments.slice(0, firstToMany + 1),
            relation: relationPath[firstToMany][1] as RelationMetadata,
        }
}

/**
 * Finds the first relationship of any cardinality (to-one or to-many) on the column path,
 * returning the path up to and including it. Embedded segments are not relationships.
 * Returns undefined for pure root/embedded columns.
 */
function findFirstRelationship(
    columnName: string,
    metadata: EntityMetadata | EmbeddedMetadata
): { path: string[]; relation: RelationMetadata } | undefined {
    let relationPath: ReturnType<typeof getRelationPath>
    try {
        relationPath = getRelationPath(columnName, metadata)
    } catch (e) {
        if (e instanceof RelationPathError) return undefined
        throw e
    }
    const relationSegments = columnName.split('.')
    const firstRelation = relationPath.findIndex(([, meta]) => 'isOneToMany' in meta)
    if (firstRelation > -1)
        return {
            path: relationSegments.slice(0, firstRelation + 1),
            relation: relationPath[firstRelation][1] as RelationMetadata,
        }
}

/**
 * Determines where the EXISTS subquery for a relation filter should be rooted: at the first
 * to-many relation if the path has one (so the existing to-many join chain is preserved), and
 * otherwise at the first to-one relation. Used for top-level filters; inside an EXISTS subquery
 * only to-many relations are lifted out, while to-one relations are joined locally.
 */
function findExistsRootPath(
    columnName: string,
    metadata: EntityMetadata | EmbeddedMetadata
): { path: string[]; relation: RelationMetadata } | undefined {
    return findFirstToManyRelationship(columnName, metadata) ?? findFirstRelationship(columnName, metadata)
}

export interface AddFilterOptions {
    /**
     * Set when `addFilter` is called recursively to build an EXISTS subquery. Inside a subquery
     * to-one relations are joined locally (they don't pollute the outer result set), so only
     * to-many relations are lifted into nested EXISTS. At the top level every relation filter
     * becomes an EXISTS.
     * @internal
     */
    subFilter?: boolean
    /**
     * Suffix appended to EXISTS subquery aliases and parameters to keep them unique across
     * sibling filter-expression leaves on the same relation path.
     * @internal
     */
    scope?: string | number
}

export function addFilter<T>(
    qb: SelectQueryBuilder<T>,
    query: PaginateQuery,
    filterableColumns?: {
        [column: string]: (FilterOperator | FilterSuffix | FilterQuantifier)[] | true
    },
    opts: AddFilterOptions = {},
    throwOnInvalidFilter = false
) {
    const { subFilter = false } = opts
    const filter = parseFilter(query, filterableColumns, qb, throwOnInvalidFilter)

    // Polymorphic `a~b` columns need their relation parts joined on this query builder before the
    // condition (added inside Brackets, which cannot add joins) references the COALESCE.
    for (const key of Object.keys(filter)) {
        if (key.includes('~')) preparePolymorphicColumn(qb, key)
    }

    addDirectFilters(qb, filter, subFilter)
    addToManySubFilters(qb, filter, query, filterableColumns, opts)

    const columnJoinMethods: ColumnJoinMethods = {}
    if (!subFilter) {
        // Top level: relation filters are EXISTS subqueries and root/embedded filters are plain
        // WHERE clauses, so filtering never joins a relation into the result set.
        return columnJoinMethods
    }
    // Inside an EXISTS subquery, to-one relation filters are joined locally; report those joins so
    // the subquery builder adds them.
    const metadata = qb.expressionMap.mainAlias.metadata
    for (const [key] of Object.entries(filter)) {
        const relationPath = getRelationPath(key, metadata)
        if (findFirstToManyRelationship(key, metadata)) {
            continue
        }
        for (let i = 0; i < relationPath.length; i++) {
            const column = relationPath
                .slice(0, i + 1)
                .map((p) => p[0])
                .join('.')
            if ('inverseRelation' in relationPath[i][1]) {
                columnJoinMethods[column] = 'innerJoinAndSelect'
            }
        }
    }
    return columnJoinMethods
}

type ExpressionFilterableColumns = {
    [column: string]: (FilterOperator | FilterSuffix | FilterQuantifier)[] | true
}

/**
 * Translates a legacy per-column filter map (using the removed `$and:`/`$or:` comparator
 * prefixes) into a `filter=` boolean expression string compatible with the current expression
 * engine.
 *
 * **OR-mode columns** — a column whose first filter value starts with `$or:` — contribute all
 * their leaves to a single global OR group (matching the old behaviour where each `$or:` value
 * was added with `orWhere` at the outer query level). **AND-mode columns** — whose first value
 * has no `$or:` prefix — build a per-column bracket expression (respecting within-column
 * comparators) that is AND-joined with everything else.
 *
 * The global OR group, if present, is wrapped in `()` when AND-mode terms follow it, so that
 * `(A OR B) AND C` is generated rather than relying on SQL-precedence ambiguity.
 *
 * Values containing whitespace or parentheses are quoted for the expression tokenizer.
 *
 * Returns `undefined` when the filter map is empty or has no non-empty entries.
 */
export function translateLegacyFilterToExpression(filter: { [column: string]: string | string[] }): string | undefined {
    const orLeaves: string[] = [] // leaves from OR-mode columns (global OR group)
    const andGroupExprs: string[] = [] // column bracket expressions for AND-mode columns

    for (const column of Object.keys(filter)) {
        const rawValues = filter[column]
        const values = Array.isArray(rawValues) ? rawValues : [rawValues]

        const terms: Array<{ comparator: 'and' | 'or'; leaf: string }> = []
        for (const raw of values) {
            if (raw === undefined || raw === null) continue
            let comparator: 'and' | 'or' = 'and'
            let token = raw
            if (raw.startsWith('$or:')) {
                comparator = 'or'
                token = raw.slice('$or:'.length)
            } else if (raw.startsWith('$and:')) {
                comparator = 'and'
                token = raw.slice('$and:'.length)
            }
            // The expression tokenizer splits on whitespace and parentheses, so a value that
            // contains either must be quoted. Wrapping the whole token (including any operator
            // prefix such as `$eq:`) in double quotes is safe: the tokenizer strips the outer
            // quotes and passes the raw content to parseFilterToken unchanged.
            const needsQuoting = /[\s()]/.test(token)
            const leafValue = needsQuoting ? `"${token.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : token
            terms.push({ comparator, leaf: `${column}=${leafValue}` })
        }

        if (terms.length === 0) continue

        const firstIsOr = terms[0].comparator === 'or'

        if (firstIsOr) {
            // OR-mode column: every leaf joins the global OR group (replicating the old
            // behaviour where each value was added via `orWhere` at the top-level query).
            for (const term of terms) {
                orLeaves.push(term.leaf)
            }
        } else {
            // AND-mode column: build the per-column expression respecting within-column
            // comparators, then AND-join it with the rest of the expression.
            const hasWithinOr = terms.slice(1).some((t) => t.comparator === 'or')
            let colExpr = terms[0].leaf
            for (let i = 1; i < terms.length; i++) {
                colExpr =
                    terms[i].comparator === 'or' ? `${colExpr} OR ${terms[i].leaf}` : `${colExpr} AND ${terms[i].leaf}`
            }
            // Wrap in parens when the column group contains OR so it stays self-contained.
            if (hasWithinOr && terms.length > 1) colExpr = `(${colExpr})`
            andGroupExprs.push(colExpr)
        }
    }

    if (orLeaves.length === 0 && andGroupExprs.length === 0) return undefined

    const parts: string[] = []
    if (orLeaves.length > 0) {
        const orExpr = orLeaves.join(' OR ')
        // Wrap OR group in parens when AND terms follow to make the grouping explicit.
        parts.push(andGroupExprs.length > 0 ? `(${orExpr})` : orExpr)
    }
    for (const andExpr of andGroupExprs) {
        parts.push(andExpr)
    }

    return parts.join(' AND ')
}

/**
 * Applies a `filter=` boolean expression to the query. Each leaf is wrapped in its own
 * `Brackets` so AND/OR/NOT compose uniformly. Root/embedded and polymorphic (`a~b`) leaves
 * become direct conditions; relation leaves become correlated EXISTS (NOT EXISTS when negated).
 */
export function addFilterExpression<T>(
    qb: SelectQueryBuilder<T>,
    expression: string,
    filterableColumns?: ExpressionFilterableColumns,
    maxComplexity?: number
) {
    const ast = normalizeFilterExpression(parseFilterExpression(expression, maxComplexity))
    // Join the relation parts of any polymorphic `a~b` leaves up front (joins can't be added from
    // inside the Brackets the leaves compile to).
    for (const column of collectLeafColumns(ast)) {
        if (column.includes('~')) preparePolymorphicColumn(qb, column)
    }
    qb.andWhere(compileFilterExpression(ast, filterableColumns, { next: 0 }))
}

function collectLeafColumns(node: NormalizedFilterExpression): string[] {
    return node.type === 'leaf' ? [node.column] : node.children.flatMap(collectLeafColumns)
}

function compileFilterExpression(
    node: NormalizedFilterExpression,
    filterableColumns: ExpressionFilterableColumns | undefined,
    counter: { next: number }
): Brackets {
    if (node.type === 'leaf') {
        const leafId = counter.next++
        return new Brackets((qb: SelectQueryBuilder<any>) => applyExpressionLeaf(qb, node, filterableColumns, leafId))
    }
    // Compile children eagerly so each leaf gets a stable id and unique parameter names.
    const childBrackets = node.children.map((child) => compileFilterExpression(child, filterableColumns, counter))
    return new Brackets((qb: SelectQueryBuilder<any>) => {
        childBrackets.forEach((childBracket, index) => {
            if (index === 0 || node.type === 'and') {
                qb.andWhere(childBracket)
            } else {
                qb.orWhere(childBracket)
            }
        })
    })
}

function applyExpressionLeaf(
    qb: SelectQueryBuilder<any>,
    leaf: { column: string; value: string; negated: boolean },
    filterableColumns: ExpressionFilterableColumns | undefined,
    leafId: number
) {
    const metadata = qb.expressionMap.mainAlias.metadata

    // Polymorphic `a~b` columns COALESCE across columns and are applied as a direct condition
    // (handled by addWhereCondition below), never as an EXISTS.
    if (!leaf.column.includes('~') && findFirstRelationship(leaf.column, metadata)) {
        // A relation leaf is a correlated EXISTS; its negation is NOT EXISTS, expressed with the
        // $none quantifier. addFilter (top level) routes the relation through the EXISTS builder.
        let value = leaf.value
        if (leaf.negated) {
            if (parseFilterToken(value)?.quantifier !== FilterQuantifier.ANY) {
                throw new BadRequestException(
                    `Cannot negate a quantified relation filter "${leaf.column}=${leaf.value}"`
                )
            }
            value = `${FilterQuantifier.NONE}:${value}`
        }
        addFilter(qb, { filter: { [leaf.column]: value }, path: '' }, filterableColumns, { scope: leafId }, true)
        return
    }

    // Expression terms always validate: silently dropping a leaf would change the boolean result.
    const columnFilters = parseFilter({ filter: { [leaf.column]: leaf.value }, path: '' }, filterableColumns, qb, true)
    // A JSONB key-path leaf (e.g. `metadata.length`) is re-keyed by parseFilter under its JSONB
    // column (`metadata`), so drive the conditions off the keys parseFilter actually produced
    // rather than assuming the leaf column is present verbatim.
    for (const key of Object.keys(columnFilters)) {
        if (leaf.negated) {
            for (const filter of columnFilters[key]) {
                filter.findOperator = Not(filter.findOperator)
            }
        }
        addWhereCondition(qb, key, columnFilters, `_e${leafId}`)
    }
}

export function addDirectFilters<T>(qb: SelectQueryBuilder<T>, filter: ColumnFilters, subFilter = false) {
    const metadata = qb.expressionMap.mainAlias.metadata

    // Top level: only root/embedded/polymorphic columns are direct WHERE clauses; every relation
    // filter becomes an EXISTS subquery. Inside a subquery, to-one relations are joined locally and
    // stay direct, and only to-many relations are lifted into nested EXISTS.
    const findRelation = subFilter ? findFirstToManyRelationship : findFirstRelationship
    const directColumns = Object.keys(filter).filter((key) => key.includes('~') || !findRelation(key, metadata))

    // Columns are ANDed; each is wrapped in its own brackets so a column's own OR group
    // (e.g. a JSONB `$in` expansion) stays self-contained.
    for (const column of directColumns) {
        qb.andWhere(new Brackets((bracket: SelectQueryBuilder<T>) => addWhereCondition(bracket, column, filter)))
    }
}

/**
 * Adds a correlated EXISTS subquery to `qb` for every relation-path filter, rooted at the first
 * relation on each path. The path's `$any`/`$none`/`$all` quantifier decides whether it becomes
 * EXISTS, NOT EXISTS, or an all-match check.
 */
export function addToManySubFilters<T>(
    qb: SelectQueryBuilder<T>,
    filter: ColumnFilters,
    query: PaginateQuery,
    filterableColumns?: {
        [column: string]: (FilterOperator | FilterSuffix | FilterQuantifier)[] | true
    },
    { subFilter = false, scope = '' }: AddFilterOptions = {}
) {
    const dbType = qb.connection.options.type
    const quote = (column: string) => quoteColumn(column, ['mysql', 'mariadb'].includes(dbType))
    const mainMetadata = qb.expressionMap.mainAlias.metadata
    const filterEntries = Object.entries(filter)

    // Each relation filter becomes a correlated EXISTS subquery. At the top level it is rooted at
    // the first relation of any cardinality; inside a subquery only to-many relations are lifted out
    // (to-one relations are joined locally), preserving the existing to-many query shape.
    const findRoot = subFilter ? findFirstToManyRelationship : findExistsRootPath
    const existsFilters = filterEntries
        .map(([key]) => (key.includes('~') ? undefined : findRoot(key, mainMetadata)))
        .filter(Boolean)
    // Find all the distinct relation starting paths
    const toManyPaths = [...new Set(existsFilters.map((f) => f.path.join('.')))]

    const toManyRelations = toManyPaths.map(
        (path) => [path, existsFilters.find((f) => f.path.join('.') === path).relation] as const
    )

    for (const [path, relation] of toManyRelations) {
        const mainQueryAlias = qb.alias
        const relationPath = getRelationPath(path, mainMetadata)
        // 1. Create the EXISTS subquery, starting from the toMany entity
        const existsMetadata = relation.inverseEntityMetadata

        // Slug used in alias/parameter suffixes to scope them to this relation path.
        // Using the path (e.g. "toys" → "toys", "cat.toys" → "cat_toys") ensures that two
        // independent to-many paths in the same outer query never share alias or parameter names,
        // even when both use existsIndex=0 (OR-mode) or overlapping sub-column names.
        // `scope` keeps aliases/parameters unique when several filter-expression leaves build an
        // EXISTS for the same relation path (e.g. `toys.name=$eq:a OR toys.name=$eq:b`).
        const pathSlug = `${path.replace(/\./g, '_')}${scope === '' ? '' : `_x${scope}`}`

        // 2. Extract the sub-filters that apply to this relation path.
        const { subQuery, subFilterableColumns } = createSubFilter(query, filterableColumns, path)

        // Build and correlate the single EXISTS subquery for this path. `pathSlug` keeps its
        // aliases and parameters from colliding with other relation paths in the same query.
        const buildExistsQb = () => {
            const relAlias = (name: string, depth: number) => `_rel_${name}_${depth}_${pathSlug}`
            const juncAlias = (name: string, depth: number) => `_junc_${name}_${depth}_${pathSlug}`
            const leafAlias = relAlias(relationPath[relationPath.length - 1][0], relationPath.length - 1)
            const existsQb = qb.connection.createQueryBuilder(existsMetadata.target as any, leafAlias)

            const subJoins = addFilter(existsQb, subQuery, subFilterableColumns, { subFilter: true })

            // Step 3: Add the sub relationship joins to the EXISTS subquery.
            const relationsSchema = mergeRelationSchema(createRelationSchema(Object.keys(subJoins)))
            addRelationsFromSchema(existsQb, relationsSchema, {}, 'innerJoin')

            // Step 4: Build the chain of joins that backtracks our toMany relationship to the root.
            buildSubqueryJoinChain(existsQb, relAlias, juncAlias)

            // Step 5: Suffix the subquery's parameters so they don't collide with the outer query.
            renameSubqueryParameters(existsQb, `_${pathSlug}`)

            return existsQb
        }

        /**
         * Adds the join chain that correlates the EXISTS subquery back to the root entity.
         * Iterates from the deepest relation segment to the root, adding INNER JOINs for
         * intermediate relations and a correlated WHERE clause for the root relation.
         */
        function buildSubqueryJoinChain(
            existsQb: SelectQueryBuilder<any>,
            relAlias: (name: string, depth: number) => string,
            juncAlias: (name: string, depth: number) => string
        ) {
            for (let i = relationPath.length - 1; i >= 0; i--) {
                const [, meta] = relationPath[i]

                // --- A: Skip Embedded Entities ---
                if (meta.type === 'embedded') {
                    continue
                }

                // --- B: Handle Table Relation (RelationMetadata) ---
                const parentMeta = meta as RelationMetadata

                if (i !== 0) {
                    // --- Intermediate Join ---
                    const parentAlias = relAlias(relationPath[i - 1][0], i - 1)
                    const childAlias = relAlias(relationPath[i][0], i)
                    const childRelationMetadata = parentMeta.inverseRelation
                    const joinCols = childRelationMetadata.joinColumns
                    const onConditions = joinCols
                        .map((jc) => {
                            const fk = jc.databaseName
                            const pk = jc.referencedColumn.databaseName
                            return `${quote(childAlias)}.${quote(fk)} = ${quote(parentAlias)}.${quote(pk)}`
                        })
                        .join(' AND ')
                    existsQb.innerJoin(
                        childRelationMetadata.inverseRelation.entityMetadata.target,
                        parentAlias,
                        onConditions
                    )
                } else {
                    correlateManyToManyOrFk(existsQb, parentMeta, relAlias, juncAlias)
                }
            }
        }

        /**
         * Adds the root correlation clause to the EXISTS subquery.
         * For ManyToMany relations, JOINs the junction table and correlates via it.
         * For OneToMany / ManyToOne relations, adds a direct FK = PK WHERE clause.
         */
        function correlateManyToManyOrFk(
            existsQb: SelectQueryBuilder<any>,
            parentMeta: RelationMetadata,
            relAlias: (name: string, depth: number) => string,
            juncAlias: (name: string, depth: number) => string
        ) {
            // --- Root correlation ---
            //
            // `joinMeta` is always the owning side of the relation, regardless of which side
            // the filter is expressed from. This is because TypeORM stores join column metadata
            // (including junction table metadata for ManyToMany) only on the owning side.
            //
            // Example (ManyToMany, inverse side):
            //   Cat.friends (owning) ←→ Cat.friendOf (inverse)
            //   Filtering on "friendOf.name": parentMeta = friendOf (inverse, !isOwning)
            //   joinMeta = parentMeta.inverseRelation = friends (owning)
            //   toRelatedCols = joinMeta.joinColumns  (junction → owning entity = friendOf side)
            //   toMainCols    = joinMeta.inverseJoinColumns (junction → inverse entity = Cat being filtered)
            if (!parentMeta.isOwning && !parentMeta.inverseRelation) {
                throw new Error(
                    `Cannot build EXISTS subquery for ManyToMany relation "${path}": ` +
                        `the relation has no inverse side defined. ` +
                        `Ensure the @ManyToMany decorator on the inverse entity references this relation.`
                )
            }
            const joinMeta = parentMeta.isOwning ? parentMeta : parentMeta.inverseRelation

            if (parentMeta.isManyToMany) {
                // For ManyToMany, the FK columns live in the junction (join) table, not on the
                // related entity's table. We must JOIN the junction table into the EXISTS subquery
                // and correlate via it.
                const junctionMeta = joinMeta.junctionEntityMetadata
                const junctionAlias = juncAlias(relationPath[0][0], 0)
                const relatedAlias = relAlias(relationPath[0][0], 0)

                // Column role mapping (always relative to `joinMeta`, which is the owning side):
                //   joinMeta.joinColumns        → junction columns pointing to the owning entity
                //   joinMeta.inverseJoinColumns → junction columns pointing to the inverse entity
                //
                // When filtering from the owning side (parentMeta.isOwning):
                //   toRelatedCols = inverseJoinColumns → junction → related entity (EXISTS root)
                //   toMainCols    = joinColumns        → junction → main query entity
                //
                // When filtering from the inverse side (!parentMeta.isOwning):
                //   joinMeta = parentMeta.inverseRelation (the owning side)
                //   toRelatedCols = joinMeta.joinColumns        → junction → owning entity (EXISTS root)
                //   toMainCols    = joinMeta.inverseJoinColumns → junction → main query entity
                const toRelatedCols = parentMeta.isOwning ? joinMeta.inverseJoinColumns : joinMeta.joinColumns
                const toMainCols = parentMeta.isOwning ? joinMeta.joinColumns : joinMeta.inverseJoinColumns

                const junctionToRelatedConditions = toRelatedCols
                    .map((jc) => {
                        const junctionCol = jc.databaseName
                        const relatedPk = jc.referencedColumn.databaseName
                        return `${quote(junctionAlias)}.${quote(junctionCol)} = ${quote(relatedAlias)}.${quote(
                            relatedPk
                        )}`
                    })
                    .join(' AND ')

                const junctionTarget = junctionMeta.target ?? junctionMeta.tableName
                existsQb.innerJoin(junctionTarget, junctionAlias, junctionToRelatedConditions)

                for (const joinColumn of toMainCols) {
                    const junctionCol = joinColumn.databaseName
                    const mainPk = joinColumn.referencedColumn.databaseName
                    existsQb.andWhere(
                        `${quote(junctionAlias)}.${quote(junctionCol)} = ${quote(mainQueryAlias)}.${quote(mainPk)}`
                    )
                }
            } else {
                for (const joinColumn of joinMeta.joinColumns) {
                    const fkColumn = joinColumn.databaseName
                    const pkColumn = joinColumn.referencedColumn.databaseName
                    let fkAlias: string
                    let pkAlias: string
                    if (parentMeta.isOwning) {
                        pkAlias = relAlias(relationPath[0][0], 0)
                        fkAlias = mainQueryAlias
                    } else {
                        fkAlias = relAlias(relationPath[0][0], 0)
                        pkAlias = mainQueryAlias
                    }
                    existsQb.andWhere(`${quote(fkAlias)}.${quote(fkColumn)} = ${quote(pkAlias)}.${quote(pkColumn)}`)
                }
            }
        }

        /**
         * Renames all TypeORM named parameters in the EXISTS subquery by appending `suffix`.
         * This prevents parameter name collisions when multiple EXISTS subqueries share the
         * outer query's parameter namespace (AND-mode emits one EXISTS per `$and` value).
         *
         * Handles both simple parameters (`:name`) and spread parameters (`:...name` for IN),
         * and correctly skips PostgreSQL cast syntax (`::type`).
         */
        function renameSubqueryParameters(existsQb: SelectQueryBuilder<any>, suffix: string) {
            const oldParams = { ...existsQb.expressionMap.parameters }
            existsQb.expressionMap.parameters = {}
            for (const [key, value] of Object.entries(oldParams)) {
                existsQb.expressionMap.parameters[key + suffix] = value
            }
            // Use the module-level TYPEORM_PARAM_REGEX (handles both :name and :...name spread form,
            // skips PostgreSQL ::type cast syntax). Must reset lastIndex since the regex is stateful (flag g).
            const renameParamsInString = (s: string) => {
                TYPEORM_PARAM_REGEX.lastIndex = 0
                return s.replace(TYPEORM_PARAM_REGEX, (_, spread, name) => `:${spread ?? ''}${name}${suffix}`)
            }
            const renameParamsInCondition = (condition: any): void => {
                if (typeof condition === 'string') {
                    // Top-level string conditions are handled by the caller (the `for` loop over
                    // `existsQb.expressionMap.wheres` below). Nested string conditions that appear
                    // inside a `WhereClause.condition` object are handled by the `condition.condition`
                    // branch below. This branch is a no-op guard — TypeORM never passes a bare string
                    // here in practice, but the type allows it.
                    return
                }
                if (Array.isArray(condition)) {
                    // Arrays cannot be mutated element-by-element for strings (immutable),
                    // so we map over the array and replace string items directly.
                    for (let i = 0; i < condition.length; i++) {
                        if (typeof condition[i] === 'string') {
                            condition[i] = renameParamsInString(condition[i])
                        } else {
                            renameParamsInCondition(condition[i])
                        }
                    }
                    return
                }
                if (condition && typeof condition === 'object') {
                    if (typeof condition.condition === 'string') {
                        condition.condition = renameParamsInString(condition.condition)
                    } else if (condition.condition) {
                        renameParamsInCondition(condition.condition)
                    }
                    // Also rename in nested children arrays (e.g. Brackets with multiple clauses)
                    if (Array.isArray(condition.wheres)) {
                        for (const child of condition.wheres) {
                            if (typeof child.condition === 'string') {
                                child.condition = renameParamsInString(child.condition)
                            } else {
                                renameParamsInCondition(child.condition)
                            }
                        }
                    }
                }
            }
            for (const where of existsQb.expressionMap.wheres) {
                if (typeof where.condition === 'string') {
                    where.condition = renameParamsInString(where.condition)
                } else {
                    renameParamsInCondition(where.condition)
                }
            }
        }

        // Determine the quantifier for this path (must be uniform across all sub-columns).
        const quantifiers = Object.entries(filter)
            .filter(([key]) => key.startsWith(path))
            .flatMap(([, multiFilter]) => multiFilter.map((f) => f.quantifier))

        let quantifier = FilterQuantifier.ANY
        for (const q of quantifiers) {
            if (q !== FilterQuantifier.ANY) {
                if (quantifier !== FilterQuantifier.ANY && quantifier !== q) {
                    throw new Error(`Quantifier ${quantifier} and ${q} are not compatible for the same column ${path}`)
                }
                quantifier = q
            }
        }

        // Detect whether any sub-filter value is a bare IS NULL check (without $not).
        // In the old JOIN-based approach a LEFT JOIN produced NULL columns for missing relation
        // rows, so `IS NULL` also matched assets that had no relation row at all. Replicate that
        // behaviour with EXISTS by wrapping the subquery as:
        //   (EXISTS(conditioned) OR NOT EXISTS(bare FK correlation))
        const hasNullFilter = Object.values(subQuery.filter ?? {}).some((vals) => {
            const arr = Array.isArray(vals) ? vals : [vals]
            return arr.some((v) => {
                if (typeof v !== 'string') return false
                const token = parseFilterToken(v)
                return token?.operator === FilterOperator.NULL && token?.suffix !== FilterSuffix.NOT
            })
        })

        // 5. Add the EXISTS subquery to the main query, applying the path's quantifier.
        const existsQb = buildExistsQb()
        if (quantifier === FilterQuantifier.ANY) {
            if (hasNullFilter) {
                // Build a bare correlated subquery with just the FK correlation (no filter
                // conditions) to test whether any relation row exists at all. Then emit:
                //   AND (EXISTS(filtered) OR NOT EXISTS(bare))
                // so that assets with no relation row satisfy the IS NULL condition, matching
                // the behaviour of the old LEFT JOIN approach.
                const barePathSlug = `${pathSlug}_norow`
                const bareRelAlias = (name: string, depth: number) => `_rel_${name}_${depth}_${barePathSlug}`
                const bareJuncAlias = (name: string, depth: number) => `_junc_${name}_${depth}_${barePathSlug}`
                const bareLeafAlias = bareRelAlias(
                    relationPath[relationPath.length - 1][0],
                    relationPath.length - 1
                )
                const bareQb = qb.connection.createQueryBuilder(existsMetadata.target as any, bareLeafAlias)
                buildSubqueryJoinChain(bareQb, bareRelAlias, bareJuncAlias)
                renameSubqueryParameters(bareQb, `_${barePathSlug}`)
                const [existsCondition, existsParams] = qb['getExistsCondition'](existsQb)
                const [bareCondition, bareParams] = qb['getExistsCondition'](bareQb)
                qb.andWhere(`(${existsCondition} OR NOT ${bareCondition})`, {
                    ...existsParams,
                    ...bareParams,
                })
            } else {
                qb.andWhereExists(existsQb)
            }
        } else if (quantifier === FilterQuantifier.NONE) {
            andWhereNoneExist(qb, existsQb)
        } else if (quantifier === FilterQuantifier.ALL) {
            andWhereAllExist(qb, existsQb)
        }
    }
}

export function createSubFilter(
    query: PaginateQuery,
    filterableColumns: {
        [column: string]: (FilterOperator | FilterSuffix | FilterQuantifier)[] | true
    },
    column: string
) {
    const subQuery = { filter: {} } as PaginateQuery
    for (const [subColumn, filter] of Object.entries(query.filter)) {
        if (subColumn.startsWith(column + '.')) {
            subQuery.filter[getSubColumn(column, subColumn)] = filter
        }
    }
    const subFilterableColumns: {
        [column: string]: (FilterOperator | FilterSuffix | FilterQuantifier)[] | true
    } = {}
    for (const [subColumn, filter] of Object.entries(filterableColumns)) {
        if (subColumn.startsWith(column + '.')) {
            subFilterableColumns[getSubColumn(column, subColumn)] = filter
        }
    }
    return { subQuery, subFilterableColumns }
}

function getSubColumn(column: string, subColumn: string) {
    const sliced = subColumn.slice(column.length + 1)
    if (sliced.startsWith('(') && sliced.endsWith(')')) {
        // Embedded relationships need to be unpacked from subColumn.(embedded.property) to
        // embedded.property
        return sliced.slice(1, -1)
    }
    return sliced
}
