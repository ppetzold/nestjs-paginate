import { SelectQueryBuilder } from 'typeorm'
import { ColumnMetadata } from 'typeorm/metadata/ColumnMetadata'

type Join<K, P> = K extends string
    ? P extends string
        ? `${K}${'' extends P ? '' : '.'}${P | `(${P}` | `${P})`}`
        : never
    : never

type Prev = [never, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, ...0[]]

// TODO: puts some comments here, in this ternary of doom
export type Column<T, D extends number = 2> = [D] extends [never]
    ? never
    : T extends Record<string, any>
    ? {
          [K in keyof T]-?: K extends string
              ? T[K] extends Date
                  ? `${K}`
                  : T[K] extends Array<infer U>
                  ? `${K}` | Join<K, Column<U, Prev[D]>>
                  : `${K}` | Join<K, Column<T[K], Prev[D]>>
              : never
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
): { isVirtualProperty: boolean; query?: ColumnMetadata['query'] } {
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

export function checkIsEmbedded(qb: SelectQueryBuilder<unknown>, propertyPath: string): boolean {
    if (!qb || !propertyPath) {
        return false
    }
    return !!qb?.expressionMap?.mainAlias?.metadata?.hasEmbeddedWithPropertyPath(propertyPath)
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
            return `(${query(`${alias}_${properties.propertyPath}`)})` // () is needed to avoid parameter conflict
        } else if ((isVirtualProperty && !query) || properties.isNested) {
            return `${alias}_${properties.propertyPath}_${properties.propertyName}`
        } else {
            return `${alias}_${properties.propertyPath}.${properties.propertyName}`
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
