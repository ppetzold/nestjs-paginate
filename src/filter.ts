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
    filterableColumns?: { [column: string]: (FilterOperator | FilterSuffix | FilterQuantifier)[] | true },
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
    const relationPath = getRelationPath(columnName, metadata)
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

export function addFilter<T>(
    qb: SelectQueryBuilder<T>,
    query: PaginateQuery,
    filterableColumns?: { [column: string]: (FilterOperator | FilterSuffix | FilterQuantifier)[] | true }
) {
    const mainMetadata = qb.expressionMap.mainAlias.metadata
    const filter = parseFilter(query, filterableColumns, qb)

    addDirectFilters(qb, filter)
    addToManySubFilters(qb, filter, query, filterableColumns)

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

export function addToManySubFilters<T>(
    qb: SelectQueryBuilder<T>,
    filter: ColumnFilters,
    query: PaginateQuery,
    filterableColumns?: { [column: string]: (FilterOperator | FilterSuffix | FilterQuantifier)[] | true }
) {
    const dbType = qb.connection.options.type
    const quote = (column: string) => quoteColumn(column, ['mysql', 'mariadb'].includes(dbType))
    const mainMetadata = qb.expressionMap.mainAlias.metadata
    const filterEntries = Object.entries(filter)

    // Filters with toMany relationships on their path need to be expressed as EXISTS subqueries.
    const existsFilters = filterEntries.map(([key]) => findFirstToManyRelationship(key, mainMetadata)).filter(Boolean)
    // Find all the different toMany starting paths
    const toManyPaths = [...new Set(existsFilters.map((f) => f.path.join('.')))]
    const toManyRelations = toManyPaths.map(
        (path) => [path, existsFilters.find((f) => f.path.join('.') === path).relation] as const
    )

    for (const [path, relation] of toManyRelations) {
        const mainQueryAlias = qb.alias
        const relationPath = getRelationPath(path, mainMetadata)
        const toManyAlias = `_rel_${relationPath[relationPath.length - 1][0]}_${relationPath.length - 1}`

        // 1. Create the EXISTS subquery, starting from the toMany entity
        const existsMetadata = relation.inverseEntityMetadata
        const existsQb = qb.connection.createQueryBuilder(existsMetadata.target as any, toManyAlias)

        if (existsMetadata.deleteDateColumn) {
            //existsQb.andWhere(`"${toManyAlias}"."${existsMetadata.deleteDateColumn.databaseName}" IS NULL`)
        }

        // 2. Add the subfilters to the EXISTS subquery
        const { subQuery, subFilterableColumns } = createSubFilter(query, filterableColumns, path)
        const subJoins = addFilter(existsQb, subQuery, subFilterableColumns)

        // 3. Add the sub relationship joins to the EXISTS subquery
        const relationsSchema = mergeRelationSchema(createRelationSchema(Object.keys(subJoins)))
        // Only inner join, no need to select anything
        addRelationsFromSchema(existsQb, relationsSchema, {}, 'innerJoin')

        // 4. Build the chain of joins that backtracks our toMany relationship to the root.

        // We iterate from the second-to-last item (the immediate parent) back to the first item (root's child)
        for (let i = relationPath.length - 1; i >= 0; i--) {
            const [, meta] = relationPath[i]

            // --- A: Skip Embedded Entities ---
            if (meta.type === 'embedded') {
                // Embedded entities exist within the current table (currentChildAlias).
                // They do not require a JOIN, so we simply continue to the next item in the path.
                continue
            }

            // --- B: Handle Table Relation (RelationMetadata) ---
            // If we reach this point, 'meta' is a RelationMetadata object.
            const parentMeta = meta as RelationMetadata

            // Check if this is an intermediate or top-level relationship
            if (i !== 0) {
                // --- Intermediate Join (Joining two non-root tables within the subquery) ---

                const parentAlias = `_rel_${relationPath[i - 1][0]}_${i - 1}`
                const childAlias = `_rel_${relationPath[i][0]}_${i}`
                const childRelationMetadata = parentMeta.inverseRelation

                // Get the join columns from the inverse relation of the current metadata (e.g., inverse of 'pillows')
                const joinCols = childRelationMetadata.joinColumns

                // Construct the ON condition (handles composite keys)
                const onConditions = joinCols
                    .map((jc) => {
                        const fk = jc.databaseName
                        const pk = jc.referencedColumn.databaseName
                        return `${quote(childAlias)}.${quote(fk)} = ${quote(parentAlias)}.${quote(pk)}`
                    })
                    .join(' AND ')

                // Add the INNER JOIN to the subquery
                existsQb.innerJoin(
                    childRelationMetadata.inverseRelation.entityMetadata.target,
                    parentAlias,
                    onConditions
                )
            } else {
                // Perform the final correlation WHERE clause to the main query alias
                const joinMeta = parentMeta.isOwning ? parentMeta : parentMeta.inverseRelation

                if (parentMeta.isManyToMany) {
                    // For ManyToMany, the FK columns live in the junction (join) table, not on the
                    // related entity's table. We must JOIN the junction table into the EXISTS subquery
                    // and correlate via it.
                    const junctionMeta = joinMeta.junctionEntityMetadata
                    const junctionAlias = `_junc_${relationPath[0][0]}_0`
                    const relatedAlias = `_rel_${relationPath[0][0]}_0`

                    // When accessed from the owning side:
                    //   joinColumns        → junction → owning entity (mainQueryAlias)
                    //   inverseJoinColumns → junction → inverse entity (relatedAlias)
                    // When accessed from the inverse side, the roles are swapped.
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

                    // Correlate the junction table back to the main query entity.
                    for (const joinColumn of toMainCols) {
                        const junctionCol = joinColumn.databaseName
                        const mainPk = joinColumn.referencedColumn.databaseName
                        existsQb.andWhere(
                            `${quote(junctionAlias)}.${quote(junctionCol)} = ${quote(mainQueryAlias)}.${quote(mainPk)}`
                        )
                    }
                } else {
                    for (const joinColumn of joinMeta.joinColumns) {
                        // 1. Get the raw column names from the owning metadata:
                        const fkColumn = joinColumn.databaseName
                        const pkColumn = joinColumn.referencedColumn.databaseName

                        // 2. Get the table aliases
                        let fkAlias: string
                        let pkAlias: string
                        if (parentMeta.isOwning) {
                            pkAlias = `_rel_${relationPath[0][0]}_0`
                            fkAlias = mainQueryAlias
                        } else {
                            fkAlias = `_rel_${relationPath[0][0]}_0`
                            pkAlias = mainQueryAlias
                        }

                        // Correlation
                        existsQb.andWhere(`${quote(fkAlias)}.${quote(fkColumn)} = ${quote(pkAlias)}.${quote(pkColumn)}`)
                    }
                }
            }
        }

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

export function createSubFilter(
    query: PaginateQuery,
    filterableColumns: { [column: string]: (FilterOperator | FilterSuffix | FilterQuantifier)[] | true },
    column: string
) {
    const subQuery = { filter: {} } as PaginateQuery
    for (const [subColumn, filter] of Object.entries(query.filter)) {
        if (subColumn.startsWith(column + '.')) {
            subQuery.filter[getSubColumn(column, subColumn)] = filter
        }
    }
    const subFilterableColumns: { [column: string]: (FilterOperator | FilterSuffix | FilterQuantifier)[] | true } = {}
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
