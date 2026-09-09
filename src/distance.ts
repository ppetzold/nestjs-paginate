import { BadRequestException } from '@nestjs/common'
import { SelectQueryBuilder } from 'typeorm'
import { checkIsRelation, fixColumnAlias, getPropertiesByColumnName } from './helper'

/**
 * A column modifier is a `$`-prefixed token applied to a column *reference* — as opposed to
 * filter operators/suffixes/quantifiers, which apply to a filter *value*. It turns a column
 * into a derived scalar that can be both filtered and sorted on with the ordinary machinery.
 *
 * `$dist` is the first (and currently only) modifier: it measures the distance from an origin
 * point. A distance column is written `<name>:$dist:<lat>,<lng>` and works anywhere a column is
 * accepted — as a filter key (`filter.location:$dist:50.85,4.35=$lt:5000`) and in `sortBy`
 * (`sortBy=location:$dist:50.85,4.35:ASC`).
 */
export enum ColumnModifier {
    DIST = '$dist',
}

/** The `:$dist:` marker separating a distance column's name from its `lat,lng` origin. */
const DIST_MARKER = `:${ColumnModifier.DIST}:`

/** Mean Earth radius in metres, used by the Haversine great-circle formula. */
const EARTH_RADIUS_METRES = 6371000

/** Default SRID for incoming origin coordinates (WGS 84 lat/lng). */
const DEFAULT_SRID = 4326

/**
 * Declares one distance column, referenced in queries by its `distanceColumns` key.
 *
 * The distance *strategy* is chosen from the shape of this config:
 *  - `expression` set  → custom strategy (you return the distance SQL yourself)
 *  - `point` set       → PostGIS `ST_Distance` over a geometry/geography column (metres)
 *  - `lat` + `lng` set → portable Haversine great-circle distance over two numeric columns (metres)
 */
export interface DistanceColumnConfig {
    /** Path to a geometry/geography column → PostGIS strategy. Mutually exclusive with lat/lng. */
    point?: string
    /** Path to the latitude column → Haversine strategy (requires `lng`). */
    lat?: string
    /** Path to the longitude column → Haversine strategy (requires `lat`). */
    lng?: string
    /** SRID of the incoming origin coordinates. Defaults to 4326 (WGS 84). */
    srid?: number
    /** Custom strategy: return the distance SQL expression. Takes precedence over point/lat-lng. */
    expression?: (ctx: DistanceExpressionContext) => string
}

/** Context handed to a custom {@link DistanceColumnConfig.expression} strategy. */
export interface DistanceExpressionContext {
    /** Ready-to-use SQL reference to the geometry/geography column (only in `point` mode). */
    point?: string
    /** Ready-to-use SQL reference to the latitude column (only in lat/lng mode). */
    lat?: string
    /** Ready-to-use SQL reference to the longitude column (only in lat/lng mode). */
    lng?: string
    /** The origin the distance is measured from (validated finite numbers, safe to inline). */
    origin: { lat: number; lng: number }
    /** The configured SRID (default 4326). */
    srid: number
    /** The active database type, for dialect-specific SQL. */
    dbType: string
}

/** A distance column reference parsed into its config key and origin point. */
export interface ParsedDistanceColumn {
    /** The `distanceColumns` key, e.g. `location`. */
    name: string
    origin: { lat: number; lng: number }
}

/** True when `column` is a `<name>:$dist:<lat>,<lng>` distance column reference. */
export function isDistanceColumn(column: string | string[]): column is string {
    return typeof column === 'string' && column.includes(DIST_MARKER)
}

/**
 * Reduces a distance column reference to its allow-list stem: the portion the caller whitelists
 * in `sortableColumns` / `filterableColumns`. `location:$dist:50.85,4.35` → `location:$dist`.
 */
export function distanceColumnStem(column: string): string {
    const idx = column.indexOf(DIST_MARKER)
    return idx === -1 ? column : `${column.slice(0, idx)}:${ColumnModifier.DIST}`
}

/**
 * Parses `<name>:$dist:<lat>,<lng>` into its config key and origin. Throws a `BadRequestException`
 * when the origin is missing or not a pair of finite numbers — the origin is inlined into raw SQL,
 * so validating it here keeps the generated expression injection-free.
 */
