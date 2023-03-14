import {
    Repository,
    SelectQueryBuilder,
    Brackets,
    FindOptionsWhere,
    FindOptionsRelations,
    ObjectLiteral,
    FindOptionsUtils,
} from 'typeorm'
import { PaginateQuery } from './decorator'
import { ServiceUnavailableException, Logger } from '@nestjs/common'
import { mapKeys } from 'lodash'
import { stringify } from 'querystring'
import { WherePredicateOperator } from 'typeorm/query-builder/WhereClause'
import {
    checkIsRelation,
    checkIsEmbedded,
    Column,
    extractVirtualProperty,
    fixColumnAlias,
    getPropertiesByColumnName,
    Order,
    positiveNumberOrDefault,
    RelationColumn,
    SortBy,
    hasColumnWithPropertyPath,
    includesAllPrimaryKeyColumns,
} from './helper'
import { FilterOperator, FilterSuffix } from './operator'
import { addFilter } from './filter'

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

export enum PaginationType {
    LIMIT_AND_OFFSET = 'limit',
    TAKE_AND_SKIP = 'take',
}

export interface PaginateConfig<T> {
    relations?: FindOptionsRelations<T> | RelationColumn<T>[]
    sortableColumns: Column<T>[]
    nullSort?: 'first' | 'last'
    searchableColumns?: Column<T>[]
    select?: Column<T>[] | string[]
    maxLimit?: number
    defaultSortBy?: SortBy<T>
    defaultLimit?: number
    where?: FindOptionsWhere<T> | FindOptionsWhere<T>[]
    filterableColumns?: {
        [key in Column<T> | string]?: (FilterOperator | FilterSuffix)[]
    }
    loadEagerRelations?: boolean
    withDeleted?: boolean
    relativePath?: boolean
    origin?: string
    paginationType?: PaginationType
}

export const DEFAULT_MAX_LIMIT = 100
export const DEFAULT_LIMIT = 20
export const NO_PAGINATION = 0
export const DEFAULT_PAGINATE_TYPE = PaginationType.TAKE_AND_SKIP

export async function paginate<T extends ObjectLiteral>(
    query: PaginateQuery,
    repo: Repository<T> | SelectQueryBuilder<T>,
    config: PaginateConfig<T>
): Promise<Paginated<T>> {
    const page = positiveNumberOrDefault(query.page, 1, 1)

    const defaultLimit = config.defaultLimit || DEFAULT_LIMIT
    const maxLimit = positiveNumberOrDefault(config.maxLimit, DEFAULT_MAX_LIMIT)
    const queryLimit = positiveNumberOrDefault(query.limit, defaultLimit)
    const paginationType = config.paginationType || DEFAULT_PAGINATE_TYPE

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

    const queryBuilder = repo instanceof Repository ? repo.createQueryBuilder('__root') : repo

    if (repo instanceof Repository && !config.relations && config.loadEagerRelations === true) {
        if (!config.relations) {
            FindOptionsUtils.joinEagerRelations(queryBuilder, queryBuilder.alias, repo.metadata)
        }
    }

    if (isPaginated) {
        // Switch from take and skip to limit and offset
        // due to this problem https://github.com/typeorm/typeorm/issues/5670
        // (anyway this creates more clean query without double distinct)
        // queryBuilder.limit(limit).offset((page - 1) * limit)
        if (paginationType === PaginationType.LIMIT_AND_OFFSET) {
            queryBuilder.limit(limit).offset((page - 1) * limit)
        } else {
            queryBuilder.take(limit).skip((page - 1) * limit)
        }
    }

    if (config.relations) {
        // relations: ["relation"]
        if (Array.isArray(config.relations)) {
            config.relations.forEach((relation) => {
                queryBuilder.leftJoinAndSelect(`${queryBuilder.alias}.${relation}`, `${queryBuilder.alias}_${relation}`)
            })
        } else {
            // relations: {relation:true}
            const createQueryBuilderRelations = (
                prefix: string,
                relations: FindOptionsRelations<T> | RelationColumn<T>[],
                alias?: string
            ) => {
                Object.keys(relations).forEach((relationName) => {
                    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                    const relationSchema = relations![relationName]!

                    queryBuilder.leftJoinAndSelect(
                        `${alias ?? prefix}.${relationName}`,
                        `${alias ?? prefix}_${relationName}`
                    )

                    if (typeof relationSchema === 'object') {
                        createQueryBuilderRelations(relationName, relationSchema, `${prefix}_${relationName}`)
                    }
                })
            }
            createQueryBuilderRelations(queryBuilder.alias, config.relations)
        }
    }

    let nullSort: 'NULLS LAST' | 'NULLS FIRST' | undefined = undefined
    if (config.nullSort) {
        nullSort = config.nullSort === 'last' ? 'NULLS LAST' : 'NULLS FIRST'
    }

    for (const order of sortBy) {
        const columnProperties = getPropertiesByColumnName(order[0])
        const { isVirtualProperty } = extractVirtualProperty(queryBuilder, columnProperties)
        const isRelation = checkIsRelation(queryBuilder, columnProperties.propertyPath)
        const isEmbeded = checkIsEmbedded(queryBuilder, columnProperties.propertyPath)
        const alias = fixColumnAlias(columnProperties, queryBuilder.alias, isRelation, isVirtualProperty, isEmbeded)
        queryBuilder.addOrderBy(alias, order[1], nullSort)
    }

    // When we partial select the columns (main or relation) we must add the primary key column otherwise
    // typeorm will not be able to map the result.
    const selectParams = config.select || query.select
    if (selectParams?.length > 0 && includesAllPrimaryKeyColumns(queryBuilder, selectParams)) {
        const cols: string[] = selectParams.reduce((cols, currentCol) => {
            if (query.select?.includes(currentCol) ?? true) {
                const columnProperties = getPropertiesByColumnName(currentCol)
                const isRelation = checkIsRelation(queryBuilder, columnProperties.propertyPath)
                const { isVirtualProperty } = extractVirtualProperty(queryBuilder, columnProperties)
                if (hasColumnWithPropertyPath(queryBuilder, columnProperties) || isVirtualProperty) {
                    // here we can avoid to manually fix and add the query of virtual columns
                    cols.push(fixColumnAlias(columnProperties, queryBuilder.alias, isRelation))
                }
            }
            return cols
        }, [])
        queryBuilder.select(cols)
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
                    const isEmbeded = checkIsEmbedded(qb, property.propertyPath)
                    const alias = fixColumnAlias(
                        property,
                        qb.alias,
                        isRelation,
                        isVirtualProperty,
                        isEmbeded,
                        virtualQuery
                    )

                    const condition: WherePredicateOperator = {
                        operator: 'ilike',
                        parameters: [alias, `:${property.column}`],
                    }

                    if (['postgres', 'cockroachdb'].includes(queryBuilder.connection.options.type)) {
                        condition.parameters[0] += '::text'
                    }

                    qb.orWhere(qb['createWhereConditionExpression'](condition), {
                        [property.column]: `%${query.search}%`,
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
