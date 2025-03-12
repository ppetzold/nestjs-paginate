import { mergeWith } from 'lodash'
import {
    FindOperator,
    FindOptionsRelationByString,
    FindOptionsRelations,
    Repository,
    SelectQueryBuilder,
} from 'typeorm'
import { ColumnMetadata } from 'typeorm/metadata/ColumnMetadata'
import { OrmUtils } from 'typeorm/util/OrmUtils'

/**
 * Joins 2 keys as `K`, `K.P`, `K.(P` or `K.P)`
 * The parenthesis notation is included for embedded columns
 */
type Join<K, P> = K extends string
    ? P extends string
        ? `${K}${'' extends P ? '' : '.'}${P | `(${P}` | `${P})`}`
        : never
    : never

/**
 * Get the previous number between 0 and 10. Examples:
 *   Prev[3] = 2
 *   Prev[0] = never.
 *   Prev[20] = 0
 */
type Prev = [never, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, ...0[]]

/**
 * Unwrap Promise<T> to T
 */
type UnwrapPromise<T> = T extends Promise<infer U> ? UnwrapPromise<U> : T

/**
 * Unwrap Array<T> to T
 */
type UnwrapArray<T> = T extends Array<infer U> ? UnwrapArray<U> : T

/**
 * Find all the dotted path properties for a given column.
 *
 * T: The column
 * D: max depth
 */
//                                            v Have we reached max depth?
export type Column<T, D extends number = 2> = [D] extends [never]
    ? // yes, stop recursing
      never
    : // Are we extending something with keys?
    T extends Record<string, any>
    ? {
          // For every keyof T, find all possible properties as a string union
          [K in keyof T]-?: K extends string
              ? // Is it string or number (includes enums)?
                T[K] extends string | number
                  ? // yes, add just the key
                    `${K}`
                  : // Is it a Date?
                  T[K] extends Date
                  ? // yes, add just the key
                    `${K}`
                  : // no, is it an array?
                  T[K] extends Array<infer U>
                  ? // yes, unwrap it, and recurse deeper
                    `${K}` | Join<K, Column<UnwrapArray<U>, Prev[D]>>
                  : // no, is it a promise?
                  T[K] extends Promise<infer U>
                  ? // yes, try to infer its return type and recurse
                    U extends Array<infer V>
                      ? `${K}` | Join<K, Column<UnwrapArray<V>, Prev[D]>>
                      : `${K}` | Join<K, Column<UnwrapPromise<U>, Prev[D]>>
                  : // no, we have no more special cases, so treat it as an
                    // object and recurse deeper on its keys
                    `${K}` | Join<K, Column<T[K], Prev[D]>>
              : never
          // Join all the string unions of each keyof T into a single string union
      }[keyof T]
    : ''

export type RelationColumn<T> = Extract<
    Column<T>,
    {
        [K in Column<T>]: K extends `${infer R}.${string}` ? R : never
    }[Column<T>]
>

export type Order<T> = [Column<T>, 'ASC' | 'DESC']
export type SortBy<T> = Order<T>[]

// eslint-disable-next-line @typescript-eslint/ban-types
export type MappedColumns<T, S> = { [key in Column<T> | (string & {})]: S }
export type JoinMethod = 'leftJoinAndSelect' | 'innerJoinAndSelect'
export type RelationSchemaInput<T = any> = FindOptionsRelations<T> | RelationColumn<T>[] | FindOptionsRelationByString
// eslint-disable-next-line @typescript-eslint/ban-types
export type RelationSchema<T = any> = { [relation in Column<T> | (string & {})]: true }

export function isEntityKey<T>(entityColumns: Column<T>[], column: string): column is Column<T> {
    return !!entityColumns.find((c) => c === column)
}

export const positiveNumberOrDefault = (value: number | undefined, defaultValue: number, minValue: 0 | 1 = 0) =>
    value === undefined || value < minValue ? defaultValue : value

export type ColumnProperties = { propertyPath?: string; propertyName: string; isNested: boolean; column: string }

export function getPropertiesByColumnName(column: string): ColumnProperties {
    const propertyPath = column.split('.')
    if (propertyPath.length > 1) {
        const propertyNamePath = propertyPath.slice(1)
        let isNested = false,
            propertyName = propertyNamePath.join('.')

        if (!propertyName.startsWith('(') && propertyNamePath.length > 1) {
            isNested = true
        }

        propertyName = propertyName.replace('(', '').replace(')', '')

        return {
            propertyPath: propertyPath[0],
            propertyName, // the join is in case of an embedded entity
            isNested,
            column: `${propertyPath[0]}.${propertyName}`,
        }
    } else {
        return { propertyName: propertyPath[0], isNested: false, column: propertyPath[0] }
    }
}

