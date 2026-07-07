import { DataSource, Repository } from 'typeorm'
import { BaseDataSourceOptions } from 'typeorm/data-source/BaseDataSourceOptions'
import { PaginateQuery } from './decorator'
import { FilterOperator, paginate, PaginateConfig } from './paginate'
import { DistanceColumnConfig } from './distance'
import { PlaceEntity } from './__tests__/place.entity'

const isPostgres = process.env.DB === 'postgres'

// Origin: Brussels. Fixtures are ordered by increasing distance from it so that a nearest-first
// sort has a single unambiguous answer regardless of the distance strategy used.
const ORIGIN = { lat: 50.85, lng: 4.35 }
const ORIGIN_ARG = `${ORIGIN.lat},${ORIGIN.lng}`

const PLACES = [
    { name: 'Brussels', lat: 50.85, lng: 4.35 }, // ~0 km
    { name: 'Antwerp', lat: 51.22, lng: 4.4 }, // ~41 km
    { name: 'Ghent', lat: 51.05, lng: 3.72 }, // ~48 km
    { name: 'Paris', lat: 48.85, lng: 2.35 }, // ~264 km
    { name: 'London', lat: 51.51, lng: -0.13 }, // ~320 km
]
const NEAREST_FIRST = ['Brussels', 'Antwerp', 'Ghent', 'Paris', 'London']

