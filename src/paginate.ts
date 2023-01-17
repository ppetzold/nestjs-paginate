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
import { values, mapKeys, isArray } from 'lodash'
import { stringify } from 'querystring'
import { WherePredicateOperator } from 'typeorm/query-builder/WhereClause'
import { Column, Order, positiveNumberOrDefault, RelationColumn, SortBy } from './helper'

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

export function isSuffix(value: unknown): value is FilterComparator {
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
    suffix?: FilterOperator
    operator: FilterOperator
    value: string
}

function extractOperand(matches: string[], index: number, checkFunction: (x: string) => boolean): string | null {
    const rawOperand = matches[index].substring(0, matches[index].length - 1)
    return checkFunction(rawOperand) ? rawOperand : null
}

export function getFilterTokens(raw?: string): FilterToken | null {
    if (raw === undefined || raw === null) {
        return null
    }

    const token: FilterToken = {
        comparator: FilterComparator.AND,
        suffix: undefined,
        operator: FilterOperator.EQ,
        value: undefined,
    }

    const matches = raw.match(/(\$\w+):/g)

    if (matches) {
        token.value = raw.replace(matches.join(''), '')
        if (matches.length === 1) {
            if (token.value === FilterOperator.NULL) {
                // $not:$null case
                token.comparator =
                    (extractOperand(matches, 0, isComparator) as FilterComparator) || FilterComparator.AND
                token.suffix = extractOperand(matches, 0, isSuffix) as FilterOperator
                token.operator = FilterOperator.NULL
            } else {
                token.suffix = extractOperand(matches, 0, isSuffix) as FilterOperator // $not:1 case
                token.operator = (extractOperand(matches, 0, isOperator) as FilterOperator) || FilterOperator.EQ
            }
        } else if (matches.length === 2) {
            token.comparator = (extractOperand(matches, 0, isComparator) as FilterComparator) || FilterComparator.AND
            if (token.value === FilterOperator.NULL) {
                // $or:$not:$null case
                token.suffix = extractOperand(matches, 1, isSuffix) as FilterOperator
                token.operator = FilterOperator.NULL
            } else {
                token.suffix = extractOperand(matches, 0, isSuffix) as FilterOperator
                token.operator = (extractOperand(matches, 1, isOperator) as FilterOperator) || FilterOperator.EQ
            }
        } else if (matches.length === 3) {
            token.comparator = (extractOperand(matches, 0, isComparator) as FilterComparator) || FilterComparator.AND
            token.suffix = extractOperand(matches, 1, isSuffix) as FilterOperator
            token.operator = (extractOperand(matches, 2, isOperator) as FilterOperator) || FilterOperator.EQ
        }
    } else {
        if (raw === FilterOperator.NULL) {
            // $null
            token.operator = FilterOperator.NULL
        }
        token.value = raw
    }

    return token
}

function parseFilter<T>(query: PaginateQuery, config: PaginateConfig<T>) {
    const filter: { [columnName: string]: { comparator: FilterComparator; findOperator: FindOperator<string> }[] } = {}
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
            const token = getFilterTokens(raw)

            //  console.log('token', JSON.stringify(token))

            if (
                !token ||
                !allowedOperators.includes(token.operator) ||
                (token.suffix && !allowedOperators.includes(token.suffix))
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

            //  console.log('params', JSON.stringify(params))

            filter[column] = [...(filter[column] || []), params]

            //  console.log('filter[column]', JSON.stringify(filter[column]))

            if (token.suffix) {
                const lastFilterElement = filter[column].length - 1
                filter[column][lastFilterElement].findOperator = OperatorSymbolToFunction.get(token.suffix)(
                    filter[column][lastFilterElement].findOperator
                )
                //  console.log('filter[column]', JSON.stringify(filter[column]))
            }
        }
    }
    //  console.log('filter', JSON.stringify(filter))
    return filter
}

export const DEFAULT_MAX_LIMIT = 100
export const DEFAULT_LIMIT = 20
export const NO_PAGINATION = 0

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
        queryBuilder.take(limit).skip((page - 1) * limit)
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
        if (queryBuilder.expressionMap.mainAlias.metadata.hasRelationWithPropertyPath(order[0].split('.')[0])) {
            queryBuilder.addOrderBy(`${queryBuilder.alias}_${order[0]}`, order[1], nullSort)
        } else {
            queryBuilder.addOrderBy(`${queryBuilder.alias}.${order[0]}`, order[1], nullSort)
        }
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
                    const propertyPath = (column as string).split('.')
                    if (propertyPath.length > 1) {
                        const alias = queryBuilder.expressionMap.mainAlias.metadata.hasRelationWithPropertyPath(
                            propertyPath[0]
                        )
                            ? `${qb.alias}_${column}`
                            : `${qb.alias}.${column}`
                        const condition: WherePredicateOperator = {
                            operator: 'ilike',
                            parameters: [alias, `:${column}`],
                        }
                        qb.orWhere(qb['createWhereConditionExpression'](condition), {
                            [column]: `%${query.search}%`,
                        })
                    } else {
                        qb.orWhere({
                            [column]: ILike(`%${query.search}%`),
                        })
                    }
                }
            })
        )
    }

    if (query.filter) {
        const filter = parseFilter(query, config)
        //  console.log(filter)
        for (const column in filter) {
            const propertyPath = (column as string).split('.')
            queryBuilder.andWhere(
                new Brackets((qb: SelectQueryBuilder<T>) => {
                    //  console.log(filter[column])
                    filter[column].forEach((cFilter, index) => {
                        if (propertyPath.length > 1) {
                            const columnNamePerIteration = `${column}${index}`

                            let parameters = {
                                [columnNamePerIteration]: cFilter.findOperator.value,
                            }
                            // TODO: refactor below
                            const isRelation = qb.expressionMap.mainAlias.metadata.hasRelationWithPropertyPath(
                                propertyPath[0]
                            )
                            const alias = isRelation ? `${qb.alias}_${column}` : `${qb.alias}.${column}`

                            const condition = qb['getWherePredicateCondition'](
                                alias,
                                cFilter.findOperator
                            ) as WherePredicateOperator

                            if (condition.operator === 'between') {
                                condition.parameters = [
                                    alias,
                                    `:${columnNamePerIteration}_from`,
                                    `:${columnNamePerIteration}_to`,
                                ]
                                parameters = {
                                    [`${columnNamePerIteration}_from`]: cFilter.findOperator.value[0],
                                    [`${columnNamePerIteration}_to`]: cFilter.findOperator.value[1],
                                }
                            } else if (condition.operator === 'in') {
                                condition.parameters = [alias, `:...${columnNamePerIteration}`]
                            } else {
                                condition.parameters = [alias, `:${columnNamePerIteration}`]
                            }

                            //  console.log('cFilter', cFilter)
                            //  console.log('filter[column]', filter[column])
                            //  console.log('condition', condition)
                            //  console.log('parameters', parameters)
                            //  console.log('------------------')

                            if (cFilter.comparator === FilterComparator.OR) {
                                qb.orWhere(qb['createWhereConditionExpression'](condition), parameters)
                            } else {
                                qb.andWhere(qb['createWhereConditionExpression'](condition), parameters)
                            }
                        } else {
                            //  console.log('cFilter', cFilter)
                            //  console.log('------------------')
                            if (cFilter.comparator === FilterComparator.OR) {
                                qb.orWhere({
                                    [column]: cFilter.findOperator,
                                })
                            } else {
                                qb.andWhere({
                                    [column]: cFilter.findOperator,
                                })
                            }
                        }
                    })
                })
            )
        }
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
