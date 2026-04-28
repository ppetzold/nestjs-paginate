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

export enum FilterComparator {
    AND = '$and',
    OR = '$or',
}

export function isComparator(value: unknown): value is FilterComparator {
    return values(FilterComparator).includes(value as any)
}

/**
 * Returns true when the raw filter string explicitly carries the `$and` comparator token.
 *
 * This is distinct from the default AND comparator that every token carries implicitly —
 * we only want to enter AND-mode when the user deliberately wrote `$and:` in the filter value.
 * Using `parseFilterToken` (rather than a naive substring split) ensures that `$and` embedded
 * inside a user value (e.g. `$eq:$and`) is not misidentified as the comparator.
 *
 * Must be called after `parseFilterToken` is defined (hoisting applies to function declarations).
 */
export function hasExplicitAndComparator(raw: string): boolean {
    const token = parseFilterToken(raw)
    if (!token) return false
    if (token.comparator !== FilterComparator.AND) return false
    // The default token comparator is AND, so we must confirm the user actually wrote `$and` as a
    // colon-delimited token segment. We reconstruct the consumed prefix (everything before the value)
    // and check whether `$and` appears in it as a discrete segment.
    // This correctly rejects `$eq:$and` (value = `$and`, prefix = `$eq:`) and accepts `$and:Ball`.
    const valueSuffix = token.value !== undefined ? `:${token.value}` : ''
    const prefix = valueSuffix ? raw.slice(0, raw.length - valueSuffix.length) : raw
    return prefix.split(':').some((seg) => seg === FilterComparator.AND)
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

export function addWhereCondition<T>(qb: SelectQueryBuilder<T>, column: string, filter: ColumnFilters) {
    const columnProperties = getPropertiesByColumnName(column)
    const { isVirtualProperty, query: virtualQuery } = extractVirtualProperty(qb, columnProperties)
    const isRelation = checkIsRelation(qb, columnProperties.propertyPath)
    const isEmbedded = checkIsEmbedded(qb, columnProperties.propertyPath)
    const isArray = checkIsArray(qb, columnProperties.propertyName)

    const alias = fixColumnAlias(
        columnProperties,
        qb.alias,
        isRelation,
        isVirtualProperty,
        isEmbedded,
        virtualQuery,
        qb
    )
    filter[column].forEach((columnFilter: Filter, index: number) => {
        const columnNamePerIteration = `${columnProperties.column}${index}`
        const condition = generatePredicateCondition(
            qb,
            columnProperties.column,
            columnFilter,
            alias,
            isVirtualProperty
        )
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

    const MAX_OPERATOR = 5 // max 5 operator: $none:$and:$not:$eq:$null
    const OPERAND_SEPARATOR = ':'

    const matches = raw.split(OPERAND_SEPARATOR)
    const maxOperandCount = matches.length > MAX_OPERATOR ? MAX_OPERATOR : matches.length
    const notValue: (FilterOperator | FilterSuffix | FilterComparator | FilterQuantifier)[] = []

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

function fixColumnFilterValue<T>(column: string, qb: SelectQueryBuilder<T>, isJsonb = false) {
    const columnProperties = getPropertiesByColumnName(column)
    const virtualProperty = extractVirtualProperty(qb, columnProperties)
    const columnType = virtualProperty.type

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

export function parseFilter<T>(
    query: PaginateQuery,
    filterableColumns?: {
        [column: string]: (FilterOperator | FilterSuffix | FilterQuantifier | FilterComparator)[] | true
    },
    qb?: SelectQueryBuilder<T>
): ColumnFilters {
    const filter: ColumnFilters = {}
    if (!filterableColumns || !query.filter) {
        return {}
    }
    for (const column of Object.keys(query.filter)) {
        if (!(column in filterableColumns)) {
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
                    continue
                }
                if (token.suffix && !isSuffix(token.suffix)) {
                    continue
                }
            } else {
                if (
                    token.operator &&
                    token.operator !== FilterOperator.EQ &&
                    !allowedOperators.includes(token.operator)
                ) {
                    continue
                }
                if (token.suffix && !allowedOperators.includes(token.suffix)) {
                    continue
                }
                if (token.quantifier !== FilterQuantifier.ANY && !allowedOperators.includes(token.quantifier)) {
                    continue
                }
                // Gate the $and comparator: only allow it if explicitly listed in filterableColumns.
                // The default token comparator is AND (used for normal andWhere), so we must check
                // whether $and was explicitly present in the raw filter string, not just the token default.
                if (!allowedOperators.includes(FilterComparator.AND) && hasExplicitAndComparator(raw)) {
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

export interface AddFilterOptions {
    /**
     * Maximum number of `$and` values allowed per sub-column in a single to-many filter.
     * Each value produces a separate correlated EXISTS subquery, so large values have a
     * linear performance cost. Defaults to 20.
     */
    maxAndValues?: number
    /**
     * When false, skips the validation that rejects `$and` on non-to-many columns.
     * Set to false when calling `addFilter` recursively for EXISTS sub-queries, where the
     * entity metadata is the leaf entity and the to-many check would incorrectly throw.
     * @internal
     */
    validateAndComparator?: boolean
}

export function addFilter<T>(
    qb: SelectQueryBuilder<T>,
    query: PaginateQuery,
    filterableColumns?: {
        [column: string]: (FilterOperator | FilterSuffix | FilterQuantifier | FilterComparator)[] | true
    },
    opts: AddFilterOptions = {}
) {
    const mainMetadata = qb.expressionMap.mainAlias.metadata
    const filter = parseFilter(query, filterableColumns, qb)

    addDirectFilters(qb, filter)
    addToManySubFilters(qb, filter, query, filterableColumns, opts)

    // Direct filters require to be joined, so pass the join information back up to the main pagination builder
    // (or the parent filter query in case of subfilters)
    const columnJoinMethods: ColumnJoinMethods = {}
    for (const [key] of Object.entries(filter)) {
        const relationPath = getRelationPath(key, mainMetadata)
        // Skip filters that don't result in WHERE clauses and so don't need to be joined..
        if (
            relationPath.find(
                ([, relation]) => 'isOneToMany' in relation && (relation.isOneToMany || relation.isManyToMany)
            )
        ) {
            continue
        }

        for (let i = 0; i < relationPath.length; i++) {
            const column = relationPath
                .slice(0, i + 1)
                .map((p) => p[0])
                .join('.')
            // Skip joins on embedded entities
            if ('inverseRelation' in relationPath[i][1]) {
                columnJoinMethods[column] = 'innerJoinAndSelect'
            }
        }
    }

    return columnJoinMethods
}

export function addDirectFilters<T>(qb: SelectQueryBuilder<T>, filter: ColumnFilters) {
    const filterEntries = Object.entries(filter)
    const metadata = qb.expressionMap.mainAlias.metadata

    // Direct filters are those without toMany relationships on their path, and can be expressed as simple JOINs + WHERE clauses
    const whereFilters = filterEntries.filter(([key]) => !findFirstToManyRelationship(key, metadata))
    const orFilters = whereFilters.filter(([, value]) => value[0].comparator === '$or')
    const andFilters = whereFilters.filter(([, value]) => value[0].comparator === '$and')

    qb.andWhere(
        new Brackets((qb: SelectQueryBuilder<T>) => {
            for (const [column] of orFilters) {
                addWhereCondition(qb, column, filter)
            }
        })
    )

    for (const [column] of andFilters) {
        qb.andWhere(
            new Brackets((qb: SelectQueryBuilder<T>) => {
                addWhereCondition(qb, column, filter)
            })
        )
    }
}

/**
 * Adds correlated EXISTS subqueries to `qb` for all to-many relationship filters in `filter`.
 *
 * **AND-mode (`$and` comparator)**
 *
 * When a sub-column filter uses the `$and` comparator (e.g. `filter[toys.name]=$and:Ball`),
 * each distinct `$and` value produces a separate correlated EXISTS subquery, ANDed on the
 * outer query. This is the only correct way to express "entity has ALL of these related values"
 * — a single EXISTS with AND conditions on the same column is always false on a single row.
 *
 * **Performance note**: each `$and` value adds one correlated EXISTS with the full join chain
 * for that relation path. For a relation path of depth D and N `$and` values, this produces
 * N × D joins. The `maxAndValues` option (default 20) caps N to limit query complexity.
 *
 * **Restrictions**:
 * - `$and` may only be used on to-many relationship columns.
 * - `$and` values may not be mixed with non-`$and` values on the same sub-column.
 * - `$and` may not be combined with `$none` or `$all` quantifiers.
 * - `$and` may only be applied to a single sub-column per relation path at a time.
 */
export function addToManySubFilters<T>(
    qb: SelectQueryBuilder<T>,
    filter: ColumnFilters,
    query: PaginateQuery,
    filterableColumns?: {
        [column: string]: (FilterOperator | FilterSuffix | FilterQuantifier | FilterComparator)[] | true
    },
    { maxAndValues = 20, validateAndComparator = true }: AddFilterOptions = {}
) {
    const dbType = qb.connection.options.type
    const quote = (column: string) => quoteColumn(column, ['mysql', 'mariadb'].includes(dbType))
    const mainMetadata = qb.expressionMap.mainAlias.metadata
    const filterEntries = Object.entries(filter)

    // Filters with toMany relationships on their path need to be expressed as EXISTS subqueries.
    const existsFilters = filterEntries.map(([key]) => findFirstToManyRelationship(key, mainMetadata)).filter(Boolean)
    // Find all the different toMany starting paths
    const toManyPaths = [...new Set(existsFilters.map((f) => f.path.join('.')))]

    // Validate that $and is not used on scalar (non-to-many) columns — it has no meaningful
    // semantics there and would produce always-false conditions (e.g. WHERE name = 'a' AND name = 'b').
    // Skip this validation when called recursively for EXISTS subqueries (validateAndComparator = false),
    // because the sub-filter keys are already stripped of the relation prefix and the entity metadata
    // is the leaf entity, so the to-many check would incorrectly throw.
    if (validateAndComparator) {
        for (const [key, rawValues] of Object.entries(query.filter ?? {})) {
            const isToMany = findFirstToManyRelationship(key, mainMetadata) != null
            if (!isToMany) {
                const values = Array.isArray(rawValues) ? rawValues : [rawValues]
                const hasAndValue = values.some((v) => hasExplicitAndComparator(v))
                if (hasAndValue) {
                    throw new Error(
                        `The $and comparator can only be used on to-many relationship columns. ` +
                            `Column "${key}" is not a to-many relationship.`
                    )
                }
            }
        }
    }

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
        const pathSlug = path.replace(/\./g, '_')

        // 2. Extract sub-filters for this path.
        // If any sub-filter entry uses the $and comparator, we must emit one correlated EXISTS
        // subquery per value — because a single EXISTS with AND conditions on the same column
        // (e.g. WHERE tag.id = A AND tag.id = B) is always false on a single row.
        // We split $and values into individual sub-queries and AND them on the outer query.
        const { subQuery, subFilterableColumns } = createSubFilter(query, filterableColumns, path)

        // Collect $and filter values per sub-column so we can split them out.
        const andValuesBySubColumn: { [subCol: string]: string[] } = {}
        for (const [subCol, rawValues] of Object.entries(subQuery.filter ?? {})) {
            const values = Array.isArray(rawValues) ? rawValues : [rawValues]
            const andValues = values.filter((v) => hasExplicitAndComparator(v))
            if (andValues.length >= 1) {
                andValuesBySubColumn[subCol] = andValues
            }
        }

        // Determine how many EXISTS subqueries to emit for this path.
        // If there are $and values on any sub-column, we need one EXISTS per value (for those columns).
        // Other sub-columns (OR-mode) are included in every EXISTS subquery unchanged.
        const andSubColumns = Object.keys(andValuesBySubColumn)

        // Build a helper that constructs and correlates a single EXISTS subquery for this path.
        // existsIndex must be unique per EXISTS emitted for this path to avoid alias collisions
        // when multiple EXISTS subqueries are added to the same outer query (AND-mode).
        // The pathSlug is included in all aliases and parameter names so that two independent
        // to-many paths (e.g. "toys" and "friends") never collide even when both use existsIndex=0.
        const buildExistsQb = (extraSubQuery: PaginateQuery, existsIndex = 0) => {
            const relAlias = (name: string, depth: number) => `_rel_${name}_${depth}_${pathSlug}_e${existsIndex}`
            const juncAlias = (name: string, depth: number) => `_junc_${name}_${depth}_${pathSlug}_e${existsIndex}`
            const leafAlias = relAlias(relationPath[relationPath.length - 1][0], relationPath.length - 1)
            const existsQb = qb.connection.createQueryBuilder(existsMetadata.target as any, leafAlias)

            const subJoins = addFilter(existsQb, extraSubQuery, subFilterableColumns, { validateAndComparator: false })

            // Step 3: Add the sub relationship joins to the EXISTS subquery.
            const relationsSchema = mergeRelationSchema(createRelationSchema(Object.keys(subJoins)))
            addRelationsFromSchema(existsQb, relationsSchema, {}, 'innerJoin')

            // Step 4: Build the chain of joins that backtracks our toMany relationship to the root.
            buildSubqueryJoinChain(existsQb, relAlias, juncAlias)

            // Step 5: Rename all parameters to include a path+index suffix, preventing collisions
            // when multiple EXISTS subqueries share the outer query's parameter namespace.
            const suffix = `_${pathSlug}_e${existsIndex}`
            renameSubqueryParameters(existsQb, suffix)

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

        if (andSubColumns.length > 0) {
            // AND-mode: emit one EXISTS per $and value on each sub-column, ANDed on the outer query.
            // OR-mode values on other sub-columns are included in every EXISTS subquery unchanged.
            //
            // Example: filter[tag.id]=$and:tagA&filter[tag.id]=$and:tagB produces:
            //   AND EXISTS (SELECT 1 FROM tag JOIN junction ON ... WHERE tag.id = 'tagA' AND ...)
            //   AND EXISTS (SELECT 1 FROM tag JOIN junction ON ... WHERE tag.id = 'tagB' AND ...)
            //
            // This is the only correct way to express "entity has ALL of these related values" —
            // a single EXISTS with AND conditions on the same column is always false on a single row.

            // $and comparator is incompatible with $none/$all quantifiers — the $and comparator
            // already implies AND-mode (multiple correlated EXISTS), so combining it with a
            // quantifier that changes the EXISTS semantics is a user error.
            if (quantifier !== FilterQuantifier.ANY) {
                throw new Error(
                    `The $and comparator cannot be combined with the $${quantifier} quantifier on column ${path}. ` +
                        `Use $any (the default) with $and, or use $${quantifier} without $and.`
                )
            }

            // $and on multiple sub-columns produces a cartesian product of EXISTS subqueries,
            // which has surprising semantics: each EXISTS asserts a separate row exists, not a
            // single row matching all conditions. Disallow this to avoid silent incorrect results.
            if (andSubColumns.length > 1) {
                throw new Error(
                    `The $and comparator cannot be used on multiple sub-columns of the same relation path ${path} simultaneously ` +
                        `(found: ${andSubColumns.join(', ')}). Apply $and to a single sub-column at a time.`
                )
            }

            // Build the base sub-query without the $and values (keeps OR-mode filters on other columns,
            // and keeps any non-$and values on the $and sub-column itself).
            //
            // Note: OR-mode values on the $and sub-column (non-$and values mixed with $and values)
            // are included in every EXISTS subquery as an additional filter. For example:
            //   filter[toys.name]=$and:Ball&filter[toys.name]=$eq:Mouse
            // produces EXISTS subqueries that each include `$eq:Mouse` as an additional condition.
            // This means each EXISTS asserts: "a related row exists where name = 'Ball' AND name = 'Mouse'"
            // (always false for a single row), which is likely not the intended behavior.
            // Users should use only $and values or only OR-mode values on a given sub-column, not both.
            const baseSubQuery: PaginateQuery = {
                ...subQuery,
                filter: Object.fromEntries(
                    Object.entries(subQuery.filter ?? {}).flatMap(([col, rawValues]) => {
                        if (!andSubColumns.includes(col)) {
                            return [[col, rawValues]]
                        }
                        // Reject mixing $and values with non-$and (OR-mode) values on the same sub-column.
                        // A mixed filter would produce EXISTS subqueries with conditions like
                        // `name = 'Ball' AND name = 'Mouse'` (always false on a single row),
                        // which silently returns empty results rather than the user's intent.
                        const values = Array.isArray(rawValues) ? rawValues : [rawValues]
                        const orValues = values.filter((v) => !hasExplicitAndComparator(v))
                        if (orValues.length > 0) {
                            throw new Error(
                                `Cannot mix $and values with non-$and values on sub-column "${col}" of relation "${path}". ` +
                                    `Use either all $and or no $and on a given sub-column.`
                            )
                        }
                        return []
                    })
                ),
            }

            // For each $and value on the (single) sub-column, emit a separate EXISTS subquery.
            // Multiple $and sub-columns are disallowed (throws above), so andSubColumns always
            // has exactly one entry here.
            const andSubCol = andSubColumns[0]
            const andValues = andValuesBySubColumn[andSubCol]

            // Validate that each $and value has an actual operand after the comparator.
            // A bare `$and` (no colon separator) produces token.value = undefined, which
            // would generate a malformed query. Require at least `$and:` with a value.
            for (const v of andValues) {
                const token = parseFilterToken(v)
                if (!token || token.value === undefined) {
                    throw new Error(
                        `Invalid $and filter value "${v}" for column ${path}.${andSubCol}: ` +
                            `$and must be followed by a value, e.g. "$and:Ball" or "$and:$eq:Ball".`
                    )
                }
            }

            if (andValues.length > maxAndValues) {
                throw new Error(
                    `Too many $and filter values for column ${path}.${andSubCol}: ${andValues.length} (max ${maxAndValues}). ` +
                        `Reduce the number of $and values.`
                )
            }

            for (const [comboIndex, v] of andValues.entries()) {
                const singleValueSubQuery: PaginateQuery = {
                    ...baseSubQuery,
                    filter: {
                        ...baseSubQuery.filter,
                        [andSubCol]: v,
                    },
                }
                const existsQb = buildExistsQb(singleValueSubQuery, comboIndex)
                qb.andWhereExists(existsQb)
            }
        } else {
            // OR-mode (default): one shared EXISTS subquery for all values on this path.
            const existsQb = buildExistsQb(subQuery)

            // 5. Add the EXISTS subquery to the main query
            if (quantifier === FilterQuantifier.ANY) {
                qb.andWhereExists(existsQb)
            } else if (quantifier === FilterQuantifier.NONE) {
                andWhereNoneExist(qb, existsQb)
            } else if (quantifier === FilterQuantifier.ALL) {
                andWhereAllExist(qb, existsQb)
            }
        }
    }
}

export function createSubFilter(
    query: PaginateQuery,
    filterableColumns: {
        [column: string]: (FilterOperator | FilterSuffix | FilterQuantifier | FilterComparator)[] | true
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
        [column: string]: (FilterOperator | FilterSuffix | FilterQuantifier | FilterComparator)[] | true
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
