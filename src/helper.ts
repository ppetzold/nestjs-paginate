import { SelectQueryBuilder } from 'typeorm'
import { ColumnMetadata } from 'typeorm/metadata/ColumnMetadata'

type Join<K, P> = K extends string ? (P extends string ? `${K}${'' extends P ? '' : '.'}${P}` : never) : never

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

export const positiveNumberOrDefault = (value: number | undefined, defaultValue: number, minValue: 0 | 1 = 0) =>
    value === undefined || value < minValue ? defaultValue : value

type ColumnProperties = { propertyPath?: string; propertyName: string }

export function getPropertiesByColumnName(column: string): ColumnProperties {
    const propertyPath = column.split('.')
    return propertyPath.length > 1
        ? {
              propertyPath: propertyPath[0],
              propertyName: propertyPath.slice(1).join('.'), // the join is in case of an embedded entity
          }
        : { propertyName: propertyPath[0] }
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

export function checkIsRelation(qb: SelectQueryBuilder<unknown>, propertyPath: string): boolean {
    if (!qb || !propertyPath) {
        return false
    }
    return !!qb?.expressionMap?.mainAlias?.metadata?.hasRelationWithPropertyPath(propertyPath)
}

// This function is used to fix the column alias when using relation, embedded or virtual properties
export function fixColumnAlias(
    properties: ColumnProperties,
    alias: string,
    isRelation = false,
    isVirtualProperty = false,
    query?: ColumnMetadata['query']
): string {
    if (isRelation) {
        if (isVirtualProperty && query) {
            return `(${query(`${alias}_${properties.propertyPath}`)})` // () is needed to avoid parameter conflict
        } else if (isVirtualProperty && !query) {
            return `${alias}_${properties.propertyPath}_${properties.propertyName}`
        } else {
            return `${alias}_${properties.propertyPath}.${properties.propertyName}` // include embeded property and relation property
        }
    } else if (isVirtualProperty) {
        return query ? `(${query(`${alias}`)})` : `${alias}_${properties.propertyName}`
    } else {
        return `${alias}.${properties.propertyName}` //
    }
}
