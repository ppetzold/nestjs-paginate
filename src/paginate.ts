import { Logger, ServiceUnavailableException } from '@nestjs/common'
import { mapKeys } from 'lodash'
import { stringify } from 'querystring'
import { Brackets, FindOptionsUtils, FindOptionsWhere, ObjectLiteral, Repository, SelectQueryBuilder } from 'typeorm'
import { WherePredicateOperator } from 'typeorm/query-builder/WhereClause'
import { PaginateQuery } from './decorator'
import { addFilter, FilterOperator, FilterSuffix } from './filter'
import {
    checkIsEmbedded,
    checkIsRelation,
    Column,
    createRelationSchema,
    extractVirtualProperty,
    fixColumnAlias,
    getPropertiesByColumnName,
    getQueryUrlComponents,
    includesAllPrimaryKeyColumns,
    isEntityKey,
    isFindOperator,
    isRepository,
    JoinMethod,
    MappedColumns,
    mergeRelationSchema,
    Order,
    positiveNumberOrDefault,
    RelationSchema,
    RelationSchemaInput,
    SortBy,
} from './helper'

const logger: Logger = new Logger('nestjs-paginate')

export { FilterOperator, FilterSuffix }

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
        select: string[]
        filter?: {
            [column: string]: string | string[]
        }
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

// We use (string & {}) to maintain autocomplete while allowing any string
// see https://github.com/microsoft/TypeScript/issues/29729
export interface PaginateConfig<T> {
    relations?: RelationSchemaInput<T>
    sortableColumns: Column<T>[]
    nullSort?: 'first' | 'last'
    searchableColumns?: Column<T>[]
    // eslint-disable-next-line @typescript-eslint/ban-types
    select?: (Column<T> | (string & {}))[]
    maxLimit?: number
    defaultSortBy?: SortBy<T>
    defaultLimit?: number
    where?: FindOptionsWhere<T> | FindOptionsWhere<T>[]
    filterableColumns?: Partial<MappedColumns<T, (FilterOperator | FilterSuffix)[] | true>>
    loadEagerRelations?: boolean
    withDeleted?: boolean
    paginationType?: PaginationType
    relativePath?: boolean
    origin?: string
    ignoreSearchByInQueryParam?: boolean
    ignoreSelectInQueryParam?: boolean
    multiWordSearch?: boolean
    defaultJoinMethod?: JoinMethod
    joinMethods?: Partial<MappedColumns<T, JoinMethod>>
}

export enum PaginationLimit {
    NO_PAGINATION = -1,
    COUNTER_ONLY = 0,
    DEFAULT_LIMIT = 20,
    DEFAULT_MAX_LIMIT = 100,
}

function generateWhereStatement<T>(
    queryBuilder: SelectQueryBuilder<T>,
    obj: FindOptionsWhere<T> | FindOptionsWhere<T>[]
) {
    const toTransform = Array.isArray(obj) ? obj : [obj]
    return toTransform.map((item) => flattenWhereAndTransform(queryBuilder, item).join(' AND ')).join(' OR ')
}

function flattenWhereAndTransform<T>(
    queryBuilder: SelectQueryBuilder<T>,
    obj: FindOptionsWhere<T>,
    separator = '.',
    parentKey = ''
) {
    return Object.entries(obj).flatMap(([key, value]) => {
        if (obj.hasOwnProperty(key)) {
            const joinedKey = parentKey ? `${parentKey}${separator}${key}` : key

            if (typeof value === 'object' && value !== null && !isFindOperator(value)) {
                return flattenWhereAndTransform(queryBuilder, value as FindOptionsWhere<T>, separator, joinedKey)
            } else {
                const property = getPropertiesByColumnName(joinedKey)
                const { isVirtualProperty, query: virtualQuery } = extractVirtualProperty(queryBuilder, property)
                const isRelation = checkIsRelation(queryBuilder, property.propertyPath)
                const isEmbedded = checkIsEmbedded(queryBuilder, property.propertyPath)
                const alias = fixColumnAlias(
                    property,
                    queryBuilder.alias,
                    isRelation,
                    isVirtualProperty,
                    isEmbedded,
                    virtualQuery
                )
                const whereClause = queryBuilder['createWhereConditionExpression'](
                    queryBuilder['getWherePredicateCondition'](alias, value)
                )

                const allJoinedTables = queryBuilder.expressionMap.joinAttributes.reduce(
                    (acc, attr) => {
                        acc[attr.alias.name] = true
                        return acc
                    },
                    {} as Record<string, boolean>
                )

                const allTablesInPath = property.column.split('.').slice(0, -1)
                const tablesToJoin = allTablesInPath.map((table, idx) => {
                    if (idx === 0) {
                        return table
                    }
                    return [...allTablesInPath.slice(0, idx), table].join('.')
                })

                tablesToJoin.forEach((table) => {
                    const pathSplit = table.split('.')
                    const fullPath =
                        pathSplit.length === 1
                            ? ''
                            : `_${pathSplit
                                  .slice(0, -1)
                                  .map((p) => p + '_rel')
                                  .join('_')}`
                    const tableName = pathSplit[pathSplit.length - 1]
                    const tableAliasWithProperty = `${queryBuilder.alias}${fullPath}.${tableName}`
                    const joinTableAlias = `${queryBuilder.alias}${fullPath}_${tableName}_rel`

                    const baseTableAlias = allJoinedTables[joinTableAlias]

                    if (baseTableAlias) {
                        return
                    } else {
                        queryBuilder.leftJoin(tableAliasWithProperty, joinTableAlias)
                    }
                })

                return whereClause
            }
        }
    })
}

