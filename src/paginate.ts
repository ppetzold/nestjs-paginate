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
    filterableColumns?: { [key in Column<T>]?: FilterOperator[] }
    withDeleted?: boolean
    relativePath?: boolean
    origin?: string
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
    NOT = '$not',
    ILIKE = '$ilike',
}

export function isOperator(value: unknown): value is FilterOperator {
    return values(FilterOperator).includes(value as any)
}

export const OperatorSymbolToFunction = new Map<FilterOperator, (...args: any[]) => FindOperator<string>>([
    [FilterOperator.EQ, Equal],
    [FilterOperator.GT, MoreThan],
    [FilterOperator.GTE, MoreThanOrEqual],
    [FilterOperator.IN, In],
    [FilterOperator.NULL, IsNull],
    [FilterOperator.LT, LessThan],
    [FilterOperator.LTE, LessThanOrEqual],
    [FilterOperator.BTW, Between],
    [FilterOperator.NOT, Not],
    [FilterOperator.ILIKE, ILike],
])

export function getFilterTokens(raw: string): string[] {
    const tokens = []
    const matches = raw.match(/(\$\w+):/g)

    if (matches) {
        const value = raw.replace(matches.join(''), '')
        tokens.push(...matches.map((token) => token.substring(0, token.length - 1)), value)
    } else {
        tokens.push(raw)
    }

    if (tokens.length === 0 || tokens.length > 3) {
        return []
    } else if (tokens.length === 2) {
        if (tokens[1] !== FilterOperator.NULL) {
            tokens.unshift(null)
        }
    } else if (tokens.length === 1) {
        if (tokens[0] === FilterOperator.NULL) {
            tokens.unshift(null)
        } else {
            tokens.unshift(null, FilterOperator.EQ)
        }
    }

    return tokens
}

type Filter = { [columnName: string]: FindOperator<string> }

function parseFilter<T>(query: PaginateQuery, config: PaginateConfig<T>): Filter {
    const filter: Filter = {}
    let filterableColumns = config.filterableColumns
    if (filterableColumns === undefined) {
        logger.debug("No 'filterableColumns' given, ignoring filters.")
        filterableColumns = {}
    }
    for (const column of Object.keys(query.filter)) {
        if (!(column in filterableColumns)) {
            continue
        }
        const allowedOperators = filterableColumns[column]
        const input = query.filter[column]
        const statements = !Array.isArray(input) ? [input] : input
        for (const raw of statements) {
            const tokens = getFilterTokens(raw)
            if (tokens.length === 0) {
                continue
            }
            const [op2, op1, value] = tokens

            if (!isOperator(op1) || !allowedOperators.includes(op1)) {
                continue
            }
            if (isOperator(op2) && !allowedOperators.includes(op2)) {
                continue
            }
            if (isOperator(op1)) {
                switch (op1) {
                    case FilterOperator.BTW:
                        filter[column] = OperatorSymbolToFunction.get(op1)(...value.split(','))
                        break
                    case FilterOperator.IN:
                        filter[column] = OperatorSymbolToFunction.get(op1)(value.split(','))
                        break
                    case FilterOperator.ILIKE:
                        filter[column] = OperatorSymbolToFunction.get(op1)(`%${value}%`)
                        break
                    default:
                        filter[column] = OperatorSymbolToFunction.get(op1)(value)
                        break
                }
            }
            if (isOperator(op2)) {
                filter[column] = OperatorSymbolToFunction.get(op2)(filter[column])
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
        ? { propertyPath: propertyPath[0], propertyName: propertyPath[1] }
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
                    [column + '_from']: filter[column].value[0],
                    [column + '_to']: filter[column].value[1],
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

// This function is used to fix the column alias when using relation, embeded or virtual properties
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
        } else {
            return `${alias}_${properties.propertyPath}.${properties.propertyName}`
        }
    } else if (isVirtualProperty) {
        return query ? `(${query(`${alias}`)})` : `${alias}_${properties.propertyName}`
    } else {
        return `${alias}.${properties.propertyName}` // is embeded property
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
        filter[column]
    ) as WherePredicateOperator
}

function addWhereCondition(
    qb: SelectQueryBuilder<unknown>,
    column: string,
    propiertes: ColumnProperties,
    filter: Filter,
    isRelation: boolean,
    isVirtualProperty: boolean,
    query?: ColumnMetadata['query']
) {
    const alias = fixColumnAlias(propiertes, qb.alias, isRelation, isVirtualProperty, query)
    const condition = generatePredicateCondition(qb, column, filter, alias, isVirtualProperty)

    const parameters = fixQueryParam(alias, column, filter, condition, {
        [column]: filter[column].value,
    })

    qb.andWhere(qb['createWhereConditionExpression'](condition), parameters)
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
        // (anyway this create more clean query without double dinstict)
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

                    console.log(property)
                    console.log(qb.alias)
                    console.log(column)
                    console.log(isRelation)
                    console.log(alias)

                    qb.orWhere(qb['createWhereConditionExpression'](condition), {
                        [column]: `%${query.search}%`,
                    })
                }
            })
        )
    }

    if (query.filter) {
        const filter = parseFilter(query, config)
        queryBuilder.andWhere(
            new Brackets((qb: SelectQueryBuilder<T>) => {
                for (const column in filter) {
                    const columnProperties = getPropertiesByColumnName(column)
                    const { isVirtualProperty, query: virtualQuery } = extractVirtualProperty(
                        queryBuilder,
                        columnProperties
                    )
                    addWhereCondition(
                        qb,
                        column,
                        columnProperties,
                        filter,
                        columnProperties.propertyPath
                            ? checkIsRelation(queryBuilder, columnProperties.propertyPath)
                            : false,
                        isVirtualProperty,
                        virtualQuery
                    )
                }
            })
        )
    }

    if (isPaginated) {
        //console.log(queryBuilder.getQuery())
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