export function parseDistanceColumn(column: string): ParsedDistanceColumn {
    const idx = column.indexOf(DIST_MARKER)
    const name = column.slice(0, idx)
    const args = column.slice(idx + DIST_MARKER.length).split(',')
    if (args.length !== 2) {
        throw new BadRequestException(
            `Distance column "${column}" must be "<name>:${ColumnModifier.DIST}:<lat>,<lng>".`
        )
    }
    const lat = Number(args[0])
    const lng = Number(args[1])
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        throw new BadRequestException(`Distance column "${column}" has a non-numeric "lat,lng" origin.`)
    }
    return { name, origin: { lat, lng } }
}

/** Renders a validated finite number as a parenthesised SQL literal (so a leading `-` composes). */
function numeric(n: number): string {
    return `(${n})`
}

/** Resolves a configured point/lat/lng column path to an escaped SQL reference on `qb`. */
function resolveColumnRef(qb: SelectQueryBuilder<any>, columnPath: string): string {
    const props = getPropertiesByColumnName(columnPath)
    const isRelation = checkIsRelation(qb, props.propertyPath)
    const ref = fixColumnAlias(props, qb.alias, isRelation, false, false, undefined, qb)
    // The expression is spliced into SELECT/WHERE raw, so escape each identifier (camel-cased
    // columns must survive case-folding drivers such as Postgres).
    const escape = (identifier: string) => qb.connection.driver.escape(identifier)
    const separator = ref.indexOf('.')
    return separator === -1 ? escape(ref) : `${escape(ref.slice(0, separator))}.${escape(ref.slice(separator + 1))}`
}

/** Clamps `expr` to [-1, 1] using the dialect's scalar min/max, guarding `acos` from domain errors. */
function clampToUnit(expr: string, dbType: string): string {
    if (dbType === 'sqlite' || dbType === 'better-sqlite3') {
        return `max(-1.0, min(1.0, ${expr}))`
    }
    return `GREATEST(-1.0, LEAST(1.0, ${expr}))`
}

/** Portable Haversine great-circle distance in metres between the origin and a lat/lng column pair. */
function buildHaversine(latRef: string, lngRef: string, origin: { lat: number; lng: number }, dbType: string): string {
    const oLat = numeric(origin.lat)
    const oLng = numeric(origin.lng)
    const cosine =
        `sin(radians(${oLat})) * sin(radians(${latRef})) + ` +
        `cos(radians(${oLat})) * cos(radians(${latRef})) * cos(radians(${lngRef}) - radians(${oLng}))`
    return `${EARTH_RADIUS_METRES} * acos(${clampToUnit(cosine, dbType)})`
}

/**
 * Builds the SQL scalar expression for a distance column. The origin is inlined as validated
 * numeric literals (no bound parameters), so the very same expression can back both a filter
 * predicate and an `ORDER BY` without parameter-name collisions.
 */
export function buildDistanceExpression(
    qb: SelectQueryBuilder<any>,
    config: DistanceColumnConfig,
    parsed: ParsedDistanceColumn
): string {
    const dbType = qb.connection.options.type
    const srid = config.srid ?? DEFAULT_SRID
    const { origin } = parsed

    if (config.expression) {
        return config.expression({
            point: config.point ? resolveColumnRef(qb, config.point) : undefined,
            lat: config.lat ? resolveColumnRef(qb, config.lat) : undefined,
            lng: config.lng ? resolveColumnRef(qb, config.lng) : undefined,
            origin,
            srid,
            dbType,
        })
    }

    if (config.point) {
        if (dbType !== 'postgres' && dbType !== 'cockroachdb') {
            throw new BadRequestException(
                `Distance column "${parsed.name}" uses a PostGIS point column, which requires a ` +
                    `PostgreSQL/PostGIS connection (got "${dbType}"). Configure lat/lng or a custom expression instead.`
            )
        }
        const point = resolveColumnRef(qb, config.point)
        // ST_MakePoint takes (lng, lat); casting to geography yields the distance in metres.
        return (
            `ST_Distance(${point}::geography, ` +
            `ST_SetSRID(ST_MakePoint(${numeric(origin.lng)}, ${numeric(origin.lat)}), ${srid})::geography)`
        )
    }

    if (config.lat && config.lng) {
        return buildHaversine(resolveColumnRef(qb, config.lat), resolveColumnRef(qb, config.lng), origin, dbType)
    }

    throw new Error(`Distance column "${parsed.name}" must configure "point", "lat"+"lng", or a custom "expression".`)
}