export async function paginate<T extends ObjectLiteral>(
    query: PaginateQuery,
    repo: Repository<T> | SelectQueryBuilder<T>,
    config: PaginateConfig<T>
): Promise<Paginated<T>> {
    const page = positiveNumberOrDefault(query.page, 1, 1)

    const defaultLimit = config.defaultLimit || PaginationLimit.DEFAULT_LIMIT
    const maxLimit = config.maxLimit || PaginationLimit.DEFAULT_MAX_LIMIT

    const isPaginated = !(
        query.limit === PaginationLimit.COUNTER_ONLY ||
        (query.limit === PaginationLimit.NO_PAGINATION && maxLimit === PaginationLimit.NO_PAGINATION)
    )

    const limit =
        query.limit === PaginationLimit.COUNTER_ONLY
            ? PaginationLimit.COUNTER_ONLY
            : isPaginated === true
            ? maxLimit === PaginationLimit.NO_PAGINATION
                ? query.limit ?? defaultLimit
                : query.limit === PaginationLimit.NO_PAGINATION
                ? defaultLimit
                : Math.min(query.limit ?? defaultLimit, maxLimit)
            : defaultLimit

    const sortBy = [] as SortBy<T>
    const searchBy: Column<T>[] = []

    let [items, totalItems]: [T[], number] = [[], 0]

    const queryBuilder = isRepository(repo) ? repo.createQueryBuilder('__root') : repo

    if (isRepository(repo) && !config.relations && config.loadEagerRelations === true) {
        if (!config.relations) {
            FindOptionsUtils.joinEagerRelations(queryBuilder, queryBuilder.alias, repo.metadata)
        }
    }

    if (isPaginated) {
        // Allow user to choose between limit/offset and take/skip.
        // However, using limit/offset can cause problems when joining one-to-many etc.
        if (config.paginationType === PaginationType.LIMIT_AND_OFFSET) {
            queryBuilder.limit(limit).offset((page - 1) * limit)
        } else {
            queryBuilder.take(limit).skip((page - 1) * limit)
        }
    }

    if (config.withDeleted) {
        queryBuilder.withDeleted()
    }

    let filterJoinMethods = {}
    if (query.filter) {
        filterJoinMethods = addFilter(queryBuilder, query, config.filterableColumns)
    }
    const joinMethods = { ...filterJoinMethods, ...config.joinMethods }

    // Add the relations specified by the config, or used in the currently
    // filtered filterable columns.
    if (config.relations || Object.keys(filterJoinMethods).length) {
        const relationsSchema = mergeRelationSchema(
            createRelationSchema(config.relations),
            createRelationSchema(Object.keys(joinMethods))
        )
        addRelationsFromSchema(queryBuilder, relationsSchema, config, joinMethods)
    }

    const dbType = (isRepository(repo) ? repo.manager : repo).connection.options.type
    const isMariaDbOrMySql = (dbType: string) => dbType === 'mariadb' || dbType === 'mysql'
    const isMMDb = isMariaDbOrMySql(dbType)

    let nullSort: string | undefined
    if (config.nullSort) {
        if (isMMDb) {
            nullSort = config.nullSort === 'last' ? 'IS NULL' : 'IS NOT NULL'
        } else {
            nullSort = config.nullSort === 'last' ? 'NULLS LAST' : 'NULLS FIRST'
        }
    }

    if (config.sortableColumns.length < 1) {
        const message = "Missing required 'sortableColumns' config."
        logger.debug(message)
        throw new ServiceUnavailableException(message)
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

    for (const order of sortBy) {
        const columnProperties = getPropertiesByColumnName(order[0])
        const { isVirtualProperty } = extractVirtualProperty(queryBuilder, columnProperties)
        const isRelation = checkIsRelation(queryBuilder, columnProperties.propertyPath)
        const isEmbeded = checkIsEmbedded(queryBuilder, columnProperties.propertyPath)
        let alias = fixColumnAlias(columnProperties, queryBuilder.alias, isRelation, isVirtualProperty, isEmbeded)

        if (isMMDb) {
            if (isVirtualProperty) {
                alias = `\`${alias}\``
            }
            if (nullSort) {
                queryBuilder.addOrderBy(`${alias} ${nullSort}`)
            }
            queryBuilder.addOrderBy(alias, order[1])
        } else {
            if (isVirtualProperty) {
                alias = `"${alias}"`
            }
            queryBuilder.addOrderBy(alias, order[1], nullSort as 'NULLS FIRST' | 'NULLS LAST' | undefined)
        }
    }

    // When we partial select the columns (main or relation) we must add the primary key column otherwise
    // typeorm will not be able to map the result.
    let selectParams =
        config.select && query.select && !config.ignoreSelectInQueryParam
            ? config.select.filter((column) => query.select.includes(column))
            : config.select
    if (!includesAllPrimaryKeyColumns(queryBuilder, query.select)) {
        selectParams = config.select
    }
    if (selectParams?.length > 0 && includesAllPrimaryKeyColumns(queryBuilder, selectParams)) {
        const cols: string[] = selectParams.reduce((cols, currentCol) => {
            const columnProperties = getPropertiesByColumnName(currentCol)
            const isRelation = checkIsRelation(queryBuilder, columnProperties.propertyPath)
            cols.push(fixColumnAlias(columnProperties, queryBuilder.alias, isRelation))
            return cols
        }, [])
        queryBuilder.select(cols)
    }

    if (config.where && isRepository(repo)) {
        const baseWhereStr = generateWhereStatement(queryBuilder, config.where)
        queryBuilder.andWhere(`(${baseWhereStr})`)
    }

    if (config.searchableColumns) {
        if (query.searchBy && !config.ignoreSearchByInQueryParam) {
            for (const column of query.searchBy) {
                if (isEntityKey(config.searchableColumns, column)) {
                    searchBy.push(column)
                }
            }
        } else {
            searchBy.push(...config.searchableColumns)
        }
    }

    if (query.search && searchBy.length) {
        queryBuilder.andWhere(
            new Brackets((qb: SelectQueryBuilder<T>) => {
                // Explicitly handle the default case - multiWordSearch defaults to false
                const useMultiWordSearch = config.multiWordSearch ?? false
                if (!useMultiWordSearch) {
                    // Strict search mode (default behavior)
                    for (const column of searchBy) {
                        const property = getPropertiesByColumnName(column)
                        const { isVirtualProperty, query: virtualQuery } = extractVirtualProperty(qb, property)
                        const isRelation = checkIsRelation(qb, property.propertyPath)
                        const isEmbedded = checkIsEmbedded(qb, property.propertyPath)
                        const alias = fixColumnAlias(
                            property,
                            qb.alias,
                            isRelation,
                            isVirtualProperty,
                            isEmbedded,
                            virtualQuery
                        )

                        const condition: WherePredicateOperator = {
                            operator: 'ilike',
                            parameters: [alias, `:${property.column}`],
                        }

                        if (['postgres', 'cockroachdb'].includes(queryBuilder.connection.options.type)) {
                            condition.parameters[0] = `CAST(${condition.parameters[0]} AS text)`
                        }

                        qb.orWhere(qb['createWhereConditionExpression'](condition), {
                            [property.column]: `%${query.search}%`,
                        })
                    }
                } else {
                    // Multi-word search mode
                    const searchWords = query.search.split(' ').filter((word) => word.length > 0)
                    searchWords.forEach((searchWord, index) => {
                        qb.andWhere(
                            new Brackets((subQb: SelectQueryBuilder<T>) => {
                                for (const column of searchBy) {
                                    const property = getPropertiesByColumnName(column)
                                    const { isVirtualProperty, query: virtualQuery } = extractVirtualProperty(
                                        subQb,
                                        property
                                    )
                                    const isRelation = checkIsRelation(subQb, property.propertyPath)
                                    const isEmbedded = checkIsEmbedded(subQb, property.propertyPath)
                                    const alias = fixColumnAlias(
                                        property,
                                        subQb.alias,
                                        isRelation,
                                        isVirtualProperty,
                                        isEmbedded,
                                        virtualQuery
                                    )

                                    const condition: WherePredicateOperator = {
                                        operator: 'ilike',
                                        parameters: [alias, `:${property.column}_${index}`],
                                    }

                                    if (['postgres', 'cockroachdb'].includes(queryBuilder.connection.options.type)) {
                                        condition.parameters[0] = `CAST(${condition.parameters[0]} AS text)`
                                    }

                                    subQb.orWhere(subQb['createWhereConditionExpression'](condition), {
                                        [`${property.column}_${index}`]: `%${searchWord}%`,
                                    })
                                }
                            })
                        )
                    })
                }
            })
        )
    }

    if (query.limit === PaginationLimit.COUNTER_ONLY) {
        totalItems = await queryBuilder.getCount()
    } else if (isPaginated) {
        ;[items, totalItems] = await queryBuilder.getManyAndCount()
    } else {
        items = await queryBuilder.getMany()
    }

    const sortByQuery = sortBy.map((order) => `&sortBy=${order.join(':')}`).join('')
    const searchQuery = query.search ? `&search=${query.search}` : ''

    const searchByQuery =
        query.searchBy && searchBy.length && !config.ignoreSearchByInQueryParam
            ? searchBy.map((column) => `&searchBy=${column}`).join('')
            : ''

    // Only expose select in meta data if query select differs from config select
    const isQuerySelected = selectParams?.length !== config.select?.length
    const selectQuery = isQuerySelected ? `&select=${selectParams.join(',')}` : ''

    const filterQuery = query.filter
        ? '&' +
          stringify(
              mapKeys(query.filter, (_param, name) => 'filter.' + name),
              '&',
              '=',
              { encodeURIComponent: (str) => str }
          )
        : ''

    const options = `&limit=${limit}${sortByQuery}${searchQuery}${searchByQuery}${selectQuery}${filterQuery}`

    let path: string = null
    if (query.path !== null) {
        // `query.path` does not exist in RPC/WS requests and is set to null then.
        const { queryOrigin, queryPath } = getQueryUrlComponents(query.path)
        if (config.relativePath) {
            path = queryPath
        } else if (config.origin) {
            path = config.origin + queryPath
        } else {
            path = queryOrigin + queryPath
        }
    }
    const buildLink = (p: number): string => path + '?page=' + p + options

    const totalPages = isPaginated ? Math.ceil(totalItems / limit) : 1

    const results: Paginated<T> = {
        data: items,
        meta: {
            itemsPerPage: limit === PaginationLimit.COUNTER_ONLY ? totalItems : isPaginated ? limit : items.length,
            totalItems: limit === PaginationLimit.COUNTER_ONLY || isPaginated ? totalItems : items.length,
            currentPage: page,
            totalPages,
            sortBy,
            search: query.search,
            searchBy: query.search ? searchBy : undefined,
            select: isQuerySelected ? selectParams : undefined,
            filter: query.filter,
        },
        // If there is no `path`, don't build links.
        links:
            path !== null
                ? {
                      first: page == 1 ? undefined : buildLink(1),
                      previous: page - 1 < 1 ? undefined : buildLink(page - 1),
                      current: buildLink(page),
                      next: page + 1 > totalPages ? undefined : buildLink(page + 1),
                      last: page == totalPages || !totalItems ? undefined : buildLink(totalPages),
                  }
                : ({} as Paginated<T>['links']),
    }

    return Object.assign(new Paginated<T>(), results)
}

export function addRelationsFromSchema<T>(
    queryBuilder: SelectQueryBuilder<T>,
    schema: RelationSchema<T>,
    config: PaginateConfig<T>,
    joinMethods: Partial<MappedColumns<T, JoinMethod>>
): void {
    const defaultJoinMethod = config.defaultJoinMethod ?? 'leftJoinAndSelect'

    const createQueryBuilderRelations = (
        prefix: string,
        relations: RelationSchema,
        alias?: string,
        parentRelation?: string
    ) => {
        Object.keys(relations).forEach((relationName) => {
            const joinMethod =
                joinMethods[parentRelation ? `${parentRelation}.${relationName}` : relationName] ?? defaultJoinMethod
            queryBuilder[joinMethod](`${alias ?? prefix}.${relationName}`, `${alias ?? prefix}_${relationName}_rel`)

            // Check whether this is a non-terminal node with a relation schema to load
            const relationSchema = relations[relationName]
            if (
                typeof relationSchema === 'object' &&
                relationSchema !== null &&
                Object.keys(relationSchema).length > 0
            ) {
                createQueryBuilderRelations(
                    relationName,
                    relationSchema,
                    `${alias ?? prefix}_${relationName}_rel`,
                    parentRelation ? `${parentRelation}.${relationName}` : relationName
                )
            }
        })
    }
    createQueryBuilderRelations(queryBuilder.alias, schema)
}
