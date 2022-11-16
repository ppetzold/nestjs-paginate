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
import { ServiceUnavailableException } from '@nestjs/common'
import { values, mapKeys } from 'lodash'
import { stringify } from 'querystring'
import { WherePredicateOperator } from 'typeorm/query-builder/WhereClause'
import { Column, Order, RelationColumn, SortBy } from './helper'

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

function parseFilter<T>(query: PaginateQuery, config: PaginateConfig<T>) {
    const filter: { [columnName: string]: FindOperator<string> } = {}
    for (const column of Object.keys(query.filter)) {
        if (!(column in config.filterableColumns)) {
            continue
        }
        const allowedOperators = config.filterableColumns[column]
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

export async function paginate<T extends ObjectLiteral>(
    query: PaginateQuery,
    repo: Repository<T> | SelectQueryBuilder<T>,
    config: PaginateConfig<T>
): Promise<Paginated<T>> {
    let page = query.page || 1
    const limit = Math.min(query.limit || config.defaultLimit || 20, config.maxLimit || 100)
    const sortBy = [] as SortBy<T>
    const searchBy: Column<T>[] = []
    let path

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

    if (config.sortableColumns.length < 1) throw new ServiceUnavailableException()

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

    if (page < 1) page = 1

    let [items, totalItems]: [T[], number] = [[], 0]

    let queryBuilder: SelectQueryBuilder<T>

    if (repo instanceof Repository) {
        queryBuilder = repo
            .createQueryBuilder('e')
            .take(limit)
            .skip((page - 1) * limit)
    } else {
        queryBuilder = repo.take(limit).skip((page - 1) * limit)
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
        queryBuilder.andWhere(
            new Brackets((qb: SelectQueryBuilder<T>) => {
                for (const column in filter) {
                    const propertyPath = (column as string).split('.')
                    if (propertyPath.length > 1) {
                        const condition = qb['getWherePredicateCondition'](
                            column,
                            filter[column]
                        ) as WherePredicateOperator
                        let parameters = { [column]: filter[column].value }
                        // TODO: refactor below
                        const alias = queryBuilder.expressionMap.mainAlias.metadata.hasRelationWithPropertyPath(
                            propertyPath[0]
                        )
                            ? `${qb.alias}_${column}`
                            : `${qb.alias}.${column}`
                        switch (condition.operator) {
                            case 'between':
                                condition.parameters = [alias, `:${column}_from`, `:${column}_to`]
                                parameters = {
                                    [column + '_from']: filter[column].value[0],
                                    [column + '_to']: filter[column].value[1],
                                }
                                break
                            case 'in':
                                condition.parameters = [alias, `:...${column}`]
                                break
                            default:
                                condition.parameters = [alias, `:${column}`]
                                break
                        }
                        qb.andWhere(qb['createWhereConditionExpression'](condition), parameters)
                    } else {
                        qb.andWhere({
                            [column]: filter[column],
                        })
                    }
                }
            })
        )
    }

    ;[items, totalItems] = await queryBuilder.getManyAndCount()

    let totalPages = totalItems / limit
    if (totalItems % limit) totalPages = Math.ceil(totalPages)

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

    const results: Paginated<T> = {
        data: items,
        meta: {
            itemsPerPage: limit,
            totalItems,
            currentPage: page,
            totalPages: totalPages,
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
