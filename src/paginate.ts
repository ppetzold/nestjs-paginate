import { Logger, ServiceUnavailableException } from '@nestjs/common'
import { mapKeys } from 'lodash'
import { stringify } from 'querystring'
import {
    Brackets,
    EntityMetadata,
    FindOptionsUtils,
    FindOptionsWhere,
    ObjectLiteral,
    Repository,
    SelectQueryBuilder,
} from 'typeorm'
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
    getMissingPrimaryKeyColumns,
    getPaddedExpr,
    getPropertiesByColumnName,
    getQueryUrlComponents,
    isDateColumnType,
    isEntityKey,
    isFindOperator,
    isISODate,
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
        totalItems?: number
        currentPage?: number
        totalPages?: number
        sortBy: SortBy<T>
        searchBy: Column<T>[]
        search: string
        select: string[]
        filter?: {
            [column: string]: string | string[]
        }
        cursor?: string
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
    CURSOR = 'cursor',
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
    buildCountQuery?: (qb: SelectQueryBuilder<T>) => SelectQueryBuilder<any>
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

function fixCursorValue(value: any): any {
    if (isISODate(value)) {
        return new Date(value)
    }
    return value
}

export async function paginate<T extends ObjectLiteral>(
    query: PaginateQuery,
    repo: Repository<T> | SelectQueryBuilder<T>,
    config: PaginateConfig<T>
): Promise<Paginated<T>> {
    const dbType = (isRepository(repo) ? repo.manager : repo).connection.options.type
    const isMySqlOrMariaDb = ['mysql', 'mariadb'].includes(dbType)
    const metadata = isRepository(repo) ? repo.metadata : repo.expressionMap.mainAlias.metadata

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

    const generateNullCursor = (): string => {
        return 'A' + '0'.repeat(15) // null values ​​should be looked up last, so use the smallest prefix
    }

    const generateDateCursor = (value: number, direction: 'ASC' | 'DESC'): string => {
        if (direction === 'ASC' && value === 0) {
            return 'X' + '0'.repeat(15)
        }

        const finalValue = direction === 'ASC' ? Math.pow(10, 15) - value : value

        return 'V' + String(finalValue).padStart(15, '0')
    }

    const generateNumberCursor = (value: number, direction: 'ASC' | 'DESC'): string => {
        const integerLength = 11
        const decimalLength = 4 // sorting is not possible if the decimal point exceeds 4 digits
        const maxIntegerDigit = Math.pow(10, integerLength)
        const fixedScale = Math.pow(10, decimalLength)
        const absValue = Math.abs(value)
        const scaledValue = Math.round(absValue * fixedScale)
        const integerPart = Math.floor(scaledValue / fixedScale)
        const decimalPart = scaledValue % fixedScale

        let integerPrefix: string
        let decimalPrefix: string
        let finalInteger: number
        let finalDecimal: number

        if (direction === 'ASC') {
            if (value < 0) {
                integerPrefix = 'Y'
                decimalPrefix = 'V'
                finalInteger = integerPart
                finalDecimal = decimalPart
            } else if (value === 0) {
                integerPrefix = 'X'
                decimalPrefix = 'X'
                finalInteger = 0
                finalDecimal = 0
            } else {
                integerPrefix = integerPart === 0 ? 'X' : 'V' // X > V
                decimalPrefix = decimalPart === 0 ? 'X' : 'V' // X > V
                finalInteger = integerPart === 0 ? 0 : maxIntegerDigit - integerPart
                finalDecimal = decimalPart === 0 ? 0 : fixedScale - decimalPart
            }
        } else {
            // DESC
            if (value < 0) {
                integerPrefix = integerPart === 0 ? 'N' : 'M' // N > M
                decimalPrefix = decimalPart === 0 ? 'X' : 'V' // X > V
                finalInteger = integerPart === 0 ? 0 : maxIntegerDigit - integerPart
                finalDecimal = decimalPart === 0 ? 0 : fixedScale - decimalPart
            } else if (value === 0) {
                integerPrefix = 'N'
                decimalPrefix = 'X'
                finalInteger = 0
                finalDecimal = 0
            } else {
                integerPrefix = 'V'
                decimalPrefix = 'V'
                finalInteger = integerPart
                finalDecimal = decimalPart
            }
        }

        return (
            integerPrefix +
            String(finalInteger).padStart(integerLength, '0') +
            decimalPrefix +
            String(finalDecimal).padStart(decimalLength, '0')
        )
    }

    const generateCursor = (item: T, sortBy: SortBy<T>, linkType: 'previous' | 'next' = 'next'): string => {
        return sortBy
            .map(([column, direction]) => {
                const columnProperties = getPropertiesByColumnName(String(column))

                let propertyPath = []
                if (columnProperties.isNested) {
                    if (columnProperties.propertyPath) {
                        propertyPath.push(columnProperties.propertyPath)
                    }
                    propertyPath = propertyPath.concat(columnProperties.propertyName.split('.'))
                } else if (columnProperties.propertyPath) {
                    propertyPath = [columnProperties.propertyPath, columnProperties.propertyName]
                } else {
                    propertyPath = [columnProperties.propertyName]
                }

                // Extract value from nested object
                let value = item
                for (let i = 0; i < propertyPath.length; i++) {
                    const key = propertyPath[i]

                    if (value === null || value === undefined) {
                        value = null
                        break
                    }

                    // Handle case where value is an array
                    if (Array.isArray(value[key])) {
                        const arrayValues = value[key]
                            .map((item: any) => {
                                let nestedValue = item
                                for (let j = i + 1; j < propertyPath.length; j++) {
                                    if (nestedValue === null || nestedValue === undefined) {
                                        return null
                                    }

                                    // Handle embedded properties
                                    if (propertyPath[j].includes('.')) {
                                        const nestedProperties = propertyPath[j].split('.')
                                        for (const nestedProperty of nestedProperties) {
                                            nestedValue = nestedValue[nestedProperty]
                                        }
                                    } else {
                                        nestedValue = nestedValue[propertyPath[j]]
                                    }
                                }
                                return nestedValue
                            })
                            .filter((v: any) => v !== null && v !== undefined)

                        if (arrayValues.length === 0) {
                            value = null
                        } else {
                            // Select min or max value based on sort direction and linkType (XOR)
                            value = (
                                (direction === 'ASC') !== (linkType === 'previous')
                                    ? Math.min(...arrayValues)
                                    : Math.max(...arrayValues)
                            ) as any
                        }
                        break
                    } else {
                        value = value[key]
                    }
                }

                value = fixCursorValue(value)

                // Find column metadata
                let columnMeta = null
                if (propertyPath.length === 1) {
                    // For regular column
                    columnMeta = metadata.columns.find((col) => col.propertyName === columnProperties.propertyName)
                } else {
                    // For relation column
                    let currentMetadata = metadata
                    let currentPath = ''

                    // Traverse the relation path except for the last part
                    for (let i = 0; i < propertyPath.length - 1; i++) {
                        const relationName = propertyPath[i]
                        currentPath = currentPath ? `${currentPath}.${relationName}` : relationName
                        const relation = currentMetadata.findRelationWithPropertyPath(relationName)

                        if (relation) {
                            currentMetadata = relation.inverseEntityMetadata
                        } else {
                            break
                        }
                    }

                    // Find column by the last property name
                    const propertyName = propertyPath[propertyPath.length - 1]
                    columnMeta = currentMetadata.columns.find((col) => col.propertyName === propertyName)
                }

                const isDateColumn = columnMeta && isDateColumnType(columnMeta.type)

                if (value === null || value === undefined) {
                    return generateNullCursor()
                }

                if (isDateColumn) {
                    return generateDateCursor(value.getTime(), direction)
                } else {
                    const numericValue = Number(value)
                    return generateNumberCursor(numericValue, direction)
                }
            })
            .join('')
    }

    const getDateColumnExpression = (alias: string, dbType: string): string => {
        switch (dbType) {
            case 'mysql':
            case 'mariadb':
                return `UNIX_TIMESTAMP(${alias}) * 1000`
            case 'postgres':
                return `EXTRACT(EPOCH FROM ${alias}) * 1000`
            case 'sqlite':
                return `(STRFTIME('%s', ${alias}) + (STRFTIME('%f', ${alias}) - STRFTIME('%S', ${alias}))) * 1000`
            default:
                return alias
        }
    }

    const logAndThrowException = (msg: string) => {
        logger.debug(msg)
        throw new ServiceUnavailableException(msg)
    }

    if (config.sortableColumns.length < 1) {
        logAndThrowException("Missing required 'sortableColumns' config.")
    }

    const sortBy = [] as SortBy<T>

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

    const searchBy: Column<T>[] = []

    let [items, totalItems]: [T[], number] = [[], 0]

    const queryBuilder = isRepository(repo) ? repo.createQueryBuilder('__root') : repo

    if (isRepository(repo) && !config.relations && config.loadEagerRelations === true) {
        if (!config.relations) {
            FindOptionsUtils.joinEagerRelations(queryBuilder, queryBuilder.alias, repo.metadata)
        }
    }

    if (isPaginated) {
        config.paginationType = config.paginationType || PaginationType.TAKE_AND_SKIP

        // Allow user to choose between limit/offset and take/skip, or cursor-based pagination.
        // However, using limit/offset can cause problems when joining one-to-many etc.
        if (config.paginationType === PaginationType.LIMIT_AND_OFFSET) {
            queryBuilder.limit(limit).offset((page - 1) * limit)
        } else if (config.paginationType === PaginationType.TAKE_AND_SKIP) {
            queryBuilder.take(limit).skip((page - 1) * limit)
        } else if (config.paginationType === PaginationType.CURSOR) {
            queryBuilder.take(limit)
            const padLength = 15
            const integerLength = 11
            const decimalLength = 4
            const fixedScale = Math.pow(10, 4)
            const maxIntegerDigit = Math.pow(10, 11)

            const concat = (parts: string[]): string =>
                isMySqlOrMariaDb ? `CONCAT(${parts.join(', ')})` : parts.join(' || ')

            const generateNullCursorExpr = (): string => {
                const zeroPaddedExpr = getPaddedExpr('0', padLength, dbType)
                const prefix = 'A'

                return isMySqlOrMariaDb ? `CONCAT('${prefix}', ${zeroPaddedExpr})` : `'${prefix}' || ${zeroPaddedExpr}`
            }

            const generateDateCursorExpr = (columnExpr: string, direction: 'ASC' | 'DESC'): string => {
                const safeExpr = `COALESCE(${columnExpr}, 0)`
                const sqlExpr = direction === 'ASC' ? `POW(10, ${padLength}) - ${safeExpr}` : safeExpr

                const paddedExpr = getPaddedExpr(sqlExpr, padLength, dbType)
                const zeroPaddedExpr = getPaddedExpr('0', padLength, dbType)

                const prefixNull = "'A'"
                const prefixValue = "'V'"
                const prefixZero = "'X'"

                if (direction === 'ASC') {
                    return `CASE
                        WHEN ${columnExpr} IS NULL THEN ${concat([prefixNull, zeroPaddedExpr])}
                        WHEN ${columnExpr} = 0 THEN ${concat([prefixZero, zeroPaddedExpr])}
                        ELSE ${concat([prefixValue, paddedExpr])}
                    END`
                } else {
                    return `CASE
                        WHEN ${columnExpr} IS NULL THEN ${concat([prefixNull, zeroPaddedExpr])}
                        ELSE ${concat([prefixValue, paddedExpr])}
                    END`
                }
            }

            const generateNumberCursorExpr = (columnExpr: string, direction: 'ASC' | 'DESC'): string => {
                const safeExpr = `COALESCE(${columnExpr}, 0)`
                const absSafeExpr = `ABS(${safeExpr})`
                const scaledExpr = `ROUND(${absSafeExpr} * ${fixedScale}, 0)`
                const intExpr = `FLOOR(${scaledExpr} / ${fixedScale})`
                const decExpr = `(${scaledExpr} % ${fixedScale})`
                const reversedIntExpr = `(${maxIntegerDigit} - ${intExpr})`
                const reversedDecExpr = `(${fixedScale} - ${decExpr})`

                const paddedIntExpr = getPaddedExpr(intExpr, integerLength, dbType)
                const paddedDecExpr = getPaddedExpr(decExpr, decimalLength, dbType)
                const reversedIntPaddedExpr = getPaddedExpr(reversedIntExpr, integerLength, dbType)
                const reversedDecPaddedExpr = getPaddedExpr(reversedDecExpr, decimalLength, dbType)
                const zeroPaddedIntExpr = getPaddedExpr('0', integerLength, dbType)
                const zeroPaddedDecExpr = getPaddedExpr('0', decimalLength, dbType)

                if (direction === 'ASC') {
                    return `CASE
                        WHEN ${columnExpr} IS NULL THEN ${generateNullCursorExpr()}
                        WHEN ${columnExpr} < 0 THEN ${concat(["'Y'", paddedIntExpr, "'V'", paddedDecExpr])}
                        WHEN ${columnExpr} = 0 THEN ${concat(["'X'", zeroPaddedIntExpr, "'X'", zeroPaddedDecExpr])}
                        WHEN ${columnExpr} > 0 AND ${intExpr} = 0 AND ${decExpr} > 0 THEN ${concat([
                            "'X'",
                            zeroPaddedIntExpr,
                            "'V'",
                            reversedDecPaddedExpr,
                        ])}
                        WHEN ${columnExpr} > 0 AND ${intExpr} > 0 AND ${decExpr} = 0 THEN ${concat([
                            "'V'",
                            reversedIntPaddedExpr,
                            "'X'",
                            zeroPaddedDecExpr,
                        ])}
                        WHEN ${columnExpr} > 0 AND ${intExpr} > 0 AND ${decExpr} > 0 THEN ${concat([
                            "'V'",
                            reversedIntPaddedExpr,
                            "'V'",
                            reversedDecPaddedExpr,
                        ])}
                    END`
                } else {
                    return `CASE
                        WHEN ${columnExpr} IS NULL THEN ${generateNullCursorExpr()}
                        WHEN ${columnExpr} < 0 AND ${intExpr} > 0 AND ${decExpr} > 0 THEN ${concat([
                            "'M'",
                            reversedIntPaddedExpr,
                            "'V'",
                            reversedDecPaddedExpr,
                        ])}
                        WHEN ${columnExpr} < 0 AND ${intExpr} > 0 AND ${decExpr} = 0 THEN ${concat([
                            "'M'",
                            reversedIntPaddedExpr,
                            "'X'",
                            zeroPaddedDecExpr,
                        ])}
                        WHEN ${columnExpr} < 0 AND ${intExpr} = 0 AND ${decExpr} > 0 THEN ${concat([
                            "'N'",
                            zeroPaddedIntExpr,
                            "'V'",
                            reversedDecPaddedExpr,
                        ])}
                        WHEN ${columnExpr} = 0 THEN ${concat(["'N'", zeroPaddedIntExpr, "'X'", zeroPaddedDecExpr])}
                        WHEN ${columnExpr} > 0 THEN ${concat(["'V'", paddedIntExpr, "'V'", paddedDecExpr])}
                    END`
                }
            }

            const cursorExpressions = sortBy.map(([column, direction]) => {
                const columnProperties = getPropertiesByColumnName(column)
                const { isVirtualProperty, query: virtualQuery } = extractVirtualProperty(
                    queryBuilder,
                    columnProperties
                )
                const isRelation = checkIsRelation(queryBuilder, columnProperties.propertyPath)
                const isEmbedded = checkIsEmbedded(queryBuilder, columnProperties.propertyPath)
                const alias = fixColumnAlias(
                    columnProperties,
                    queryBuilder.alias,
                    isRelation,
                    isVirtualProperty,
                    isEmbedded,
                    virtualQuery
                )

                // Find column metadata to determine type for proper cursor handling
                let columnMeta = metadata.columns.find((col) => col.propertyName === columnProperties.propertyName)

                // If it's a relation column, we need to find the target column metadata
                if (isRelation) {
                    // Find the relation by path and get the target entity metadata
                    const relationPath = columnProperties.column.split('.')
                    // The base entity is the starting point
                    let currentMetadata = metadata

                    // Traverse the relation path to find the target metadata
                    for (let i = 0; i < relationPath.length - 1; i++) {
                        const relationName = relationPath[i]
                        const relation = currentMetadata.findRelationWithPropertyPath(relationName)

                        if (relation) {
                            // Update the metadata to the target entity metadata for the next iteration
                            currentMetadata = relation.inverseEntityMetadata
                        } else {
                            break
                        }
                    }

                    // Now get the property from the target entity
                    const propertyName = relationPath[relationPath.length - 1]
                    columnMeta = currentMetadata.columns.find((col) => col.propertyName === propertyName)
                }

                // Determine whether it's a date column
                const isDateColumn = columnMeta && isDateColumnType(columnMeta.type)
                const columnExpr = isDateColumn ? getDateColumnExpression(alias, dbType) : alias

                return isDateColumn
                    ? generateDateCursorExpr(columnExpr, direction)
                    : generateNumberCursorExpr(columnExpr, direction)
            })

            const cursorExpression =
                cursorExpressions.length > 1
                    ? isMySqlOrMariaDb
                        ? `CONCAT(${cursorExpressions.join(', ')})`
                        : cursorExpressions.join(' || ')
                    : cursorExpressions[0]
            queryBuilder.addSelect(cursorExpression, 'cursor')

            if (query.cursor) {
                queryBuilder.andWhere(`${cursorExpression} < :cursor`, { cursor: query.cursor })
            }

            isMySqlOrMariaDb ? queryBuilder.orderBy('`cursor`', 'DESC') : queryBuilder.orderBy('cursor', 'DESC') // since cursor is a reserved word in mysql, wrap it in backticks to recognize it as an alias
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

    if (config.paginationType !== PaginationType.CURSOR) {
        let nullSort: string | undefined
        if (config.nullSort) {
            if (isMySqlOrMariaDb) {
                nullSort = config.nullSort === 'last' ? 'IS NULL' : 'IS NOT NULL'
            } else {
                nullSort = config.nullSort === 'last' ? 'NULLS LAST' : 'NULLS FIRST'
            }
        }

        for (const order of sortBy) {
            const columnProperties = getPropertiesByColumnName(order[0])
            const { isVirtualProperty } = extractVirtualProperty(queryBuilder, columnProperties)
            const isRelation = checkIsRelation(queryBuilder, columnProperties.propertyPath)
            const isEmbedded = checkIsEmbedded(queryBuilder, columnProperties.propertyPath)
            let alias = fixColumnAlias(columnProperties, queryBuilder.alias, isRelation, isVirtualProperty, isEmbedded)

            if (isMySqlOrMariaDb) {
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
    }

    /**
     * Expands select parameters containing wildcards (*) into actual column lists
     *
     * @returns Array of expanded column names
     */
    const expandWildcardSelect = <T>(selectParams: string[], queryBuilder: SelectQueryBuilder<T>): string[] => {
        const expandedParams: string[] = []

        const mainAlias = queryBuilder.expressionMap.mainAlias
        const mainMetadata = mainAlias.metadata

        /**
         * Internal function to expand wildcards
         *
         * @returns Array of expanded column names
         */
        const _expandWidcard = (entityPath: string, metadata: EntityMetadata): string[] => {
            const expanded: string[] = []

            // Add all columns from the relation entity
            expanded.push(
                ...metadata.columns
                    .filter(
                        (col) =>
                            !metadata.embeddeds
                                .map((embedded) => embedded.columns.map((embeddedCol) => embeddedCol.propertyName))
                                .flat()
                                .includes(col.propertyName)
                    )
                    .map((col) => (entityPath ? `${entityPath}.${col.propertyName}` : col.propertyName))
            )

            // Add columns from embedded entities in the relation
            metadata.embeddeds.forEach((embedded) => {
                expanded.push(
                    ...embedded.columns.map((col) => `${entityPath}.(${embedded.propertyName}.${col.propertyName})`)
                )
            })

            return expanded
        }

        for (const param of selectParams) {
            if (param === '*') {
                expandedParams.push(..._expandWidcard('', mainMetadata))
            } else if (param.endsWith('.*')) {
                // Handle relation entity wildcards (e.g. 'user.*', 'user.profile.*')
                const parts = param.slice(0, -2).split('.')
                let currentPath = ''
                let currentMetadata = mainMetadata

                for (let i = 0; i < parts.length; i++) {
                    const part = parts[i]
                    currentPath = currentPath ? `${currentPath}.${part}` : part
                    const relation = currentMetadata.findRelationWithPropertyPath(part)

                    if (relation) {
                        currentMetadata = relation.inverseEntityMetadata
                        if (i === parts.length - 1) {
                            // Expand wildcard at the last part
                            expandedParams.push(..._expandWidcard(currentPath, currentMetadata))
                        }
                    } else {
                        break
                    }
                }
            } else {
                // Add regular columns as is
                expandedParams.push(param)
            }
        }

        // Remove duplicates while preserving order
        return [...new Set(expandedParams)]
    }

    const selectParams = (() => {
        // Expand wildcards in config.select if it exists
        const expandedConfigSelect = config.select ? expandWildcardSelect(config.select, queryBuilder) : undefined

        // Expand wildcards in query.select if it exists
        const expandedQuerySelect = query.select ? expandWildcardSelect(query.select, queryBuilder) : undefined

        // Filter config.select with expanded query.select if both exist and ignoreSelectInQueryParam is false
        if (expandedConfigSelect && expandedQuerySelect && !config.ignoreSelectInQueryParam) {
            return expandedConfigSelect.filter((column) => expandedQuerySelect.includes(column))
        }

        return expandedConfigSelect
    })()

    if (selectParams?.length > 0) {
        let cols: string[] = selectParams.reduce((cols, currentCol) => {
            const columnProperties = getPropertiesByColumnName(currentCol)
            const isRelation = checkIsRelation(queryBuilder, columnProperties.propertyPath)
            cols.push(fixColumnAlias(columnProperties, queryBuilder.alias, isRelation))
            return cols
        }, [])

        const missingPrimaryKeys = getMissingPrimaryKeyColumns(queryBuilder, cols)
        if (missingPrimaryKeys.length > 0) {
            cols = cols.concat(missingPrimaryKeys)
        }

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
    } else if (isPaginated && config.paginationType !== PaginationType.CURSOR) {
        if (config.buildCountQuery) {
            items = await queryBuilder.getMany()
            totalItems = await config.buildCountQuery(queryBuilder.clone()).getCount()
        } else {
            ;[items, totalItems] = await queryBuilder.getManyAndCount()
        }
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

    const reversedSortBy = sortBy.map(([col, dir]) => [col, dir === 'ASC' ? 'DESC' : 'ASC'] as Order<T>)

    const buildLinkForCursor = (cursor: string | undefined, isReversed: boolean = false): string => {
        let adjustedOptions = options

        if (isReversed && sortBy.length > 0) {
            adjustedOptions = `&limit=${limit}${reversedSortBy
                .map((order) => `&sortBy=${order.join(':')}`)
                .join('')}${searchQuery}${searchByQuery}${selectQuery}${filterQuery}`
        }

        return path + adjustedOptions.replace(/^./, '?') + (cursor ? `&cursor=${cursor}` : '')
    }

    const itemsPerPage = limit === PaginationLimit.COUNTER_ONLY ? totalItems : isPaginated ? limit : items.length
    const totalItemsForMeta = limit === PaginationLimit.COUNTER_ONLY || isPaginated ? totalItems : items.length
    const totalPages = isPaginated ? Math.ceil(totalItems / limit) : 1

    const results: Paginated<T> = {
        data: items,
        meta: {
            itemsPerPage: config.paginationType === PaginationType.CURSOR ? items.length : itemsPerPage,
            totalItems: config.paginationType === PaginationType.CURSOR ? undefined : totalItemsForMeta,
            currentPage: config.paginationType === PaginationType.CURSOR ? undefined : page,
            totalPages: config.paginationType === PaginationType.CURSOR ? undefined : totalPages,
            sortBy,
            search: query.search,
            searchBy: query.search ? searchBy : undefined,
            select: isQuerySelected ? selectParams : undefined,
            filter: query.filter,
            cursor: config.paginationType === PaginationType.CURSOR ? query.cursor : undefined,
        },
        // If there is no `path`, don't build links.
        links:
            path !== null
                ? config.paginationType === PaginationType.CURSOR
                    ? {
                          previous: items.length
                              ? buildLinkForCursor(generateCursor(items[0], reversedSortBy, 'previous'), true)
                              : undefined,
                          current: buildLinkForCursor(query.cursor),
                          next: items.length
                              ? buildLinkForCursor(generateCursor(items[items.length - 1], sortBy))
                              : undefined,
                      }
                    : {
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