export function extractVirtualProperty(
    qb: SelectQueryBuilder<unknown>,
    columnProperties: ColumnProperties
): Partial<ColumnMetadata> {
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

export function includesAllPrimaryKeyColumns(qb: SelectQueryBuilder<unknown>, propertyPath: string[]): boolean {
    if (!qb || !propertyPath) {
        return false
    }
    return qb.expressionMap.mainAlias?.metadata?.primaryColumns
        .map((column) => column.propertyPath)
        .every((column) => propertyPath.includes(column))
}

export function hasColumnWithPropertyPath(
    qb: SelectQueryBuilder<unknown>,
    columnProperties: ColumnProperties
): boolean {
    if (!qb || !columnProperties) {
        return false
    }
    return !!qb.expressionMap.mainAlias?.metadata?.hasColumnWithPropertyPath(columnProperties.propertyName)
}

export function checkIsRelation(qb: SelectQueryBuilder<unknown>, propertyPath: string): boolean {
    if (!qb || !propertyPath) {
        return false
    }
    return !!qb?.expressionMap?.mainAlias?.metadata?.hasRelationWithPropertyPath(propertyPath)
}

export function checkIsNestedRelation(qb: SelectQueryBuilder<unknown>, propertyPath: string): boolean {
    let metadata = qb?.expressionMap?.mainAlias?.metadata
    for (const relationName of propertyPath.split('.')) {
        const relation = metadata?.relations.find((relation) => relation.propertyPath === relationName)
        if (!relation) {
            return false
        }
        metadata = relation.inverseEntityMetadata
    }
    return true
}

export function checkIsEmbedded(qb: SelectQueryBuilder<unknown>, propertyPath: string): boolean {
    if (!qb || !propertyPath) {
        return false
    }
    return !!qb?.expressionMap?.mainAlias?.metadata?.hasEmbeddedWithPropertyPath(propertyPath)
}

export function checkIsArray(qb: SelectQueryBuilder<unknown>, propertyName: string): boolean {
    if (!qb || !propertyName) {
        return false
    }
    return !!qb?.expressionMap?.mainAlias?.metadata.findColumnWithPropertyName(propertyName)?.isArray
}

export function checkIsJsonb(qb: SelectQueryBuilder<unknown>, propertyName: string): boolean {
    if (!qb || !propertyName) {
        return false
    }

    if (propertyName.includes('.')) {
        const parts = propertyName.split('.')
        const dbColumnName = parts[parts.length - 2]

        return qb?.expressionMap?.mainAlias?.metadata.findColumnWithPropertyName(dbColumnName)?.type === 'jsonb'
    }

    return qb?.expressionMap?.mainAlias?.metadata.findColumnWithPropertyName(propertyName)?.type === 'jsonb'
}

// This function is used to fix the column alias when using relation, embedded or virtual properties
export function fixColumnAlias(
    properties: ColumnProperties,
    alias: string,
    isRelation = false,
    isVirtualProperty = false,
    isEmbedded = false,
    query?: ColumnMetadata['query']
): string {
    if (isRelation) {
        if (isVirtualProperty && query) {
            return `(${query(`${alias}_${properties.propertyPath}_rel`)})` // () is needed to avoid parameter conflict
        } else if ((isVirtualProperty && !query) || properties.isNested) {
            if (properties.propertyName.includes('.')) {
                const propertyPath = properties.propertyName.split('.')
                const nestedRelations = propertyPath
                    .slice(0, -1)
                    .map((v) => `${v}_rel`)
                    .join('_')
                const nestedCol = propertyPath[propertyPath.length - 1]

                return `${alias}_${properties.propertyPath}_rel_${nestedRelations}.${nestedCol}`
            } else {
                return `${alias}_${properties.propertyPath}_rel_${properties.propertyName}`
            }
        } else {
            return `${alias}_${properties.propertyPath}_rel.${properties.propertyName}`
        }
    } else if (isVirtualProperty) {
        return query ? `(${query(`${alias}`)})` : `${alias}_${properties.propertyName}`
    } else if (isEmbedded) {
        return `${alias}.${properties.propertyPath}.${properties.propertyName}`
    } else {
        return `${alias}.${properties.propertyName}`
    }
}

export function getQueryUrlComponents(path: string): { queryOrigin: string; queryPath: string } {
    const r = new RegExp('^(?:[a-z+]+:)?//', 'i')
    let queryOrigin = ''
    let queryPath = ''
    if (r.test(path)) {
        const url = new URL(path)
        queryOrigin = url.origin
        queryPath = url.pathname
    } else {
        queryPath = path
    }
    return { queryOrigin, queryPath }
}

const isoDateRegExp = new RegExp(
    /(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d\.\d+([+-][0-2]\d:[0-5]\d|Z))|(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d([+-][0-2]\d:[0-5]\d|Z))|(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d([+-][0-2]\d:[0-5]\d|Z))/
)

export function isISODate(str: string): boolean {
    return isoDateRegExp.test(str)
}

export function isRepository<T>(repo: unknown | Repository<T>): repo is Repository<T> {
    if (repo instanceof Repository) return true
    try {
        if (Object.getPrototypeOf(repo).constructor.name === 'Repository') return true
        return typeof repo === 'object' && !('connection' in repo) && 'manager' in repo
    } catch {
        return false
    }
}

export function isFindOperator<T>(value: unknown | FindOperator<T>): value is FindOperator<T> {
    if (value instanceof FindOperator) return true
    try {
        if (Object.getPrototypeOf(value).constructor.name === 'FindOperator') return true
        return typeof value === 'object' && '_type' in value && '_value' in value
    } catch {
        return false
    }
}

export function createRelationSchema<T>(configurationRelations: RelationSchemaInput<T>): RelationSchema<T> {
    return Array.isArray(configurationRelations)
        ? OrmUtils.propertyPathsToTruthyObject(configurationRelations)
        : (configurationRelations as RelationSchema<T>)
}

export function mergeRelationSchema(...schemas: RelationSchema[]) {
    const noTrueOverride = (obj, source) => (source === true && obj !== undefined ? obj : undefined)
    return mergeWith({}, ...schemas, noTrueOverride)
}
