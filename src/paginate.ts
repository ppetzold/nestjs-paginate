import { Repository, FindConditions, SelectQueryBuilder, Like, ObjectLiteral } from 'typeorm'
import { PaginateQuery } from './decorator'
import { ServiceUnavailableException } from '@nestjs/common'

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
    where?: FindConditions<T>
    queryBuilder?: SelectQueryBuilder<T>
}

export async function paginate<T>(
    query: PaginateQuery,
    repo: Repository<T> | SelectQueryBuilder<T>,
    config: PaginateConfig<T>
): Promise<Paginated<T>> {
    let page = query.page || 1
    const limit = Math.min(query.limit || config.defaultLimit || 20, config.maxLimit || 100);
    const sortBy = [] as SortBy<T>
    const search = query.search
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

    const where: ObjectLiteral[] = []
    if (search && config.searchableColumns) {
        for (const column of config.searchableColumns) {
            where.push({ [column]: Like(`%${search}%`), ...config.where })
        }
    }

    ;[items, totalItems] = await queryBuilder.where(where.length ? where : config.where || {}).getManyAndCount()

    let totalPages = totalItems / limit
    if (totalItems % limit) totalPages = Math.ceil(totalPages)

    const options = `&limit=${limit}${sortBy.map((order) => `&sortBy=${order.join(':')}`).join('')}${
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
            sortBy,
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
