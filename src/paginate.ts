import { Repository, FindConditions, SelectQueryBuilder, Like, ObjectLiteral } from 'typeorm'
import { PaginateQuery } from './decorator'
import { ServiceUnavailableException } from '@nestjs/common'
import { EntityFieldsNames } from 'typeorm/common/EntityFieldsNames'

type Column<T> = Extract<keyof T, string>
type OrderPair = [EntityFieldsNames, 'ASC' | 'DESC' | 1 | -1]
type Order<T> = [Column<T>, 'ASC' | 'DESC']
type Sort<T> = Order<T>[]

export interface PaginateConfig<T> {
    sortableColumns: Column<T>[]
    searchableColumns?: Column<T>[]
    maxLimit?: number
    defaultSortBy?: Sort<T>
    defaultLimit?: number
    where?: FindConditions<T>
    queryBuilder?: SelectQueryBuilder<T>
}

export class Paginated<T> {
    data: T[]
    meta: {
        itemsPerPage: number
        totalItems: number
        currentPage: number
        totalPages: number
        sort: Sort<T>
        search: string
    }
    links: {
        first?: string
        previous?: string
        current: string
        next?: string
        last?: string
    }
}

export function createPaginatedObject<T>(
    items: T[],
    totalItems: number,
    page: number,
    limit: number,
    sort: Sort<T>,
    search: string,
    path: string
): Paginated<T> {
    let totalPages = totalItems / limit
    if (totalItems % limit) totalPages = Math.ceil(totalPages)

    const options = `&limit=${limit}${sort.map((order) => `&sort=${order.join(':')}`).join('')}${
        search ? `&search=${search}` : ''
    }`

    const buildLink = (p: number): string => path + '?page=' + p + options

    const results: Paginated<T> = {
        data: items,
        meta: {
            itemsPerPage: limit,
            totalItems,
            currentPage: page,
            totalPages: totalPages,
            sort,
            search,
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

export async function paginate<T>(
    query: PaginateQuery,
    repository: Repository<T> | SelectQueryBuilder<T>,
    config: PaginateConfig<T>
): Promise<Paginated<T>> {
    return repository instanceof SelectQueryBuilder
        ? paginateQueryBuilder<T>(query, repository, config)
        : paginateRepository<T>(query, repository, config)
}

export async function paginateRepository<T>(
    query: PaginateQuery,
    repo: Repository<T>,
    config: PaginateConfig<T>
): Promise<Paginated<T>> {
    const page = Math.abs(query.page ?? 1)
    const limit = Math.min(query.limit || config.defaultLimit || 20, config.maxLimit || 100)
    const sort = [] as Sort<T>
    const search = query.search
    const path = query.path

    function isEntityKey(sortableColumns: Column<T>[], column: string): column is Column<T> {
        return !!sortableColumns.find((c) => c === column)
    }

    const { sortableColumns } = config
    if (config.sortableColumns.length < 1) throw new ServiceUnavailableException()

    if (query.sort) {
        query.sort.map((order) => {
            if (isEntityKey(sortableColumns, order[0]) && ['ASC', 'DESC'].includes(order[1])) {
                sort.push(order as Order<T>)
            }
        })
    }

    if (!sort.length) {
        sort.push(...(config.defaultSortBy || [[sortableColumns[0], 'ASC']]))
    }

    const order = {}
    sort.map(([key, value]: OrderPair) => {
        order[key] = value
    })

    const w: ObjectLiteral[] = []
    if (search && config.searchableColumns) {
        for (const column of config.searchableColumns) {
            w.push({ [column]: Like(`%${search}%`), ...config.where })
        }
    }

    const where = w.length ? w : config.where || {}

    const [items, total] = await repo.findAndCount({
        skip: (page - 1) * limit,
        take: limit,
        where: where,
        order: order,
    })

    return createPaginatedObject(items, total, page, limit, sort, search, path)
}

export async function paginateQueryBuilder<T>(
    query: PaginateQuery,
    queryBuilder: SelectQueryBuilder<T>,
    config: PaginateConfig<T>
): Promise<Paginated<T>> {
    const page = Math.abs(query.page ?? 1)
    const limit = Math.min(query.limit || config.defaultLimit || 20, config.maxLimit || 100)
    const path = query.path
    const sort = [] as Sort<T>
    const search = query.search

    function isEntityKey(sortableColumns: Column<T>[], column: string): column is Column<T> {
        return !!sortableColumns.find((c) => c === column)
    }

    const { sortableColumns } = config
    if (config.sortableColumns.length < 1) throw new ServiceUnavailableException()

    if (query.sort) {
        for (const order of query.sort) {
            if (isEntityKey(sortableColumns, order[0]) && ['ASC', 'DESC'].includes(order[1])) {
                sort.push(order as Order<T>)
            }
        }
    }
    if (!sort.length) {
        sort.push(...(config.defaultSortBy || [[sortableColumns[0], 'ASC']]))
    }

    sort.map((order, index) => {
        if (index == 0) {
            queryBuilder.orderBy(queryBuilder.alias + '.' + order[0], order[1])
        } else {
            queryBuilder.addOrderBy(queryBuilder.alias + '.' + order[0], order[1])
        }
    })

    const w: ObjectLiteral[] = []
    if (search && config.searchableColumns) {
        for (const column of config.searchableColumns) {
            w.push({ [column]: Like(`%${search}%`), ...config.where })
        }
    }

    const where = w.length ? w : config.where || {}

    const [items, total] = await queryBuilder
        .take(limit)
        .skip((page - 1) * limit)
        .where(where)
        .getManyAndCount()

    return createPaginatedObject(items, total, page, limit, sort, search, path)
}