describe('distance columns ($dist)', () => {
    let dataSource: DataSource
    let placeRepo: Repository<PlaceEntity>

    beforeAll(async () => {
        const dbOptions: Omit<Partial<BaseDataSourceOptions>, 'poolSize'> = {
            dropSchema: true,
            synchronize: true,
            logging: ['error'],
            entities: [PlaceEntity],
        }
        switch (process.env.DB) {
            case 'postgres':
                dataSource = new DataSource({
                    ...dbOptions,
                    type: 'postgres',
                    host: process.env.DB_HOST || 'localhost',
                    port: +process.env.POSTGRESS_DB_PORT || 5432,
                    username: process.env.DB_USERNAME || 'root',
                    password: process.env.DB_PASSWORD || 'pass',
                    database: process.env.DB_DATABASE || 'test',
                })
                break
            case 'mariadb':
                dataSource = new DataSource({
                    ...dbOptions,
                    type: 'mariadb',
                    host: process.env.DB_HOST || 'localhost',
                    port: +process.env.MARIA_DB_PORT || 3306,
                    username: process.env.DB_USERNAME || 'root',
                    password: process.env.DB_PASSWORD || 'pass',
                    database: process.env.DB_DATABASE || 'test',
                })
                break
            case 'sqlite':
                dataSource = new DataSource({ ...dbOptions, type: 'better-sqlite3', database: ':memory:' })
                break
            default:
                throw new Error('Invalid DB')
        }
        await dataSource.initialize()
        placeRepo = dataSource.getRepository(PlaceEntity)
        await placeRepo.save(
            PLACES.map((p) =>
                placeRepo.create({
                    name: p.name,
                    lat: p.lat,
                    lng: p.lng,
                    location: isPostgres ? { type: 'Point', coordinates: [p.lng, p.lat] } : null,
                })
            )
        )
    })

    afterAll(async () => {
        await dataSource.destroy()
    })

    const names = (data: PlaceEntity[]) => data.map((p) => p.name)

    // --- Haversine strategy (lat/lng pair) — runs on every engine -------------------------------

    const haversineConfig: PaginateConfig<PlaceEntity> = {
        sortableColumns: ['id', 'name', 'pos:$dist'],
        filterableColumns: {
            'pos:$dist': [FilterOperator.LT, FilterOperator.LTE, FilterOperator.GT, FilterOperator.BTW],
        },
        distanceColumns: { pos: { lat: 'lat', lng: 'lng' } },
        defaultSortBy: [['id', 'ASC']],
    }

    it('sorts nearest-first by Haversine distance', async () => {
        const query: PaginateQuery = { path: '', sortBy: [[`pos:$dist:${ORIGIN_ARG}`, 'ASC']] }
        const result = await paginate(query, placeRepo, haversineConfig)
        expect(names(result.data)).toStrictEqual(NEAREST_FIRST)
    })

    it('sorts farthest-first when DESC', async () => {
        const query: PaginateQuery = { path: '', sortBy: [[`pos:$dist:${ORIGIN_ARG}`, 'DESC']] }
        const result = await paginate(query, placeRepo, haversineConfig)
        expect(names(result.data)).toStrictEqual([...NEAREST_FIRST].reverse())
    })

    it('filters within a radius with $lt', async () => {
        const query: PaginateQuery = {
            path: '',
            filter: { [`pos:$dist:${ORIGIN_ARG}`]: '$lt:100000' },
            sortBy: [[`pos:$dist:${ORIGIN_ARG}`, 'ASC']],
        }
        const result = await paginate(query, placeRepo, haversineConfig)
        expect(names(result.data)).toStrictEqual(['Brussels', 'Antwerp', 'Ghent'])
    })

    it('filters a distance ring with $btw', async () => {
        const query: PaginateQuery = {
            path: '',
            filter: { [`pos:$dist:${ORIGIN_ARG}`]: '$btw:20000,100000' },
            sortBy: [[`pos:$dist:${ORIGIN_ARG}`, 'ASC']],
        }
        const result = await paginate(query, placeRepo, haversineConfig)
        expect(names(result.data)).toStrictEqual(['Antwerp', 'Ghent'])
    })

    it('combines a distance filter with a distance sort and paginates', async () => {
        const query: PaginateQuery = {
            path: '',
            limit: 2,
            filter: { [`pos:$dist:${ORIGIN_ARG}`]: '$lt:500000' },
            sortBy: [[`pos:$dist:${ORIGIN_ARG}`, 'ASC']],
        }
        const result = await paginate(query, placeRepo, haversineConfig)
        expect(names(result.data)).toStrictEqual(['Brussels', 'Antwerp'])
        expect(result.meta.totalItems).toBe(5)
    })

    // --- Custom expression strategy (Manhattan distance) — runs on every engine ------------------

    const manhattanConfig: PaginateConfig<PlaceEntity> = {
        sortableColumns: ['id', 'man:$dist'],
        filterableColumns: { 'man:$dist': [FilterOperator.LT] },
        distanceColumns: {
            man: {
                lat: 'lat',
                lng: 'lng',
                // Taxicab distance in degrees: |Δlat| + |Δlng|. Deliberately silly, but proves the
                // custom-expression escape hatch is engine-agnostic and not PostGIS-shaped.
                expression: ({ lat, lng, origin }) => `abs(${lat} - (${origin.lat})) + abs(${lng} - (${origin.lng}))`,
            } satisfies DistanceColumnConfig,
        },
        defaultSortBy: [['id', 'ASC']],
    }

    it('sorts by a custom Manhattan-distance expression', async () => {
        const query: PaginateQuery = { path: '', sortBy: [[`man:$dist:${ORIGIN_ARG}`, 'ASC']] }
        const result = await paginate(query, placeRepo, manhattanConfig)
        expect(names(result.data)).toStrictEqual(NEAREST_FIRST)
    })

    it('filters by a custom Manhattan-distance expression', async () => {
        const query: PaginateQuery = {
            path: '',
            filter: { [`man:$dist:${ORIGIN_ARG}`]: '$lt:1' },
            sortBy: [[`man:$dist:${ORIGIN_ARG}`, 'ASC']],
        }
        const result = await paginate(query, placeRepo, manhattanConfig)
        expect(names(result.data)).toStrictEqual(['Brussels', 'Antwerp', 'Ghent'])
    })

    // --- PostGIS strategy (geometry column) — PostgreSQL only ------------------------------------

    const postgisConfig: PaginateConfig<PlaceEntity> = {
        sortableColumns: ['id', 'geo:$dist'],
        filterableColumns: { 'geo:$dist': [FilterOperator.LT, FilterOperator.BTW] },
        distanceColumns: { geo: { point: 'location', srid: 4326 } },
        defaultSortBy: [['id', 'ASC']],
    }

    const pgIt = isPostgres ? it : it.skip

    pgIt('sorts nearest-first by PostGIS ST_Distance', async () => {
        const query: PaginateQuery = { path: '', sortBy: [[`geo:$dist:${ORIGIN_ARG}`, 'ASC']] }
        const result = await paginate(query, placeRepo, postgisConfig)
        expect(names(result.data)).toStrictEqual(NEAREST_FIRST)
    })

    pgIt('filters within a radius with PostGIS ST_Distance', async () => {
        const query: PaginateQuery = {
            path: '',
            filter: { [`geo:$dist:${ORIGIN_ARG}`]: '$lt:100000' },
            sortBy: [[`geo:$dist:${ORIGIN_ARG}`, 'ASC']],
        }
        const result = await paginate(query, placeRepo, postgisConfig)
        expect(names(result.data)).toStrictEqual(['Brussels', 'Antwerp', 'Ghent'])
    })

    pgIt('agrees with the Haversine strategy on ordering', async () => {
        const query: PaginateQuery = { path: '', sortBy: [[`geo:$dist:${ORIGIN_ARG}`, 'ASC']] }
        const pg = await paginate(query, placeRepo, postgisConfig)
        const hv = await paginate(
            { path: '', sortBy: [[`pos:$dist:${ORIGIN_ARG}`, 'ASC']] },
            placeRepo,
            haversineConfig
        )
        expect(names(pg.data)).toStrictEqual(names(hv.data))
    })

    // --- Allow-listing & misconfiguration -------------------------------------------------------

    it('ignores a distance sort whose stem is not sortable', async () => {
        const config: PaginateConfig<PlaceEntity> = {
            sortableColumns: ['id'],
            distanceColumns: { pos: { lat: 'lat', lng: 'lng' } },
            defaultSortBy: [['id', 'ASC']],
        }
        const query: PaginateQuery = { path: '', sortBy: [[`pos:$dist:${ORIGIN_ARG}`, 'ASC']] }
        const result = await paginate(query, placeRepo, config)
        // Falls back to the default id sort instead of the rejected distance sort.
        expect(names(result.data)).toStrictEqual(PLACES.map((p) => p.name))
    })

    it('rejects an un-whitelisted distance filter when throwOnInvalidFilter is set', async () => {
        const config: PaginateConfig<PlaceEntity> = {
            sortableColumns: ['id'],
            filterableColumns: {},
            distanceColumns: { pos: { lat: 'lat', lng: 'lng' } },
            throwOnInvalidFilter: true,
        }
        const query: PaginateQuery = { path: '', filter: { [`pos:$dist:${ORIGIN_ARG}`]: '$lt:1000' } }
        await expect(paginate(query, placeRepo, config)).rejects.toThrow(/not filterable/)
    })

    it('throws when a whitelisted distance stem has no distanceColumns config', async () => {
        const config: PaginateConfig<PlaceEntity> = {
            sortableColumns: ['id', 'pos:$dist'],
            filterableColumns: { 'pos:$dist': [FilterOperator.LT] },
            // distanceColumns intentionally omitted
        }
        const query: PaginateQuery = { path: '', filter: { [`pos:$dist:${ORIGIN_ARG}`]: '$lt:1000' } }
        await expect(paginate(query, placeRepo, config)).rejects.toThrow(/distanceColumns/)
    })

    it('rejects a non-numeric origin', async () => {
        const query: PaginateQuery = { path: '', filter: { ['pos:$dist:foo,bar']: '$lt:1000' } }
        await expect(paginate(query, placeRepo, haversineConfig)).rejects.toThrow(/non-numeric/)
    })
})
