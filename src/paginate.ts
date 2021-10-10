import {
    Repository,
    FindConditions,
    SelectQueryBuilder,
    ObjectLiteral,
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
    Brackets
} from 'typeorm'
import { PaginateQuery } from './decorator'
import { ServiceUnavailableException } from '@nestjs/common'
import { values, mapKeys } from 'lodash'
import { stringify } from 'querystring'

type Column<T> = Extract<keyof T, string>
type Order<T> = [Column<T>, 'ASC' | 'DESC']
type SortBy<T> = Order<T>[]

export class Paginated<T> {
    data: T[]
    meta: {
        itemsPerPage: number
        totalItems: number
        currentPage: number
        totalPages: number
        sortBy: SortBy<T>
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
    sortableColumns: Column<T>[]
    searchableColumns?: Column<T>[]
    maxLimit?: number
    defaultSortBy?: SortBy<T>
    defaultLimit?: number
    where?: FindConditions<T> | FindConditions<T>[]
    filterableColumns?: { [key in Column<T>]?: FilterOperator[] }
}

export enum FilterOperator {
    EQ = '$eq',
    GT = '$gt',
    GTE = '$gte',
    IN = '$in',
    NULL = '$null',
    LT = '$lt',
    LTE = '$lte',
    NOT = '$not',
}

export async function paginate<T>(
    query: PaginateQuery,
    repo: Repository<T> | SelectQueryBuilder<T>,
    config: PaginateConfig<T>
): Promise<Paginated<T>> {
    let page = query.page || 1
    const limit = Math.min(query.limit || config.defaultLimit || 20, config.maxLimit || 100)
    const sortBy = [] as SortBy<T>
    const path = query.path

    function isEntityKey(sortableColumns: Column<T>[], column: string): column is Column<T> {
        return !!sortableColumns.find((c) => c === column)
    }

    const { sortableColumns } = config
    if (config.sortableColumns.length < 1) throw new ServiceUnavailableException()

    if (query.sortBy) {
        for (const order of query.sortBy) {
            if (isEntityKey(sortableColumns, order[0]) && ['ASC', 'DESC'].includes(order[1])) {
                sortBy.push(order as Order<T>)
            }
        }
    }
    if (!sortBy.length) {
        sortBy.push(...(config.defaultSortBy || [[sortableColumns[0], 'ASC']]))
    }

    if (page < 1) page = 1

    let [items, totalItems]: [T[], number] = [[], 0]

    let queryBuilder: SelectQueryBuilder<T>

    if (repo instanceof Repository) {
        queryBuilder = repo
            .createQueryBuilder('e')
            .take(limit)
            .skip((page - 1) * limit)

        for (const order of sortBy) {
            queryBuilder.addOrderBy('e.' + order[0], order[1])
        }
    } else {
        queryBuilder = repo.take(limit).skip((page - 1) * limit)

        for (const order of sortBy) {
            queryBuilder.addOrderBy(repo.alias + '.' + order[0], order[1])
        }
    }

    if (config.where) {
        queryBuilder = queryBuilder.andWhere(new Brackets(queryBuilder => queryBuilder.andWhere(config.where))) // Postgres fix (https://github.com/ppetzold/nestjs-paginate/pull/97)
    }

    if (query.search && config.searchableColumns) {
        const search: ObjectLiteral[] = []
        for (const column of config.searchableColumns) {
            search.push({ [column]: ILike(`%${query.search}%`) })
        }
        queryBuilder = queryBuilder.andWhere(search)
    }

    if (query.filter) {
        const filter = {}
        function getOperatorFn(op: FilterOperator): (...args: any[]) => FindOperator<T> {
            switch (op) {
                case FilterOperator.EQ:
                    return Equal
                case FilterOperator.GT:
                    return MoreThan
                case FilterOperator.GTE:
                    return MoreThanOrEqual
                case FilterOperator.IN:
                    return In
                case FilterOperator.NULL:
                    return IsNull
                case FilterOperator.LT:
                    return LessThan
                case FilterOperator.LTE:
                    return LessThanOrEqual
                case FilterOperator.NOT:
                    return Not
            }
        }
        function isOperator(value: any): value is FilterOperator {
            return values(FilterOperator).includes(value)
        }
        for (const column of Object.keys(query.filter)) {
            if (!(column in config.filterableColumns)) {
                continue
            }
            const allowedOperators = config.filterableColumns[column as Column<T>]
            const input = query.filter[column]
            const statements = !Array.isArray(input) ? [input] : input
            for (const raw of statements) {
                const tokens = raw.split(':')
                if (tokens.length === 0 || tokens.length > 3) {
                    continue
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
                const [op2, op1, value] = tokens

                if (!isOperator(op1) || !allowedOperators.includes(op1)) {
                    continue
                }
                if (isOperator(op2) && !allowedOperators.includes(op2)) {
                    continue
                }
                if (isOperator(op1)) {
                    const args = op1 === FilterOperator.IN ? value.split(',') : value
                    filter[column] = getOperatorFn(op1)(args)
                }
                if (isOperator(op2)) {
                    filter[column] = getOperatorFn(op2)(filter[column])
                }
            }
        }

        queryBuilder = queryBuilder.andWhere(filter)
    }

    ;[items, totalItems] = await queryBuilder.getManyAndCount()

    let totalPages = totalItems / limit
    if (totalItems % limit) totalPages = Math.ceil(totalPages)

    const sortByQuery = sortBy.map((order) => `&sortBy=${order.join(':')}`).join('')
    const searchQuery = query.search ? `&search=${query.search}` : ''
    const filterQuery = query.filter
        ? '&' +
        stringify(
            mapKeys(query.filter, (_param, name) => 'filter.' + name),
            '&',
            '=',
            { encodeURIComponent: (str) => str }
        )
        : ''

    const options = `&limit=${limit}${sortByQuery}${searchQuery}${filterQuery}`

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
            filter: query.filter,
        },
        links: {
            first: page == 1 ? undefined : buildLink(1),
            previous: page - 1 < 1 ? undefined : buildLink(page - 1),
            current: buildLink(page),
            next: page + 1 > totalPages ? undefined : buildLink(page + 1),
            last: page == totalPages ? undefined : buildLink(totalPages),
        },
    }

    return Object.assign(new Paginated<T>(), results)
}
