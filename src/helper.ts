import { mergeWith } from 'lodash'
import {
    EntityMetadata,
    FindOperator,
    FindOptionsRelationByString,
    FindOptionsRelations,
    ObjectLiteral,
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

export type Order<T> = [Column<T> | Column<T>[], 'ASC' | 'DESC']
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

export function getPrimaryKeyColumns(qb: SelectQueryBuilder<any>, entityName?: string): string[] {
    return qb.expressionMap.mainAlias?.metadata?.primaryColumns.map((column) =>
        entityName ? `${entityName}.${column.propertyName}` : column.propertyName
    )
}

export function getMissingPrimaryKeyColumns(qb: SelectQueryBuilder<any>, transformedCols: string[]): string[] {
    if (!transformedCols || transformedCols.length === 0) return []

    const mainEntityPrimaryKeys = getPrimaryKeyColumns(qb)
    const missingPrimaryKeys: string[] = []

    for (const pk of mainEntityPrimaryKeys) {
        const columnProperties = getPropertiesByColumnName(pk)
        const pkAlias = fixColumnAlias(columnProperties, qb.alias, false, false, false, undefined, qb)

        if (!transformedCols.includes(pkAlias)) {
            missingPrimaryKeys.push(pkAlias)
        }
    }

    return missingPrimaryKeys
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

export function checkIsOneOfNestedPrimaryColumns(qb: SelectQueryBuilder<unknown>, propertyPath: string): boolean {
    let metadata = qb?.expressionMap?.mainAlias?.metadata
    const [deepestProperty, ...subRelations] = propertyPath.split('.').reverse()
    for (const relationName of subRelations.reverse()) {
        const relation = metadata?.relations.find((relation) => relation.propertyPath === relationName)
        if (!relation) {
            return false
        }
        metadata = relation.inverseEntityMetadata
    }
    return !!metadata.primaryColumns.find((col) => col.propertyName === deepestProperty)
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

    const resolution = resolveJsonbPath(qb, propertyName)
    return resolution.isJsonb
}

/**
 * Describes how a dot-separated filter path maps to a JSONB column.
 *
 * Given a path like `detail.referrer.source.platform`:
 *   - relationPath: ['detail']           — segments that are TypeORM relations (require JOIN)
 *   - jsonbColumn:  'referrer'           — the JSONB column on the final relation entity
 *   - jsonPath:     ['source', 'platform'] — the key path inside the JSON value
 */
export interface JsonbPathResolution {
    isJsonb: boolean
    /** Relation segments leading up to the entity that owns the JSONB column */
    relationPath: string[]
    /** Name of the JSONB column on that entity */
    jsonbColumn: string
    /** Key path inside the JSON value (may be empty for a top-level JSONB filter) */
    jsonPath: string[]
}

/**
 * Walks the dot-separated `column` path through TypeORM entity metadata to determine
 * whether the path terminates in a JSONB column and, if so, where the relation chain
 * ends and the JSON key path begins.
 *
 * Algorithm:
 *   For each segment, check whether the current entity metadata has a relation
 *   with that name.  If yes, follow the relation and continue.  If no, check
 *   whether it is a JSONB column on the current entity.  If yes, all remaining
 *   segments are JSON key path.  Otherwise, the path is not JSONB.
 */
export function resolveJsonbPath(qb: SelectQueryBuilder<unknown>, column: string): JsonbPathResolution {
    const notJsonb: JsonbPathResolution = { isJsonb: false, relationPath: [], jsonbColumn: '', jsonPath: [] }

    if (!qb || !column) {
        return notJsonb
    }

    const parts = column.split('.')
    // A plain column name without dots is not a JSONB path — callers use checkIsJsonb directly.
    if (parts.length < 2) {
        return notJsonb
    }

    let metadata = qb?.expressionMap?.mainAlias?.metadata
    const relationPath: string[] = []

    for (let i = 0; i < parts.length - 1; i++) {
        const segment = parts[i]
        const relation = metadata?.relations?.find((r) => r.propertyPath === segment)

        if (relation) {
            relationPath.push(segment)
            metadata = relation.inverseEntityMetadata
        } else {
            // Not a relation — check whether it is a JSONB column
            const isJsonbColumn = metadata?.findColumnWithPropertyName(segment)?.type === 'jsonb'
            if (!isJsonbColumn) {
                return notJsonb
            }
            return {
                isJsonb: true,
                relationPath,
                jsonbColumn: segment,
                jsonPath: parts.slice(i + 1),
            }
        }
    }

    // All segments except the last were relations; the last segment must be a JSONB column.
    const lastSegment = parts[parts.length - 1]
    const isJsonbColumn = metadata?.findColumnWithPropertyName(lastSegment)?.type === 'jsonb'
    if (isJsonbColumn) {
        return {
            isJsonb: true,
            relationPath,
            jsonbColumn: lastSegment,
            jsonPath: [],
        }
    }

    return notJsonb
}

// This function is used to fix the column alias when using relation, embedded or virtual properties
export function fixColumnAlias(
    properties: ColumnProperties,
    alias: string,
    isRelation = false,
    isVirtualProperty = false,
    isEmbedded = false,
    query?: ColumnMetadata['query'],
    qb?: SelectQueryBuilder<unknown>
): string {
    let jsonbResolution: JsonbPathResolution | undefined
    if (qb) {
        jsonbResolution = resolveJsonbPath(qb, properties.column)
    }

    if (jsonbResolution && jsonbResolution.isJsonb) {
        const baseColumnProperties = getPropertiesByColumnName(
            [...jsonbResolution.relationPath, jsonbResolution.jsonbColumn].join('.')
        )
        const baseAlias = fixColumnAlias(
            baseColumnProperties,
            alias,
            jsonbResolution.relationPath.length > 0,
            isVirtualProperty,
            isEmbedded,
            query
        )

        if (jsonbResolution.jsonPath.length === 0) {
            return baseAlias
        }

        const dbType = qb.connection.options.type
        if (dbType === 'postgres' || dbType === 'cockroachdb') {
            const pathLiteral = jsonbResolution.jsonPath.join(',')
            return `${baseAlias} #>> '{${pathLiteral}}'`
        } else if (dbType === 'mysql' || dbType === 'mariadb') {
            const mysqlPath = jsonbResolution.jsonPath.map((p) => `"${p}"`).join('.')
            return `JSON_UNQUOTE(JSON_EXTRACT(${baseAlias}, '$.${mysqlPath}'))`
        } else {
            const sqlitePath = jsonbResolution.jsonPath.map((p) => `"${p}"`).join('.')
            return `json_extract(${baseAlias}, '$.${sqlitePath}')`
        }
    }

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
    /^((\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d\.\d+([+-][0-2]\d:[0-5]\d|Z))|(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d([+-][0-2]\d:[0-5]\d|Z))|(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d([+-][0-2]\d:[0-5]\d|Z)))$/
)

export function isISODate(str: string): boolean {
    return isoDateRegExp.test(str)
}

const isoDateOnlyRegExp = /^\d{4}-[01]\d-[0-3]\d$/

/** True for a date-only string (`YYYY-MM-DD`), used to coerce filters on `date` columns whose
 *  values carry no time component and therefore never match {@link isISODate}. */
export function isISODateOnly(str: string): boolean {
    return isoDateOnlyRegExp.test(str)
}

/**
 * TypeORM column types whose values fit safely in a JavaScript number (an IEEE-754 double).
 *
 * `bigint`/`int8` and `decimal`/`numeric` are deliberately excluded: routing them through
 * `Number()` silently loses precision past 2^53, and the Postgres driver returns them as strings
 * anyway. Those are left as strings for the driver to bind and the database to compare.
 */
const NUMERIC_COLUMN_TYPES = new Set([
    'number',
    'int',
    'int2',
    'int4',
    'integer',
    'smallint',
    'mediumint',
    'tinyint',
    'float',
    'float4',
    'float8',
    'double',
    'double precision',
    'real',
])

/** Whether a filter value on a column of this type should be coerced to a JS number. */
export function isNumberColumnType(type: unknown): boolean {
    if (type === Number) return true
    return typeof type === 'string' && NUMERIC_COLUMN_TYPES.has(type.toLowerCase())
}

const BOOLEAN_COLUMN_TYPES = new Set(['boolean', 'bool'])

/** Whether a filter value on a column of this type should be coerced to a JS boolean. */
export function isBooleanColumnType(type: unknown): boolean {
    if (type === Boolean) return true
    return typeof type === 'string' && BOOLEAN_COLUMN_TYPES.has(type.toLowerCase())
}

/**
 * Date-only column type (`@Column('date')`), kept separate from {@link isDateColumnType}. Cursor
 * pagination relies on `isDateColumnType` and calls `Date.getTime()` on the loaded value; a
 * `date` column may surface as a plain string there, so it is only treated as temporal for filter
 * value coercion, not for cursor generation.
 */
export function isDateOnlyColumnType(type: unknown): boolean {
    return type === 'date'
}

/**
 * True only for strings that represent a finite JS number. Rejects empty/whitespace-only input
 * (which `Number('')` would turn into `0`) and anything non-numeric, so a value is never coerced
 * to a number by accident.
 */
export function isFiniteNumericString(value: string): boolean {
    if (typeof value !== 'string' || value.trim() === '') return false
    return Number.isFinite(Number(value))
}

/**
 * Parses the closed set of boolean tokens (`true`/`false`/`1`/`0`, case-insensitive). Returns
 * `undefined` for anything else so a value that does not clearly denote a boolean is left as-is.
 */
export function parseBooleanToken(value: string): boolean | undefined {
    switch (value.trim().toLowerCase()) {
        case 'true':
        case '1':
            return true
        case 'false':
        case '0':
            return false
        default:
            return undefined
    }
}

/**
 * Resolves the TypeORM column type for a (possibly nested) filter path, so a filter value can be
 * coerced to the matching JavaScript type. Handles:
 *   - root columns (`age`),
 *   - embedded columns (`size.height`) via TypeORM's dotted property-path lookup, and
 *   - relation columns, including nested chains (`toys.name`, `home.pillows.color`), by walking
 *     the relation chain hop by hop to the leaf column.
 *
 * Returns `undefined` when the path cannot be resolved to a concrete column (e.g. a virtual/
 * computed column with no backing column, or an unknown segment); callers then leave the value
 * as a string.
 */
export function resolveColumnType(qb: SelectQueryBuilder<unknown>, column: string): unknown {
    const metadata = qb?.expressionMap?.mainAlias?.metadata
    if (!metadata) return undefined

    // Fast path: a root or embedded column resolves directly by its dotted property path.
    const direct = metadata.findColumnWithPropertyPath?.(column)
    if (direct) return direct.type

    // Otherwise walk the relation chain: every segment but the last is a relation hop.
    const segments = column.split('.')
    let current: EntityMetadata = metadata
    for (const segment of segments.slice(0, -1)) {
        const relation = current.relations?.find((r) => r.propertyPath === segment)
        if (!relation) return undefined
        current = relation.inverseEntityMetadata
    }
    const leaf = segments[segments.length - 1]
    return (
        current.findColumnWithPropertyPath?.(leaf)?.type ?? current.columns?.find((c) => c.propertyName === leaf)?.type
    )
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

export function getPaddedExpr(valueExpr: string, length: number, dbType: string): string {
    const lengthStr = String(length)
    if (dbType === 'postgres' || dbType === 'cockroachdb') {
        return `LPAD((${valueExpr})::bigint::text, ${lengthStr}, '0')`
    } else if (dbType === 'mysql' || dbType === 'mariadb') {
        return `LPAD(${valueExpr}, ${lengthStr}, '0')`
    } else {
        // sqlite
        const padding = '0'.repeat(length)
        return `SUBSTR('${padding}' || CAST(${valueExpr} AS INTEGER), -${lengthStr}, ${lengthStr})`
    }
}

export function isDateColumnType(type: any): boolean {
    const dateTypes = [
        Date, // JavaScript Date class
        'datetime',
        'timestamp',
        'timestamptz',
    ]
    return dateTypes.includes(type)
}

export function quoteColumn(columnName: string, isMySqlOrMariaDb: boolean): string {
    return isMySqlOrMariaDb ? `\`${columnName}\`` : `"${columnName}"`
}

export function isNil(v: unknown): boolean {
    return v === null || v === undefined
}

export function isNotNil(v: unknown): boolean {
    return !isNil(v)
}

export function andWhereNoneExist(
    qb: SelectQueryBuilder<any>,
    existsQb: SelectQueryBuilder<any>
): SelectQueryBuilder<any> {
    const [query, params] = qb['getExistsCondition'](existsQb)
    return qb.andWhere(`NOT ${query}`, params)
}

/**
 * Adds a condition to the query builder that ensures all related entities match the given filter criteria.
 *
 * This method combines two conditions:
 * 1. EXISTS(X) - There must be at least one related entity matching the criteria
 * 2. NOT EXISTS(NOT X) - There must not be any related entities that don't match the criteria
 *
 * Together, these conditions ensure that all related entities match the filter criteria X.
 * For example, when filtering pillows in a cat home, this could find homes where ALL pillows are red.
 *
 * If you need to include cases where there are either 0 or all entities match, use $none:$not:X instead.
 *
 * @param {SelectQueryBuilder<any>} qb The main query builder instance to add the condition to.
 * @param {SelectQueryBuilder<any>} existsQb The subquery builder containing the filter criteria.
 * @return {SelectQueryBuilder<any>} The modified query builder with the combined EXISTS conditions.
 */
export function andWhereAllExist(
    qb: SelectQueryBuilder<any>,
    existsQb: SelectQueryBuilder<any>
): SelectQueryBuilder<any> {
    qb = qb.andWhereExists(existsQb)
    const [query, params] = qb['getExistsCondition'](existsQb)
    // The getExistsCondition clears anything that comes after WHERE, and our joining logic does not contain WHERE,
    // so it should be safe to replace the first WHERE with WHERE NOT (...) and get a correct query.
    const existsWhereNot = query.replace('WHERE', 'WHERE NOT (') + ')'
    return qb.andWhere(`NOT ${existsWhereNot}`, params)
}

/**
 * Strips the parts of a fully-built paginate query that do not affect how many root
 * entities match, so the count query stays cheap even when many relations are joined
 * for hydration.
 *
 * Pruning rules:
 * - INNER joins are always kept: they restrict the result set even when unreferenced.
 * - LEFT joins are kept only when the WHERE clause references their alias.
 * - Parent joins of any kept join are kept, so nested relation chains stay intact.
 * - ORDER BY is cleared, since ordering does not change the count.
 *
 * Used by `paginate` when `PaginateConfig.optimizedCount` is enabled. It can also be
 * composed inside a custom `PaginateConfig.buildCountQuery`.
 *
 * @param {SelectQueryBuilder<T>} qb A clone of the fully-built query builder.
 * @return {SelectQueryBuilder<T>} The same builder with count-irrelevant joins removed.
 */
export function buildOptimizedCountQuery<T extends ObjectLiteral>(qb: SelectQueryBuilder<T>): SelectQueryBuilder<T> {
    qb.orderBy()
    // Protected TypeORM API that renders only the WHERE clause. Slicing getQuery() at
    // its first WHERE instead would false-match subqueries rendered into the SELECT
    // clause, such as virtual columns.
    const whereSql: string = qb['createWhereExpression']()

    const joins = qb.expressionMap.joinAttributes
    const rootAlias = qb.expressionMap.mainAlias?.name
    const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const isReferenced = (alias: string) =>
        whereSql.includes(`"${alias}".`) || new RegExp(`(?<![\\w"])${escapeRegExp(alias)}\\.`).test(whereSql)

    const kept = new Set<string>()
    for (const join of joins) {
        if (join.direction === 'INNER' || isReferenced(join.alias.name)) {
            kept.add(join.alias.name)
        }
    }

    let added = true
    while (added) {
        added = false
        for (const join of joins) {
            if (!kept.has(join.alias.name)) continue
            const parent = join.parentAlias
            if (parent && parent !== rootAlias && !kept.has(parent)) {
                kept.add(parent)
                added = true
            }
        }
    }

    qb.expressionMap.joinAttributes = joins.filter((join) => kept.has(join.alias.name))
    return qb
}
