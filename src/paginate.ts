import {
    Repository,
    SelectQueryBuilder,
    FindOperator,
    Equal,
    MoreThan,
    MoreThanOrEqual,
    In,
    IsNull,
    LessThan,
    LessThanOrEqual,
    Not,
    ILike,
    Brackets,
    Between,
    FindOptionsWhere,
    ObjectLiteral,
} from 'typeorm'
import { PaginateQuery } from './decorator'
import { ServiceUnavailableException, Logger } from '@nestjs/common'
import { values, mapKeys } from 'lodash'
import { stringify } from 'querystring'
import { WherePredicateOperator } from 'typeorm/query-builder/WhereClause'
import { Column, Order, positiveNumberOrDefault, RelationColumn, SortBy } from './helper'
import { ColumnMetadata } from 'typeorm/metadata/ColumnMetadata'

const logger: Logger = new Logger('nestjs-paginate')

export class Paginated<T> {
    data: T[]
    meta: {
        itemsPerPage: number
        totalItems: number
        currentPage: number
        totalPages: number
        sortBy: SortBy<T>
        searchBy: Column<T>[]
        search: string
        filter?: { [column: string]: string | string[] }
    }
    links: {
        first?: string
        previous?: string
        current: string
        next?: string
        last?: string
    }
}

export interface PaginateConfig<T> {
    relations?: RelationColumn<T>[]
    sortableColumns: Column<T>[]
    nullSort?: 'first' | 'last'
    searchableColumns?: Column<T>[]
    select?: Column<T>[]
    maxLimit?: number
    defaultSortBy?: SortBy<T>
    defaultLimit?: number
    where?: FindOptionsWhere<T> | FindOptionsWhere<T>[]
    filterableColumns?: {
        [key in Column<T>]?: (FilterOperator | FilterSuffix)[]
    }
    withDeleted?: boolean
    relativePath?: boolean
    origin?: string
}

export enum FilterComparator {
    AND = '$and',
    OR = '$or',
}

export function isComparator(value: unknown): value is FilterComparator {
    return values(FilterComparator).includes(value as any)
}

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
}

export function isOperator(value: unknown): value is FilterOperator {
    return values(FilterOperator).includes(value as any)
}

export enum FilterSuffix {
    NOT = '$not',
}

export function isSuffix(value: unknown): value is FilterSuffix {
    return values(FilterSuffix).includes(value as any)
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
])

export interface FilterToken {
    comparator: FilterComparator
    suffix?: FilterSuffix
    operator: FilterOperator
    value: string
}

export function getFilterTokens(raw?: string): FilterToken | null {
    if (raw === undefined || raw === null) {
        return null
    }

    const token: FilterToken = {
        comparator: FilterComparator.AND,
        suffix: undefined,
        operator: FilterOperator.EQ,
        value: raw,
    }

    const MAX_OPERTATOR = 4 // max 4 operator es: $and:$not:$eq:$null
    const OPERAND_SEPARATOR = ':'

    const matches = raw.split(OPERAND_SEPARATOR)
    const maxOperandCount = matches.length > MAX_OPERTATOR ? MAX_OPERTATOR : matches.length
    const notValue: (FilterOperator | FilterSuffix | FilterComparator)[] = []

    for (let i = 0; i < maxOperandCount; i++) {
        const match = matches[i]
        if (isComparator(match)) {
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
            token.operator === FilterOperator.NULL
                ? undefined
                : raw.replace(`${notValue.join(OPERAND_SEPARATOR)}${OPERAND_SEPARATOR}`, '')
    }

    return token
}

type Filter = { comparator: FilterComparator; findOperator: FindOperator<string> }
type ColumnsFilters = { [columnName: string]: Filter[] }

function parseFilter<T>(
    query: PaginateQuery,
    filterableColumns?: PaginateConfig<T>['filterableColumns']
): ColumnsFilters {
    const filter: ColumnsFilters = {}
    if (!filterableColumns || !query.filter) {
        logger.debug("No 'filterableColumns' or 'query.filter' given, ignoring filters.")
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
            const token = getFilterTokens(raw)
            if (
                !token ||
                !(
                    allowedOperators.includes(token.operator) ||
                    (token.suffix === FilterSuffix.NOT &&
                        allowedOperators.includes(token.suffix) &&
                        token.operator === FilterOperator.EQ) ||
                    (token.suffix &&
                        allowedOperators.includes(token.suffix) &&
                        allowedOperators.includes(token.operator))
                )
            ) {
                continue
            }

            const params: typeof filter[0][0] = {
                comparator: token.comparator,
                findOperator: undefined,
            }

            if (token.operator === FilterOperator.BTW) {
                params.findOperator = OperatorSymbolToFunction.get(token.operator)(...token.value.split(','))
            } else if (token.operator === FilterOperator.IN) {
                params.findOperator = OperatorSymbolToFunction.get(token.operator)(token.value.split(','))
            } else if (token.operator === FilterOperator.ILIKE) {
                params.findOperator = OperatorSymbolToFunction.get(token.operator)(`%${token.value}%`)
            } else {
                params.findOperator = OperatorSymbolToFunction.get(token.operator)(token.value)
            }

            filter[column] = [...(filter[column] || []), params]

            if (token.suffix) {
                const lastFilterElement = filter[column].length - 1
                filter[column][lastFilterElement].findOperator = OperatorSymbolToFunction.get(token.suffix)(
                    filter[column][lastFilterElement].findOperator
                )
            }
        }
    }

    return filter
}

