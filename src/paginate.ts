import { Repository, FindConditions, SelectQueryBuilder } from 'typeorm'
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
    const limit = query.limit || config.defaultLimit || 20
    const path = query.path

    function isEntityKey(sortableColumns: Column<T>[], column: string): column is Column<T> {
        return !!sortableColumns.find((c) => c === column)
    }

    const { sortableColumns } = config
    if (config.sortableColumns.length < 1) throw new ServiceUnavailableException()

    let sortBy: SortBy<T> = []
    if (query.sortBy) {
        for (const order of query.sortBy) {
            if (isEntityKey(sortableColumns, order[0]) && ['ASC', 'DESC'].includes(order[1])) {
                sortBy.push(order as Order<T>)
            }
        }
    }
    if (!sortBy.length) {
        sortBy = sortBy.concat(config.defaultSortBy || [[sortableColumns[0], 'ASC']])
    }

    let [items, totalItems]: [T[], number] = [[], 0]

    if (repo instanceof Repository) {
        const query = repo
            .createQueryBuilder('e')
            .take(limit)
            .skip((page - 1) * limit)

        for (const order of sortBy) {
            query.addOrderBy('e.' + order[0], order[1])
        }

        ;[items, totalItems] = await query.where(config.where || {}).getManyAndCount()
    } else {
        const query = repo.take(limit).skip((page - 1) * limit)

        for (const order of sortBy) {
            query.addOrderBy(repo.alias + '.' + order[0], order[1])
        }

        ;[items, totalItems] = await query.getManyAndCount()
    }

    let totalPages = totalItems / limit
    if (totalItems % limit) totalPages = Math.ceil(totalPages)

    if (page > totalPages) page = totalPages
    if (page < 1) page = 1

    const options = `&limit=${limit}${sortBy.map((order) => `&sortBy=${order.join(':')}`).join('')}`

    const buildLink = (p: number): string => path + '?page=' + p + options

    const results: Paginated<T> = {
        data: items,
        meta: {
            itemsPerPage: limit,
            totalItems,
            currentPage: page,
            totalPages: totalPages,
            sortBy,
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