export const DEFAULT_MAX_LIMIT = 100
export const DEFAULT_LIMIT = 20
export const NO_PAGINATION = 0

type ColumnProperties = { propertyPath?: string; propertyName: string }

function getPropertiesByColumnName(column: string): ColumnProperties {
    const propertyPath = column.split('.')
    return propertyPath.length > 1
        ? {
              propertyPath: propertyPath[0],
              propertyName: propertyPath.slice(1).join('.'), // the join is in case of an embedded entity
          }
        : { propertyName: propertyPath[0] }
}

function extractVirtualProperty(
    qb: SelectQueryBuilder<unknown>,
    columnProperties: ColumnProperties
): { isVirtualProperty: boolean; query?: ColumnMetadata['query'] } {
    const metadata = columnProperties.propertyPath
        ? qb?.expressionMap?.mainAlias?.metadata?.findColumnWithPropertyPath(columnProperties.propertyPath)
              ?.referencedColumn?.entityMetadata // on relation
        : qb?.expressionMap?.mainAlias?.metadata
    return (
        metadata?.columns?.find((column) => column.propertyName === columnProperties.propertyName) || {
            isVirtualProperty: false,
            query: undefined,
        }
    )
}

function checkIsRelation(qb: SelectQueryBuilder<unknown>, propertyPath: string): boolean {
    if (!qb || !propertyPath) {
        return false
    }
    return !!qb?.expressionMap?.mainAlias?.metadata?.hasRelationWithPropertyPath(propertyPath)
}

// This function is used to fix the query parameters when using relation, embeded or virtual properties
// It will replace the column name with the alias name and return the new parameters
function fixQueryParam(
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

// This function is used to fix the column alias when using relation, embedded or virtual properties
function fixColumnAlias(
    properties: ColumnProperties,
    alias: string,
    isRelation = false,
    isVirtualProperty = false,
    query?: ColumnMetadata['query']
): string {
    if (isRelation) {
        if (isVirtualProperty && query) {
            return `(${query(`${alias}_${properties.propertyPath}`)})` // () is needed to avoid parameter conflict
        } else if (isVirtualProperty && !query) {
            return `${alias}_${properties.propertyPath}_${properties.propertyName}`
        } else {
            return `${alias}_${properties.propertyPath}.${properties.propertyName}` // include embeded property and relation property
        }
    } else if (isVirtualProperty) {
        return query ? `(${query(`${alias}`)})` : `${alias}_${properties.propertyName}`
    } else {
        return `${alias}.${properties.propertyName}` //
    }
}

function generatePredicateCondition(
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

function addWhereCondition<T>(qb: SelectQueryBuilder<T>, column: string, filter: ColumnsFilters) {
    const columnProperties = getPropertiesByColumnName(column)
    const { isVirtualProperty, query: virtualQuery } = extractVirtualProperty(qb, columnProperties)
    const isRelation = checkIsRelation(qb, columnProperties.propertyPath)
    filter[column].forEach((columnFilter: Filter, index: number) => {
        const columnNamePerIteration = `${column}${index}`
        const alias = fixColumnAlias(columnProperties, qb.alias, isRelation, isVirtualProperty, virtualQuery)
        const condition = generatePredicateCondition(qb, column, columnFilter, alias, isVirtualProperty)
        const parameters = fixQueryParam(alias, columnNamePerIteration, columnFilter, condition, {
            [columnNamePerIteration]: columnFilter.findOperator.value,
        })
        if (columnFilter.comparator === FilterComparator.OR) {
            qb.orWhere(qb['createWhereConditionExpression'](condition), parameters)
        } else {
            qb.andWhere(qb['createWhereConditionExpression'](condition), parameters)
        }
    })
}

export function addFilter<T>(
    qb: SelectQueryBuilder<T>,
    query: PaginateQuery,
    filterableColumns?: PaginateConfig<T>['filterableColumns']
): SelectQueryBuilder<T> {
    const filter = parseFilter(query, filterableColumns)
    return qb.andWhere(
        new Brackets((qb: SelectQueryBuilder<T>) => {
            for (const column in filter) {
                addWhereCondition(qb, column, filter)
            }
        })
    )
}

export async function paginate<T extends ObjectLiteral>(
    query: PaginateQuery,
    repo: Repository<T> | SelectQueryBuilder<T>,
    config: PaginateConfig<T>
): Promise<Paginated<T>> {
    const page = positiveNumberOrDefault(query.page, 1, 1)

    const defaultLimit = config.defaultLimit || DEFAULT_LIMIT
    const maxLimit = positiveNumberOrDefault(config.maxLimit, DEFAULT_MAX_LIMIT)
    const queryLimit = positiveNumberOrDefault(query.limit, defaultLimit)

    const isPaginated = !(queryLimit === NO_PAGINATION && maxLimit === NO_PAGINATION)

    const limit = isPaginated ? Math.min(queryLimit || defaultLimit, maxLimit || DEFAULT_MAX_LIMIT) : NO_PAGINATION

    const sortBy = [] as SortBy<T>
    const searchBy: Column<T>[] = []
    let path: string

    const r = new RegExp('^(?:[a-z+]+:)?//', 'i')
    let queryOrigin = ''
    let queryPath = ''
    if (r.test(query.path)) {
        const url = new URL(query.path)
        queryOrigin = url.origin
        queryPath = url.pathname
    } else {
        queryPath = query.path
    }

    if (config.relativePath) {
        path = queryPath
    } else if (config.origin) {
        path = config.origin + queryPath
    } else {
        path = queryOrigin + queryPath
    }

    function isEntityKey(entityColumns: Column<T>[], column: string): column is Column<T> {
        return !!entityColumns.find((c) => c === column)
    }

    if (config.sortableColumns.length < 1) {
        logger.debug("Missing required 'sortableColumns' config.")
        throw new ServiceUnavailableException()
    }

    if (query.sortBy) {
        for (const order of query.sortBy) {
            if (isEntityKey(config.sortableColumns, order[0]) && ['ASC', 'DESC'].includes(order[1])) {
                sortBy.push(order as Order<T>)
            }
        }
    }

    if (!sortBy.length) {
        sortBy.push(...(config.defaultSortBy || [[config.sortableColumns[0], 'ASC']]))
    }

    if (config.searchableColumns) {
        if (query.searchBy) {
            for (const column of query.searchBy) {
                if (isEntityKey(config.searchableColumns, column)) {
                    searchBy.push(column)
                }
            }
        } else {
            searchBy.push(...config.searchableColumns)
        }
    }

    let [items, totalItems]: [T[], number] = [[], 0]

    const queryBuilder = repo instanceof Repository ? repo.createQueryBuilder('e') : repo

    if (isPaginated) {
        // Switch from take and skip to limit and offset
        // due to this problem https://github.com/typeorm/typeorm/issues/5670
        // (anyway this creates more clean query without double dinstict)
        queryBuilder.limit(limit).offset((page - 1) * limit)
        // queryBuilder.take(limit).skip((page - 1) * limit)
    }

    if (config.relations?.length) {
        config.relations.forEach((relation) => {
            queryBuilder.leftJoinAndSelect(`${queryBuilder.alias}.${relation}`, `${queryBuilder.alias}_${relation}`)
        })
    }

    let nullSort: 'NULLS LAST' | 'NULLS FIRST' | undefined = undefined
    if (config.nullSort) {
        nullSort = config.nullSort === 'last' ? 'NULLS LAST' : 'NULLS FIRST'
    }

    for (const order of sortBy) {
        const columnProperties = getPropertiesByColumnName(order[0])
        const { isVirtualProperty } = extractVirtualProperty(queryBuilder, columnProperties)
        const isRelation = checkIsRelation(queryBuilder, columnProperties.propertyPath)

        const alias = fixColumnAlias(columnProperties, queryBuilder.alias, isRelation, isVirtualProperty)

        queryBuilder.addOrderBy(alias, order[1], nullSort)
    }

    if (config.select?.length > 0) {
        const mappedSelect = config.select.map((col) => {
            if (col.includes('.')) {
                const [rel, relCol] = col.split('.')
                return `${queryBuilder.alias}_${rel}.${relCol}`
            }

            return `${queryBuilder.alias}.${col}`
        })
        queryBuilder.select(mappedSelect)
    }

    if (config.where) {
        queryBuilder.andWhere(new Brackets((qb) => qb.andWhere(config.where)))
    }

    if (config.withDeleted) {
        queryBuilder.withDeleted()
    }

    if (query.search && searchBy.length) {
        queryBuilder.andWhere(
            new Brackets((qb: SelectQueryBuilder<T>) => {
                for (const column of searchBy) {
                    const property = getPropertiesByColumnName(column)
                    const { isVirtualProperty, query: virtualQuery } = extractVirtualProperty(qb, property)
                    const isRelation = checkIsRelation(qb, property.propertyPath)

                    const alias = fixColumnAlias(property, qb.alias, isRelation, isVirtualProperty, virtualQuery)
                    const condition: WherePredicateOperator = {
                        operator: 'ilike',
                        parameters: [alias, `:${column}`],
                    }

                    qb.orWhere(qb['createWhereConditionExpression'](condition), {
                        [column]: `%${query.search}%`,
                    })
                }
            })
        )
    }

    if (query.filter) {
        addFilter(queryBuilder, query, config.filterableColumns)
    }

    if (isPaginated) {
        ;[items, totalItems] = await queryBuilder.getManyAndCount()
    } else {
        items = await queryBuilder.getMany()
    }

    const sortByQuery = sortBy.map((order) => `&sortBy=${order.join(':')}`).join('')
    const searchQuery = query.search ? `&search=${query.search}` : ''

    const searchByQuery =
        query.searchBy && searchBy.length ? searchBy.map((column) => `&searchBy=${column}`).join('') : ''

    const filterQuery = query.filter
        ? '&' +
          stringify(
              mapKeys(query.filter, (_param, name) => 'filter.' + name),
              '&',
              '=',
              { encodeURIComponent: (str) => str }
          )
        : ''

    const options = `&limit=${limit}${sortByQuery}${searchQuery}${searchByQuery}${filterQuery}`

    const buildLink = (p: number): string => path + '?page=' + p + options

    const totalPages = isPaginated ? Math.ceil(totalItems / limit) : 1

    const results: Paginated<T> = {
        data: items,
        meta: {
            itemsPerPage: isPaginated ? limit : items.length,
            totalItems: isPaginated ? totalItems : items.length,
            currentPage: page,
            totalPages,
            sortBy,
            search: query.search,
            searchBy: query.search ? searchBy : undefined,
            filter: query.filter,
        },
        links: {
            first: page == 1 ? undefined : buildLink(1),
            previous: page - 1 < 1 ? undefined : buildLink(page - 1),
            current: buildLink(page),
            next: page + 1 > totalPages ? undefined : buildLink(page + 1),
            last: page == totalPages || !totalItems ? undefined : buildLink(totalPages),
        },
    }

    return Object.assign(new Paginated<T>(), results)
}
