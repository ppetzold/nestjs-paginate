import { HttpException, Logger } from '@nestjs/common'
import { clone } from 'lodash'
import * as process from 'process'
import { DataSource, In, Like, Repository, TypeORMError } from 'typeorm'
import { BaseDataSourceOptions } from 'typeorm/data-source/BaseDataSourceOptions'
import { CatHairEntity } from './__tests__/cat-hair.entity'
import { CatHomePillowBrandEntity } from './__tests__/cat-home-pillow-brand.entity'
import { CatHomePillowEntity } from './__tests__/cat-home-pillow.entity'
import { CatHomeEntity } from './__tests__/cat-home.entity'
import { CatToyEntity } from './__tests__/cat-toy.entity'
import { CatEntity, CutenessLevel } from './__tests__/cat.entity'
import { ToyShopAddressEntity } from './__tests__/toy-shop-address.entity'
import { ToyShopEntity } from './__tests__/toy-shop.entity'
import { PaginateQuery } from './decorator'
import {
    FilterComparator,
    FilterOperator,
    FilterSuffix,
    isOperator,
    isSuffix,
    OperatorSymbolToFunction,
    parseFilterToken,
} from './filter'
import { paginate, PaginateConfig, Paginated, PaginationLimit, PaginationType } from './paginate'
import globalConfig, { updateGlobalConfig } from './global-config'

// Disable debug logs during tests
beforeAll(() => {
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => {})
})

afterAll(() => {
    jest.restoreAllMocks() // Restore default logger behavior
})

const isoStringToDate = (isoString) => new Date(isoString)

describe('paginate', () => {
    let dataSource: DataSource
    let catRepo: Repository<CatEntity>
    let catToyRepo: Repository<CatToyEntity>
    let catHairRepo: Repository<CatHairEntity>
    let toyShopRepo: Repository<ToyShopEntity>
    let toyShopAddressRepository: Repository<ToyShopAddressEntity>
    let catHomeRepo: Repository<CatHomeEntity>
    let catHomePillowRepo: Repository<CatHomePillowEntity>
    let catHomePillowBrandRepo: Repository<CatHomePillowBrandEntity>
    let cats: CatEntity[]
    let catToys: CatToyEntity[]
    let catToysWithoutShop: CatToyEntity[]
    let toyShopsAddresses: ToyShopAddressEntity[]
    let toysShops: ToyShopEntity[]
    let catHomes: CatHomeEntity[]
    let catHomePillows: CatHomePillowEntity[]
    let naptimePillow: CatHomePillowEntity
    let pillowBrand: CatHomePillowBrandEntity
    let catHairs: CatHairEntity[] = []
    let underCoats: CatHairEntity[] = []

    beforeAll(async () => {
        const dbOptions: Omit<Partial<BaseDataSourceOptions>, 'poolSize'> = {
            dropSchema: true,
            synchronize: true,
            logging: ['error'],
            entities: [
                CatEntity,
                CatToyEntity,
                ToyShopAddressEntity,
                CatHomeEntity,
                CatHomePillowEntity,
                CatHomePillowBrandEntity,
                ToyShopEntity,
                process.env.DB === 'postgres' ? CatHairEntity : undefined,
            ],
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
                dataSource = new DataSource({
                    ...dbOptions,
                    type: 'sqlite',
                    database: ':memory:',
                })
                break
            default:
                throw new Error('Invalid DB')
        }
        await dataSource.initialize()
        catRepo = dataSource.getRepository(CatEntity)
        catToyRepo = dataSource.getRepository(CatToyEntity)
        catHomeRepo = dataSource.getRepository(CatHomeEntity)
        catHomePillowRepo = dataSource.getRepository(CatHomePillowEntity)
        catHomePillowBrandRepo = dataSource.getRepository(CatHomePillowBrandEntity)
        toyShopRepo = dataSource.getRepository(ToyShopEntity)
        toyShopAddressRepository = dataSource.getRepository(ToyShopAddressEntity)

        cats = await catRepo.save([
            catRepo.create({
                name: 'Milo',
                color: 'brown',
                age: 6,
                cutenessLevel: CutenessLevel.HIGH,
                lastVetVisit: isoStringToDate('2022-12-19T10:00:00.000Z'),
                size: { height: 25, width: 10, length: 40 },
                weightChange: -0.75,
            }),
            catRepo.create({
                name: 'Garfield',
                color: 'ginger',
                age: 5,
                cutenessLevel: CutenessLevel.MEDIUM,
                lastVetVisit: isoStringToDate('2022-12-20T10:00:00.000Z'),
                size: { height: 30, width: 15, length: 45 },
                weightChange: 5.25,
            }),
            catRepo.create({
                name: 'Shadow',
                color: 'black',
                age: 4,
                cutenessLevel: CutenessLevel.HIGH,
                lastVetVisit: isoStringToDate('2022-12-21T10:00:00.000Z'),
                size: { height: 25, width: 10, length: 50 },
                weightChange: -3,
            }),
            catRepo.create({
                name: 'George',
                color: 'white',
                age: 3,
                cutenessLevel: CutenessLevel.LOW,
                lastVetVisit: null,
                size: { height: 35, width: 12, length: 40 },
                weightChange: 0,
            }),
            catRepo.create({
                name: 'Leche',
                color: 'white',
                age: null,
                cutenessLevel: CutenessLevel.HIGH,
                lastVetVisit: null,
                size: { height: 10, width: 5, length: 15 },
                weightChange: -1.25,
            }),
            catRepo.create({
                name: 'Baby',
                color: 'brown',
                age: 0,
                cutenessLevel: CutenessLevel.HIGH,
                lastVetVisit: null,
                size: { height: 10, width: 5, length: 10 },
                weightChange: 0.01,
            }),
            catRepo.create({
                name: 'Adam',
                color: 'black',
                age: 4,
                cutenessLevel: CutenessLevel.LOW,
                lastVetVisit: isoStringToDate('2022-12-22T10:00:00.000Z'),
                size: { height: 20, width: 15, length: 50 },
                weightChange: 4.75,
            }),
        ])

        toyShopsAddresses = await toyShopAddressRepository.save([
            toyShopAddressRepository.create({ address: '123 Main St' }),
        ])

        toysShops = await toyShopRepo.save([
            toyShopRepo.create({ shopName: 'Best Toys', address: toyShopsAddresses[0] }),
            toyShopRepo.create({ shopName: 'Lovely Toys' }),
        ])

        catToys = await catToyRepo.save([
            catToyRepo.create({ name: 'Fuzzy Thing', cat: cats[0], size: { height: 10, width: 10, length: 10 } }),
            catToyRepo.create({
                name: 'Stuffed Mouse',
                shop: toysShops[0],
                cat: cats[0],
                size: { height: 5, width: 5, length: 12 },
            }),
            catToyRepo.create({
                name: 'Mouse',
                shop: toysShops[1],
                cat: cats[0],
                size: { height: 6, width: 4, length: 13 },
            }),
            catToyRepo.create({ name: 'String', cat: cats[1], size: { height: 1, width: 1, length: 50 } }),
        ])

        catToysWithoutShop = catToys.map(({ shop: _, ...other }) => {
            const newInstance = new CatToyEntity()
            for (const otherKey in other) {
                newInstance[otherKey] = other[otherKey]
            }
            return newInstance
        })

        pillowBrand = await catHomePillowBrandRepo.save({ name: 'Purrfection', quality: null })
        naptimePillow = await catHomePillowRepo.save({ color: 'black', brand: pillowBrand })
        catHomes = await catHomeRepo.save([
            catHomeRepo.create({ name: 'Box', cat: cats[0], street: null, naptimePillow: null }),
            catHomeRepo.create({ name: 'House', cat: cats[1], street: 'Mainstreet', naptimePillow: null }),
            catHomeRepo.create({ name: 'Mansion', cat: cats[2], street: 'Boulevard Avenue', naptimePillow }),
        ])
        catHomePillows = await catHomePillowRepo.save([
            catHomePillowRepo.create({ color: 'red', home: catHomes[0] }),
            catHomePillowRepo.create({ color: 'yellow', home: catHomes[0] }),
            catHomePillowRepo.create({ color: 'blue', home: catHomes[0] }),
            catHomePillowRepo.create({ color: 'pink', home: catHomes[1] }),
            catHomePillowRepo.create({ color: 'purple', home: catHomes[1] }),
            catHomePillowRepo.create({ color: 'teal', home: catHomes[1] }),
        ])

        // add friends to Milo
        await catRepo.save({ ...cats[0], friends: cats.slice(1) })

        catHairs = []
        underCoats = []

        if (process.env.DB === 'postgres') {
            catHairRepo = dataSource.getRepository(CatHairEntity)
            catHairs = await catHairRepo.save([
                catHairRepo.create({
                    name: 'short',
                    colors: ['white', 'brown', 'black'],
                    metadata: { length: 5, thickness: 1 },
                }),
                catHairRepo.create({
                    name: 'long',
                    colors: ['white', 'brown'],
                    metadata: { length: 20, thickness: 5 },
                }),
                catHairRepo.create({
                    name: 'buzzed',
                    colors: ['white'],
                    metadata: { length: 0.5, thickness: 10 },
                }),
                catHairRepo.create({ name: 'none' }),
            ])
        }
    })

    if (process.env.DB === 'postgres') {
        afterAll(async () => {
            const entities = dataSource.entityMetadatas
            const tableNames = entities.map((entity) => `"${entity.tableName}"`).join(', ')

            await dataSource.query(`TRUNCATE ${tableNames} RESTART IDENTITY CASCADE;`)
        })
    }

    it('should return an instance of Paginated', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            defaultSortBy: [['id', 'ASC']],
            defaultLimit: 1,
        }
        const query: PaginateQuery = {
            path: '',
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        expect(result).toBeInstanceOf(Paginated)
        expect(result.data).toStrictEqual(cats.slice(0, 1))
    })

    it('should accept and use empty string as default origin in config, even if global provided', async () => {
        updateGlobalConfig({
            defaultOrigin: 'http://localhost:8081',
        })

        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            defaultSortBy: [['id', 'ASC']],
            defaultLimit: 1,
            origin: '',
        }

        const query: PaginateQuery = {
            path: 'http://localhost:8080/cat',
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        expect(result).toBeInstanceOf(Paginated)
        expect(result.links.current).toStrictEqual('/cat?page=1&limit=1&sortBy=id:ASC')

        updateGlobalConfig({
            defaultOrigin: undefined,
        })
    })

    it('should use default origin from global config if provided, over the one from request', async () => {
        updateGlobalConfig({
            defaultOrigin: 'http://localhost:8081',
        })

        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            defaultSortBy: [['id', 'ASC']],
            defaultLimit: 1,
        }

        const query: PaginateQuery = {
            path: 'http://localhost:8080/cat',
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        expect(result).toBeInstanceOf(Paginated)
        expect(result.links.current).toStrictEqual('http://localhost:8081/cat?page=1&limit=1&sortBy=id:ASC')

        updateGlobalConfig({
            defaultOrigin: undefined,
        })
    })

    it('should accept a query builder', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            defaultSortBy: [['id', 'ASC']],
            defaultLimit: 1,
        }
        const query: PaginateQuery = {
            path: '',
        }

        const queryBuilder = await catRepo.createQueryBuilder('cats')

        const result = await paginate<CatEntity>(query, queryBuilder, config)

        expect(result.data).toStrictEqual(cats.slice(0, 1))
    })

    it('should accept a query builder with custom condition', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            defaultSortBy: [['id', 'ASC']],
        }
        const query: PaginateQuery = {
            path: '',
        }

        const queryBuilder = await dataSource
            .createQueryBuilder()
            .select('cats')
            .from(CatEntity, 'cats')
            .where('cats.color = :color', { color: 'white' })

        const result = await paginate<CatEntity>(query, queryBuilder, config)

        expect(result.data).toStrictEqual(cats.slice(3, 5))
    })

    it('should accept query builder and work with query filter', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            defaultSortBy: [['id', 'ASC']],
            filterableColumns: {
                'size.height': true,
            },
        }
        const query: PaginateQuery = {
            path: '',
            filter: {
                'size.height': '$gte:20',
            },
        }

        const queryBuilder = await dataSource
            .createQueryBuilder()
            .select('cats')
            .from(CatEntity, 'cats')
            .where('cats.color = :color', { color: 'white' })

        const result = await paginate<CatEntity>(query, queryBuilder, config)

        expect(result.data).toStrictEqual(cats.slice(3, 4))
    })

    it('should default to page 1, if negative page is given', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            defaultLimit: 1,
        }
        const query: PaginateQuery = {
            path: '',
            page: -1,
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        expect(result.meta.currentPage).toBe(1)
        expect(result.data).toStrictEqual(cats.slice(0, 1))
    })

    it('should default to limit maxLimit, if maxLimit is not 0', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            maxLimit: 1,
            defaultLimit: 1,
        }
        const query: PaginateQuery = {
            path: '',
            limit: PaginationLimit.NO_PAGINATION,
        }

        const result = await paginate<CatEntity>(query, catRepo, config)
        expect(result.data).toStrictEqual(cats.slice(0, 1))
    })

    it('should return all cats', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            maxLimit: PaginationLimit.NO_PAGINATION,
            defaultLimit: 1,
        }
        const query: PaginateQuery = {
            path: '',
            limit: PaginationLimit.NO_PAGINATION,
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        expect(result.data).toStrictEqual(cats)
    })

    it('should limit to query limit, even if maxLimit is set to NO_PAGINATION', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            maxLimit: PaginationLimit.NO_PAGINATION,
        }
        const query: PaginateQuery = {
            path: '',
            limit: 2,
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        expect(result.meta.itemsPerPage).toBe(2)
    })

    it('should default to limit defaultLimit, if maxLimit is NO_PAGINATION', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            maxLimit: PaginationLimit.NO_PAGINATION,
            defaultLimit: 1,
        }
        const query: PaginateQuery = {
            path: '',
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        expect(result.data).toStrictEqual(cats.slice(0, 1))
    })

    it('should default to limit maxLimit, if more than maxLimit is given', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            defaultLimit: 5,
            maxLimit: 2,
        }
        const query: PaginateQuery = {
            path: '',
            page: 1,
            limit: 20,
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        expect(result.data).toStrictEqual(cats.slice(0, 2))
    })

    it('should limit cats by query', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            maxLimit: Number.MAX_SAFE_INTEGER,
            defaultLimit: Number.MAX_SAFE_INTEGER,
        }
        const query: PaginateQuery = {
            path: '',
            limit: 2,
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        expect(result.data).toStrictEqual(cats.slice(0, 2))
    })

    it('maxLimit should limit defaultLimit', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            maxLimit: 1,
            defaultLimit: 2,
        }
        const query: PaginateQuery = {
            path: '',
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        expect(result.data).toStrictEqual(cats.slice(0, 1))
    })

    it('limit should bypass defaultLimit', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            defaultLimit: 1,
        }
        const query: PaginateQuery = {
            path: '',
            limit: 2,
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        expect(result.data).toStrictEqual(cats.slice(0, 2))
    })

    it('DEFAULT_LIMIT should be used as the limit if limit is set to NO_PAGINATION and maxLimit is not specified.', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
        }
        const query: PaginateQuery = {
            path: '',
            limit: PaginationLimit.NO_PAGINATION,
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        expect(result.data).toStrictEqual(cats.slice(0, globalConfig.defaultLimit))
    })

    it('should return the count without data ignoring maxLimit if limit is COUNTER_ONLY', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            maxLimit: PaginationLimit.NO_PAGINATION,
        }
        const query: PaginateQuery = {
            path: '',
            limit: 0,
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        expect(result.data).toStrictEqual([])
        expect(result.meta.totalItems).toBe(7)
    })

    it('should return correct result for limited one-to-many relations', async () => {
        const config: PaginateConfig<CatEntity> = {
            relations: ['toys'],
            sortableColumns: ['id', 'toys.id'],
            searchableColumns: ['name', 'toys.name'],
            defaultLimit: 4,
        }
        const query: PaginateQuery = {
            path: '',
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        expect(result.data.length).toStrictEqual(4)
    })

    it('should return correct links for some results', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
        }
        const query: PaginateQuery = {
            path: '',
            page: 2,
            limit: 2,
        }

        const { links } = await paginate<CatEntity>(query, catRepo, config)

        expect(links.first).toBe('?page=1&limit=2&sortBy=id:ASC')
        expect(links.previous).toBe('?page=1&limit=2&sortBy=id:ASC')
        expect(links.current).toBe('?page=2&limit=2&sortBy=id:ASC')
        expect(links.next).toBe('?page=3&limit=2&sortBy=id:ASC')
        expect(links.last).toBe('?page=4&limit=2&sortBy=id:ASC')
    })

    it('should return a relative path', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            relativePath: true,
        }

        const query: PaginateQuery = {
            path: 'http://localhost/cats',
            page: 2,
            limit: 2,
        }

        const { links } = await paginate<CatEntity>(query, catRepo, config)

        expect(links.first).toBe('/cats?page=1&limit=2&sortBy=id:ASC')
        expect(links.previous).toBe('/cats?page=1&limit=2&sortBy=id:ASC')
        expect(links.current).toBe('/cats?page=2&limit=2&sortBy=id:ASC')
        expect(links.next).toBe('/cats?page=3&limit=2&sortBy=id:ASC')
        expect(links.last).toBe('/cats?page=4&limit=2&sortBy=id:ASC')
    })

    it('should return an absolute path', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            relativePath: false,
        }

        const query: PaginateQuery = {
            path: 'http://localhost/cats',
            page: 2,
            limit: 2,
        }

        const { links } = await paginate<CatEntity>(query, catRepo, config)

        expect(links.first).toBe('http://localhost/cats?page=1&limit=2&sortBy=id:ASC')
        expect(links.previous).toBe('http://localhost/cats?page=1&limit=2&sortBy=id:ASC')
        expect(links.current).toBe('http://localhost/cats?page=2&limit=2&sortBy=id:ASC')
        expect(links.next).toBe('http://localhost/cats?page=3&limit=2&sortBy=id:ASC')
        expect(links.last).toBe('http://localhost/cats?page=4&limit=2&sortBy=id:ASC')
    })

    it('should return an absolute path with new origin', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            relativePath: false,
            origin: 'http://cats.example',
        }

        const query: PaginateQuery = {
            path: 'http://localhost/cats',
            page: 2,
            limit: 2,
        }

        const { links } = await paginate<CatEntity>(query, catRepo, config)

        expect(links.first).toBe('http://cats.example/cats?page=1&limit=2&sortBy=id:ASC')
        expect(links.previous).toBe('http://cats.example/cats?page=1&limit=2&sortBy=id:ASC')
        expect(links.current).toBe('http://cats.example/cats?page=2&limit=2&sortBy=id:ASC')
        expect(links.next).toBe('http://cats.example/cats?page=3&limit=2&sortBy=id:ASC')
        expect(links.last).toBe('http://cats.example/cats?page=4&limit=2&sortBy=id:ASC')
    })

    it('should return only current link if zero results', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            searchableColumns: ['name'],
        }
        const query: PaginateQuery = {
            path: '',
            page: 1,
            limit: 2,
            search: 'Pluto',
        }

        const { links } = await paginate<CatEntity>(query, catRepo, config)

        expect(links.first).toBe(undefined)
        expect(links.previous).toBe(undefined)
        expect(links.current).toBe('?page=1&limit=2&sortBy=id:ASC&search=Pluto')
        expect(links.next).toBe(undefined)
        expect(links.last).toBe(undefined)
    })

    it('should default to defaultSortBy if query sortBy does not exist', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id', 'createdAt'],
            defaultSortBy: [['id', 'DESC']],
        }
        const query: PaginateQuery = {
            path: '',
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        expect(result.meta.sortBy).toStrictEqual([['id', 'DESC']])
        expect(result.data).toStrictEqual(cats.slice(0).reverse())
    })

    it('should put null values last when sorting', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['age', 'createdAt'],
            nullSort: 'last',
            defaultSortBy: [['age', 'ASC']],
        }
        const query: PaginateQuery = {
            path: '',
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        // Extracting the indexes of non-null values ​​and null values
        const notNullIndexes = result.data
            .map((cat, index) => (cat.age !== null ? index : -1))
            .filter((index) => index !== -1)

        const nullIndexes = result.data
            .map((cat, index) => (cat.age === null ? index : -1))
            .filter((index) => index !== -1)

        expect(result.meta.sortBy).toStrictEqual([['age', 'ASC']])
        expect(Math.max(...notNullIndexes)).toBeLessThan(Math.min(...nullIndexes))
    })

    it('should put null values first when sorting', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['age', 'createdAt'],
            nullSort: 'first',
            defaultSortBy: [['age', 'ASC']],
        }
        const query: PaginateQuery = {
            path: '',
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        const nullIndexes = result.data
            .map((cat, index) => (cat.age === null ? index : -1))
            .filter((index) => index !== -1)

        const notNullIndexes = result.data
            .map((cat, index) => (cat.age !== null ? index : -1))
            .filter((index) => index !== -1)

        expect(result.meta.sortBy).toStrictEqual([['age', 'ASC']])
        expect(Math.max(...nullIndexes)).toBeLessThan(Math.min(...notNullIndexes))
    })

    it('should sort result by multiple columns', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['name', 'color'],
        }
        const query: PaginateQuery = {
            path: '',
            sortBy: [
                ['color', 'DESC'],
                ['name', 'ASC'],
            ],
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        const sortedCats = cats.slice(0).sort((a, b) => {
            if (a.color === b.color) {
                return a.name.localeCompare(b.name)
            }
            return b.color.localeCompare(a.color)
        })

        expect(result.meta.sortBy).toStrictEqual([
            ['color', 'DESC'],
            ['name', 'ASC'],
        ])
        expect(result.data).toStrictEqual(sortedCats)
    })

    it('should sort result by camelcase columns', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['cutenessLevel', 'name'],
        }
        const query: PaginateQuery = {
            path: '',
            sortBy: [
                ['cutenessLevel', 'ASC'],
                ['name', 'ASC'],
            ],
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        const sortedCats = cats.slice(0).sort((a, b) => {
            if (a.cutenessLevel === b.cutenessLevel) {
                return a.name.localeCompare(b.name)
            }
            return a.cutenessLevel.localeCompare(b.cutenessLevel)
        })

        expect(result.meta.sortBy).toStrictEqual([
            ['cutenessLevel', 'ASC'],
            ['name', 'ASC'],
        ])
        expect(result.data).toStrictEqual(sortedCats)
    })

    it('should return result based on search term', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id', 'name', 'color'],
            searchableColumns: ['name', 'color'],
        }
        const query: PaginateQuery = {
            path: '',
            search: 'i',
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        expect(result.meta.search).toStrictEqual('i')
        expect(result.data).toStrictEqual([cats[0], cats[1], cats[3], cats[4]])
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&search=i')
    })

    it('should return result based on search term on a camelcase named column', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id', 'name', 'color'],
            searchableColumns: ['cutenessLevel'],
        }
        const query: PaginateQuery = {
            path: '',
            search: 'hi',
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        const expectedCats = cats.filter((cat) => cat.cutenessLevel === CutenessLevel.HIGH)

        expect(result.meta.search).toStrictEqual('hi')
        expect(result.data).toStrictEqual(expectedCats)
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&search=hi')
    })

    it('should not result in a sql syntax error when attempting a sql injection', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id', 'name', 'color'],
            searchableColumns: ['name', 'color'],
        }
        const query: PaginateQuery = {
            path: '',
            search: "i UNION SELECT tbl_name FROM sqlite_master WHERE type='table' and tbl_name NOT like 'sqlite_%'",
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        expect(result.data).toStrictEqual([])
    })

    it('should return result based on search term on many-to-one relation', async () => {
        const config: PaginateConfig<CatToyEntity> = {
            relations: ['cat'],
            sortableColumns: ['id', 'name'],
            searchableColumns: ['name', 'cat.name'],
        }
        const query: PaginateQuery = {
            path: '',
            search: 'Milo',
        }

        const result = await paginate<CatToyEntity>(query, catToyRepo, config)

        expect(result.meta.search).toStrictEqual('Milo')
        expect(result.data).toStrictEqual([catToysWithoutShop[0], catToysWithoutShop[1], catToysWithoutShop[2]])
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&search=Milo')
    })

    it('should return result based on search term on one-to-many relation', async () => {
        const config: PaginateConfig<CatEntity> = {
            relations: ['toys'],
            sortableColumns: ['id', 'toys.id'],
            searchableColumns: ['name', 'toys.name'],
        }
        const query: PaginateQuery = {
            path: '',
            search: 'Mouse',
            sortBy: [
                ['id', 'ASC'],
                ['toys.id', 'DESC'],
            ],
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        expect(result.meta.search).toStrictEqual('Mouse')
        const toy = clone(catToysWithoutShop[1])
        delete toy.cat
        const toy2 = clone(catToysWithoutShop[2])
        delete toy2.cat

        expect(result.data).toStrictEqual([Object.assign(clone(cats[0]), { toys: [toy2, toy] })])
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&sortBy=toys.id:DESC&search=Mouse')
    })

    it('should return result based on search term on one-to-one relation', async () => {
        const config: PaginateConfig<CatHomeEntity> = {
            relations: ['cat', 'naptimePillow.brand'],
            sortableColumns: ['id', 'name', 'cat.id'],
        }
        const query: PaginateQuery = {
            path: '',
            sortBy: [['cat.id', 'DESC']],
        }

        const result = await paginate<CatHomeEntity>(query, catHomeRepo, config)
        expect(result.meta.sortBy).toStrictEqual([['cat.id', 'DESC']])

        const catHomesClone = clone([catHomes[0], catHomes[1], catHomes[2]])
        catHomesClone[0].countCat = cats.filter((cat) => cat.id === catHomesClone[0].cat.id).length
        catHomesClone[1].countCat = cats.filter((cat) => cat.id === catHomesClone[1].cat.id).length
        catHomesClone[2].countCat = cats.filter((cat) => cat.id === catHomesClone[2].cat.id).length

        expect(result.data).toStrictEqual(catHomesClone.sort((a, b) => b.cat.id - a.cat.id))
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=cat.id:DESC')
    })

    it('should handle nullSort with relations properly', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id', 'age'],
            nullSort: 'last',
            defaultSortBy: [['age', 'ASC']],
            relations: ['toys'],
        }
        const query: PaginateQuery = {
            path: '',
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        // Prepare expected result - cats ordered by age with null age last, including toys relation
        const expectedResult = [...cats]
            .sort((a, b) => {
                if (a.age === null && b.age === null) return 0
                if (a.age === null) return 1
                if (b.age === null) return -1
                return a.age - b.age
            })
            .map((cat) => cat.id)

        expect(result.meta.sortBy).toStrictEqual([['age', 'ASC']])
        expect(result.data.map((v) => v.id)).toStrictEqual(expectedResult)
    })

    it('should return result based on sort and search on many-to-one relation', async () => {
        const config: PaginateConfig<CatToyEntity> = {
            relations: ['cat'],
            sortableColumns: ['id', 'name', 'cat.id'],
            searchableColumns: ['name', 'cat.name'],
        }
        const query: PaginateQuery = {
            path: '',
            sortBy: [['cat.id', 'DESC']],
            search: 'Milo',
        }

        const result = await paginate<CatToyEntity>(query, catToyRepo, config)

        expect(result.meta.search).toStrictEqual('Milo')
        expect(result.data).toStrictEqual(
            [catToysWithoutShop[0], catToysWithoutShop[1], catToysWithoutShop[2]].sort((a, b) => b.cat.id - a.cat.id)
        )
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=cat.id:DESC&search=Milo')
    })

    it('should return result based on sort on one-to-many relation', async () => {
        const config: PaginateConfig<CatEntity> = {
            relations: ['toys', 'toys.shop', 'toys.shop.address'],
            sortableColumns: ['id', 'name', 'toys.id'],
            searchableColumns: ['name', 'toys.name'],
        }
        const query: PaginateQuery = {
            path: '',
            sortBy: [['toys.id', 'DESC']],
            search: 'Mouse',
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        expect(result.meta.search).toStrictEqual('Mouse')
        const toy1 = clone(catToys[1])
        delete toy1.cat
        const toy2 = clone(catToys[2])
        delete toy2.cat

        delete result.data[0].toys[0].shop.address

        expect(result.data).toStrictEqual([Object.assign(clone(cats[0]), { toys: [toy2, toy1] })])
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=toys.id:DESC&search=Mouse')
    })

    it('should return result based on sort on one-to-one relation', async () => {
        const config: PaginateConfig<CatHomeEntity> = {
            relations: ['cat', 'naptimePillow.brand'],
            sortableColumns: ['id', 'name'],
            searchableColumns: ['name', 'cat.name'],
        }
        const query: PaginateQuery = {
            path: '',
            search: 'Garfield',
        }

        const result = await paginate<CatHomeEntity>(query, catHomeRepo, config)

        expect(result.meta.search).toStrictEqual('Garfield')

        const catHomesClone = clone(catHomes[1])
        catHomesClone.countCat = cats.filter((cat) => cat.id === catHomesClone.cat.id).length

        expect(result.data).toStrictEqual([catHomesClone])
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&search=Garfield')
    })

    it('should load nested relations (object notation)', async () => {
        const config: PaginateConfig<CatEntity> = {
            relations: { home: { pillows: true, naptimePillow: { brand: true } } },
            sortableColumns: ['id', 'name'],
            searchableColumns: ['name'],
        }
        const query: PaginateQuery = {
            path: '',
            search: 'Garfield',
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        const cat = clone(cats[1])
        const catHomesClone = clone(catHomes[1])
        const catHomePillowsClone3 = clone(catHomePillows[3])
        delete catHomePillowsClone3.home
        const catHomePillowsClone4 = clone(catHomePillows[4])
        delete catHomePillowsClone4.home
        const catHomePillowsClone5 = clone(catHomePillows[5])
        delete catHomePillowsClone5.home

        catHomesClone.countCat = cats.filter((cat) => cat.id === catHomesClone.cat.id).length
        catHomesClone.pillows = [catHomePillowsClone3, catHomePillowsClone4, catHomePillowsClone5]
        cat.home = catHomesClone
        delete cat.home.cat

        expect(result.meta.search).toStrictEqual('Garfield')
        expect(result.data).toStrictEqual([cat])
        expect(result.data[0].home).toBeDefined()
        expect(result.data[0].home.pillows).toStrictEqual(cat.home.pillows)
    })

    it('should load nested relations (array notation)', async () => {
        const config: PaginateConfig<CatEntity> = {
            relations: ['home.pillows', 'home.naptimePillow.brand'],
            sortableColumns: ['id', 'name'],
            searchableColumns: ['name'],
        }
        const query: PaginateQuery = {
            path: '',
            search: 'Garfield',
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        const cat = clone(cats[1])
        const catHomesClone = clone(catHomes[1])
        const catHomePillowsClone3 = clone(catHomePillows[3])
        delete catHomePillowsClone3.home
        const catHomePillowsClone4 = clone(catHomePillows[4])
        delete catHomePillowsClone4.home
        const catHomePillowsClone5 = clone(catHomePillows[5])
        delete catHomePillowsClone5.home

        catHomesClone.countCat = cats.filter((cat) => cat.id === catHomesClone.cat.id).length
        catHomesClone.pillows = [catHomePillowsClone3, catHomePillowsClone4, catHomePillowsClone5]
        cat.home = catHomesClone
        delete cat.home.cat

        expect(result.meta.search).toStrictEqual('Garfield')
        expect(result.data).toStrictEqual([cat])
        expect(result.data[0].home).toBeDefined()
        expect(result.data[0].home.pillows).toStrictEqual(cat.home.pillows)
    })

    it('should throw an error when nonexistent relation loaded', async () => {
        const config: PaginateConfig<CatEntity> = {
            relations: <any>['homee'],
            sortableColumns: ['id'],
        }
        const query: PaginateQuery = {
            path: '',
        }

        try {
            await paginate<CatEntity>(query, catRepo, config)
        } catch (err) {
            expect(err).toBeInstanceOf(TypeORMError)
        }
    })

    it('should return result based on search term and searchBy columns', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id', 'name', 'color'],
            searchableColumns: ['name', 'color'],
        }

        const searchTerm = 'white'
        const expectedResultData = cats.filter((cat: CatEntity) => cat.color === searchTerm)

        const query: PaginateQuery = {
            path: '',
            search: searchTerm,
            searchBy: ['color'],
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        expect(result.meta.search).toStrictEqual(searchTerm)
        expect(result.meta.searchBy).toStrictEqual(['color'])
        expect(result.data).toStrictEqual(expectedResultData)
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&search=white&searchBy=color')
    })

    it('should return result based on where config and filter', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            where: {
                color: 'white',
            },
            filterableColumns: {
                name: [FilterSuffix.NOT],
            },
        }
        const query: PaginateQuery = {
            path: '',
            filter: {
                name: '$not:Leche',
            },
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        expect(result.meta.filter).toStrictEqual({
            name: '$not:Leche',
        })

        expect(result.data).toStrictEqual([cats[3]])
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&filter.name=$not:Leche')
    })

    it('should return based on a nested many-to-one where condition', async () => {
        const config: PaginateConfig<CatToyEntity> = {
            sortableColumns: ['id'],
            relations: ['cat'],
            where: {
                cat: {
                    id: cats[0].id,
                },
            },
        }
        const query: PaginateQuery = {
            path: '',
        }

        const result = await paginate<CatToyEntity>(query, catToyRepo, config)

        expect(result.meta.totalItems).toBe(3)
        result.data.forEach((toy) => {
            expect(toy.cat.id).toBe(cats[0].id)
        })
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC')
    })

    it('should return valid data filtering by not id field many-to-one', async () => {
        const config: PaginateConfig<CatToyEntity> = {
            sortableColumns: ['id', 'name'],
            relations: ['cat'],
            where: {
                cat: {
                    name: cats[0].name,
                },
            },
        }
        const query: PaginateQuery = {
            path: '',
        }

        const result = await paginate<CatToyEntity>(query, catToyRepo, config)

        expect(result.meta.totalItems).toBe(3)
        result.data.forEach((toy) => {
            expect(toy.cat.id).toBe(cats[0].id)
        })
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC')
    })

    it('should return result based on where one-to-many relation', async () => {
        const config: PaginateConfig<CatEntity> = {
            relations: ['toys'],
            sortableColumns: ['id', 'name'],
            where: {
                toys: {
                    name: 'Stuffed Mouse',
                },
            },
        }

        const query: PaginateQuery = {
            path: '',
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        expect(result.data.length).toBe(1)
        expect(result.data[0].toys.length).toBe(1)
        expect(result.data[0].toys[0].name).toBe('Stuffed Mouse')
    })

    it('should return all cats with a toys from the lovely shop', async () => {
        const config: PaginateConfig<CatEntity> = {
            relations: ['toys', 'toys.shop'],
            sortableColumns: ['id', 'name'],
            where: {
                toys: {
                    shop: {
                        shopName: 'Lovely Toys',
                    },
                },
            },
        }

        const query: PaginateQuery = {
            path: '',
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        expect(result.data.length).toBe(1)
        expect(result.data[0].toys.length).toBe(1)
        expect(result.data[0].toys[0].shop.id).toStrictEqual(toysShops[1].id)
        expect(result.data[0].toys[0].name).toBe('Mouse')
    })

    it('should return all cats from shop where street name like 123', async () => {
        const config: PaginateConfig<CatEntity> = {
            relations: ['toys', 'toys.shop', 'toys.shop.address'],
            sortableColumns: ['id', 'name'],
            where: {
                toys: {
                    shop: {
                        address: {
                            address: Like('%123%'),
                        },
                    },
                },
            },
        }

        const query: PaginateQuery = {
            path: '',
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        expect(result.data.length).toBe(1)
        expect(result.data[0].toys.length).toBe(1)
        expect(result.data[0].toys[0].shop).toStrictEqual(toysShops[0])
        expect(result.data[0].toys[0].name).toBe('Stuffed Mouse')
    })

    it('should return result based on filter on many-to-one relation', async () => {
        const config: PaginateConfig<CatToyEntity> = {
            relations: ['cat'],
            sortableColumns: ['id', 'name'],
            filterableColumns: {
                'cat.name': [FilterSuffix.NOT],
            },
        }
        const query: PaginateQuery = {
            path: '',
            filter: {
                'cat.name': '$not:Milo',
            },
        }

        const result = await paginate<CatToyEntity>(query, catToyRepo, config)

        expect(result.meta.filter).toStrictEqual({
            'cat.name': '$not:Milo',
        })
        expect(result.data).toStrictEqual([catToys[3]])
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&filter.cat.name=$not:Milo')
    })

    it('should be possible to filter by relation without loading it', async () => {
        const config: PaginateConfig<CatToyEntity> = {
            relations: ['cat'],
            sortableColumns: ['id'],
            where: { cat: { toys: { name: catToys[0].name } } },
        }
        const query: PaginateQuery = {
            path: '',
        }

        const result = await paginate<CatToyEntity>(query, catToyRepo, config)

        expect(result.data.length).toStrictEqual(3)
    })

    it('should be possible to filter by relation without loading it 4th level', async () => {
        const config: PaginateConfig<CatToyEntity> = {
            relations: ['cat'],
            sortableColumns: ['id'],
            where: { cat: { toys: { shop: { address: { address: Like('%123%') } } } } },
        }
        const query: PaginateQuery = {
            path: '',
        }

        const result = await paginate<CatToyEntity>(query, catToyRepo, config)

        expect(result.data.length).toStrictEqual(3)
    })

    it('should be possible to filter by relation without loading it 4th level with load eager', async () => {
        const config: PaginateConfig<CatToyEntity> = {
            loadEagerRelations: true,
            sortableColumns: ['id'],
            where: { cat: { toys: { shop: { address: { address: Like('%123%') } } } } },
        }
        const query: PaginateQuery = {
            path: '',
        }

        const result = await paginate<CatToyEntity>(query, catToyRepo, config)

        expect(result.data.length).toStrictEqual(3)
    })

    it('should be possible to filter by relation without including any relations', async () => {
        const config: PaginateConfig<CatToyEntity> = {
            loadEagerRelations: false,
            sortableColumns: ['id'],
            where: { cat: { toys: { shop: { address: { address: Like('%123%') } } } } },
        }
        const query: PaginateQuery = {
            path: '',
        }

        const result = await paginate<CatToyEntity>(query, catToyRepo, config)

        expect(result.data.length).toStrictEqual(3)
    })

    it('should return result based on filter on one-to-many relation', async () => {
        const config: PaginateConfig<CatEntity> = {
            relations: ['toys'],
            sortableColumns: ['id', 'name'],
            filterableColumns: {
                'toys.name': [FilterSuffix.NOT],
            },
        }
        const query: PaginateQuery = {
            path: '',
            filter: {
                'toys.name': '$not:Stuffed Mouse',
            },
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        const cat1 = clone(cats[0])
        const cat2 = clone(cats[1])
        const catToys1 = clone(catToysWithoutShop[0])
        const catToys2 = clone(catToysWithoutShop[2])
        const catToys3 = clone(catToysWithoutShop[3])
        delete catToys1.cat
        delete catToys2.cat
        delete catToys3.cat
        cat1.toys = [catToys1, catToys2]
        cat2.toys = [catToys3]

        expect(result.meta.filter).toStrictEqual({
            'toys.name': '$not:Stuffed Mouse',
        })
        expect(result.data).toStrictEqual([cat1, cat2])
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&filter.toys.name=$not:Stuffed Mouse')
    })

    it('should return result based on filter on one-to-one relation', async () => {
        const config: PaginateConfig<CatHomeEntity> = {
            relations: ['cat', 'naptimePillow.brand'],
            sortableColumns: ['id', 'name'],
            filterableColumns: {
                'cat.name': [FilterSuffix.NOT],
            },
        }
        const query: PaginateQuery = {
            path: '',
            filter: {
                'cat.name': '$not:Garfield',
            },
        }

        const result = await paginate<CatHomeEntity>(query, catHomeRepo, config)

        expect(result.meta.filter).toStrictEqual({
            'cat.name': '$not:Garfield',
        })

        const catHomesClones = [clone(catHomes[0]), clone(catHomes[2])]
        catHomesClones[0].countCat = cats.filter((cat) => cat.id === catHomesClones[0].cat.id).length
        catHomesClones[1].countCat = cats.filter((cat) => cat.id === catHomesClones[1].cat.id).length

        expect(result.data).toStrictEqual(catHomesClones)
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&filter.cat.name=$not:Garfield')
    })

    it('should return result based on $in filter on one-to-one relation', async () => {
        const config: PaginateConfig<CatHomeEntity> = {
            relations: ['cat', 'naptimePillow.brand'],
            sortableColumns: ['id', 'name'],
            filterableColumns: {
                'cat.age': [FilterOperator.IN],
            },
        }
        const query: PaginateQuery = {
            path: '',
            filter: {
                'cat.age': '$in:4,6',
            },
        }

        const result = await paginate<CatHomeEntity>(query, catHomeRepo, config)

        expect(result.meta.filter).toStrictEqual({
            'cat.age': '$in:4,6',
        })

        const catHomesClones = [clone(catHomes[0]), clone(catHomes[2])]
        catHomesClones[0].countCat = cats.filter((cat) => cat.id === catHomesClones[0].cat.id).length
        catHomesClones[1].countCat = cats.filter((cat) => cat.id === catHomesClones[1].cat.id).length

        expect(result.data).toStrictEqual(catHomesClones)
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&filter.cat.age=$in:4,6')
    })

    it('should return result based on $btw filter on one-to-one relation', async () => {
        const config: PaginateConfig<CatHomeEntity> = {
            relations: ['cat', 'naptimePillow.brand'],
            sortableColumns: ['id', 'name'],
            filterableColumns: {
                'cat.age': [FilterOperator.BTW],
            },
        }
        const query: PaginateQuery = {
            path: '',
            filter: {
                'cat.age': '$btw:6,10',
            },
        }

        const result = await paginate<CatHomeEntity>(query, catHomeRepo, config)

        expect(result.meta.filter).toStrictEqual({
            'cat.age': '$btw:6,10',
        })

        const catHomesClone = clone(catHomes[0])
        catHomesClone.countCat = cats.filter((cat) => cat.id === catHomesClone.cat.id).length

        expect(result.data).toStrictEqual([catHomesClone])
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&filter.cat.age=$btw:6,10')
    })

    it('should return result based on sort on embedded entity', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id', 'name', 'size.height', 'size.length', 'size.width'],
            searchableColumns: ['name'],
        }
        const query: PaginateQuery = {
            path: '',
            sortBy: [
                ['size.height', 'ASC'],
                ['size.length', 'ASC'],
            ],
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        const orderedCats = [...cats].sort((a, b) => {
            if (a.size.height !== b.size.height) {
                return a.size.height - b.size.height
            }
            return a.size.length - b.size.length
        })

        expect(result.data).toStrictEqual(orderedCats)
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=size.height:ASC&sortBy=size.length:ASC')
    })

    it('should return result based on sort on embedded entity when other relations loaded', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id', 'name', 'size.height', 'size.length', 'size.width', 'toys.(size.height)'],
            searchableColumns: ['name'],
            relations: ['home', 'toys', 'home.naptimePillow.brand'],
        }
        const query: PaginateQuery = {
            path: '',
            sortBy: [
                ['size.height', 'DESC'],
                ['size.length', 'DESC'],
                ['toys.(size.height)', 'DESC'],
            ],
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        const copyCats = cats.map((cat: CatEntity) => {
            const copy = clone(cat)
            copy.home = null
            copy.toys = []
            return copy
        })

        const copyHomes = catHomes.map((home: CatHomeEntity) => {
            const copy = clone(home)
            copy.countCat = cats.filter((cat) => cat.id === copy.cat.id).length
            delete copy.cat
            return copy
        })

        copyCats[0].home = copyHomes[0]
        copyCats[1].home = copyHomes[1]
        copyCats[2].home = copyHomes[2]

        const copyToys = catToysWithoutShop.map((toy: CatToyEntity) => {
            const copy = clone(toy)
            delete copy.cat
            return copy
        })
        copyCats[0].toys = [copyToys[0], copyToys[2], copyToys[1]]
        copyCats[1].toys = [copyToys[3]]

        const orderedCats = [...copyCats].sort((a, b) => {
            if (b.size.height !== a.size.height) {
                return b.size.height - a.size.height
            }

            if (b.size.length !== a.size.length) {
                return b.size.length - a.size.length
            }

            const maxToyHeightA = a.toys.length > 0 ? Math.max(...a.toys.map((toy) => toy.size.height)) : -Infinity
            const maxToyHeightB = b.toys.length > 0 ? Math.max(...b.toys.map((toy) => toy.size.height)) : -Infinity

            return maxToyHeightB - maxToyHeightA
        })

        expect(result.data).toStrictEqual(orderedCats)
        expect(result.links.current).toBe(
            '?page=1&limit=20&sortBy=size.height:DESC&sortBy=size.length:DESC&sortBy=toys.(size.height):DESC'
        )
    })

    it('should return result based on sort on embedded entity on one-to-many relation', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id', 'name', 'toys.(size.height)', 'toys.(size.length)', 'toys.(size.width)'],
            searchableColumns: ['name'],
            relations: ['toys'],
        }
        const query: PaginateQuery = {
            path: '',
            sortBy: [
                ['id', 'DESC'],
                ['toys.(size.height)', 'ASC'],
                ['toys.(size.length)', 'ASC'],
            ],
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        const toy0 = clone(catToysWithoutShop[0])
        delete toy0.cat

        const toy1 = clone(catToysWithoutShop[1])
        delete toy1.cat

        const toy2 = clone(catToysWithoutShop[2])
        delete toy2.cat

        const toy3 = clone(catToysWithoutShop[3])
        delete toy3.cat

        const orderedCats = [
            Object.assign(clone(cats[6]), { toys: [] }),
            Object.assign(clone(cats[5]), { toys: [] }),
            Object.assign(clone(cats[4]), { toys: [] }),
            Object.assign(clone(cats[3]), { toys: [] }),
            Object.assign(clone(cats[2]), { toys: [] }),
            Object.assign(clone(cats[1]), { toys: [toy3] }),
            Object.assign(clone(cats[0]), { toys: [toy1, toy2, toy0] }),
        ]
        expect(result.data).toStrictEqual(orderedCats)
        expect(result.links.current).toBe(
            '?page=1&limit=20&sortBy=id:DESC&sortBy=toys.(size.height):ASC&sortBy=toys.(size.length):ASC'
        )
    })

    it('should return result based on sort on embedded entity on many-to-one relation', async () => {
        const config: PaginateConfig<CatToyEntity> = {
            sortableColumns: ['id', 'name', 'cat.(size.height)', 'cat.(size.length)', 'cat.(size.width)'],
            searchableColumns: ['name'],
            relations: ['cat'],
        }
        const query: PaginateQuery = {
            path: '',
            sortBy: [
                ['cat.(size.height)', 'DESC'],
                ['cat.(size.length)', 'DESC'],
                ['name', 'ASC'],
            ],
        }

        const result = await paginate<CatToyEntity>(query, catToyRepo, config)
        const orderedToys = [catToysWithoutShop[3], catToysWithoutShop[0], catToysWithoutShop[2], catToysWithoutShop[1]]

        expect(result.data).toStrictEqual(orderedToys)
        expect(result.links.current).toBe(
            '?page=1&limit=20&sortBy=cat.(size.height):DESC&sortBy=cat.(size.length):DESC&sortBy=name:ASC'
        )
    })

    it('should return result based on sort on embedded entity on one-to-one relation', async () => {
        const config: PaginateConfig<CatHomeEntity> = {
            sortableColumns: ['id', 'name', 'cat.(size.height)', 'cat.(size.length)', 'cat.(size.width)'],
            searchableColumns: ['name'],
            relations: ['cat', 'naptimePillow.brand'],
        }
        const query: PaginateQuery = {
            path: '',
            sortBy: [['cat.(size.height)', 'DESC']],
        }

        const result = await paginate<CatHomeEntity>(query, catHomeRepo, config)
        const orderedHomes = clone([catHomes[1], catHomes[0], catHomes[2]])

        orderedHomes[0].countCat = cats.filter((cat) => cat.id === orderedHomes[0].cat.id).length
        orderedHomes[1].countCat = cats.filter((cat) => cat.id === orderedHomes[1].cat.id).length
        orderedHomes[2].countCat = cats.filter((cat) => cat.id === orderedHomes[2].cat.id).length

        expect(result.data).toStrictEqual(orderedHomes)
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=cat.(size.height):DESC')
    })

    it('should return result based on search on embedded entity', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id', 'name', 'size.height', 'size.length', 'size.width'],
            searchableColumns: ['size.height'],
        }
        const query: PaginateQuery = {
            path: '',
            search: '10',
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        expect(result.data).toStrictEqual([cats[4], cats[5]])
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&search=10')
    })

    it('should return result based on search term on embedded entity when other relations loaded', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id', 'name', 'size.height', 'size.length', 'size.width'],
            searchableColumns: ['size.height'],
            relations: ['home', 'toys'],
        }
        const query: PaginateQuery = {
            path: '',
            search: '10',
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        expect(result.meta.search).toStrictEqual('10')

        const copyCat = clone(cats[4])
        copyCat.home = null
        copyCat.toys = []

        const copyCat2 = clone(cats[5])
        copyCat2.home = null
        copyCat2.toys = []

        expect(result.data).toStrictEqual([copyCat, copyCat2])
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&search=10')
    })

    it('should return result based on search term on embedded entity on many-to-one relation', async () => {
        const config: PaginateConfig<CatToyEntity> = {
            sortableColumns: ['id', 'name', 'cat.(size.height)', 'cat.(size.length)', 'cat.(size.width)'],
            searchableColumns: ['cat.(size.height)'],
            relations: ['cat'],
        }
        const query: PaginateQuery = {
            path: '',
            search: '30',
        }

        const result = await paginate<CatToyEntity>(query, catToyRepo, config)
        expect(result.meta.search).toStrictEqual('30')
        expect(result.data).toStrictEqual([catToys[3]])
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&search=30')
    })

    it('should return result based on search term on embedded entity on one-to-many relation', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id', 'name', 'toys.(size.height)', 'toys.(size.length)', 'toys.(size.width)'],
            searchableColumns: ['toys.(size.height)'],
            relations: ['toys'],
        }
        const query: PaginateQuery = {
            path: '',
            search: '1',
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        const toy0 = clone(catToys[0])
        delete toy0.cat

        const toy3 = clone(catToys[3])
        delete toy3.cat

        expect(result.data).toStrictEqual([
            Object.assign(clone(cats[0]), { toys: [toy0] }),
            Object.assign(clone(cats[1]), { toys: [toy3] }),
        ])
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&search=1')
    })

    it('should return result based on search term on embedded entity on one-to-one relation', async () => {
        const config: PaginateConfig<CatHomeEntity> = {
            sortableColumns: ['id', 'name', 'cat.(size.height)', 'cat.(size.length)', 'cat.(size.width)'],
            searchableColumns: ['cat.(size.height)'],
            relations: ['cat', 'naptimePillow.brand'],
        }
        const query: PaginateQuery = {
            path: '',
            search: '30',
        }

        const result = await paginate<CatHomeEntity>(query, catHomeRepo, config)
        const catHomeClone = clone(catHomes[1])
        catHomeClone.countCat = cats.filter((cat) => cat.id === catHomeClone.cat.id).length
        expect(result.data).toStrictEqual([catHomeClone])
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&search=30')
    })

    it('should return result based on sort and search on embedded many-to-one relation', async () => {
        const config: PaginateConfig<CatToyEntity> = {
            sortableColumns: ['id', 'name', 'cat.(size.height)', 'cat.(size.length)', 'cat.(size.width)'],
            searchableColumns: ['cat.(size.width)'],
            relations: ['cat'],
        }
        const query: PaginateQuery = {
            path: '',
            search: '1',
            sortBy: [['cat.(size.height)', 'DESC']],
        }

        const result = await paginate<CatToyEntity>(query, catToyRepo, config)
        expect(result.meta.search).toStrictEqual('1')
        expect(result.data).toStrictEqual([
            catToysWithoutShop[3],
            catToysWithoutShop[0],
            catToysWithoutShop[1],
            catToysWithoutShop[2],
        ])
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=cat.(size.height):DESC&search=1')
    })

    it('should return result based on filter on embedded entity', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id', 'name', 'size.height', 'size.length', 'size.width'],
            searchableColumns: ['size.height'],
            filterableColumns: {
                'size.height': [FilterSuffix.NOT],
            },
        }
        const query: PaginateQuery = {
            path: '',
            filter: {
                'size.height': '$not:25',
            },
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        expect(result.data).toStrictEqual([cats[1], cats[3], cats[4], cats[5], cats[6]])
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&filter.size.height=$not:25')
    })

    it('should return result based on filter on embedded entity when other relations loaded', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id', 'name', 'size.height', 'size.length', 'size.width'],
            searchableColumns: ['size.height'],
            filterableColumns: {
                'size.height': [FilterSuffix.NOT],
            },
            relations: ['home', 'home.naptimePillow.brand'],
        }
        const query: PaginateQuery = {
            path: '',
            filter: {
                'size.height': '$not:25',
            },
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        const home = clone(catHomes[1])
        home.countCat = cats.filter((cat) => cat.id === home.cat.id).length
        delete home.cat

        const copyCats = [
            Object.assign(clone(cats[1]), { home: home }),
            Object.assign(clone(cats[3]), { home: null }),
            Object.assign(clone(cats[4]), { home: null }),
            Object.assign(clone(cats[5]), { home: null }),
            Object.assign(clone(cats[6]), { home: null }),
        ]

        expect(result.data).toStrictEqual(copyCats)
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&filter.size.height=$not:25')
    })

    it('should return result based on filter on embedded on many-to-one relation', async () => {
        const config: PaginateConfig<CatToyEntity> = {
            relations: ['cat'],
            sortableColumns: ['id', 'name'],
            filterableColumns: {
                'cat.(size.height)': [FilterSuffix.NOT],
            },
        }
        const query: PaginateQuery = {
            path: '',
            filter: {
                'cat.(size.height)': '$not:25',
            },
        }

        const result = await paginate<CatToyEntity>(query, catToyRepo, config)

        expect(result.meta.filter).toStrictEqual({
            'cat.(size.height)': '$not:25',
        })
        expect(result.data).toStrictEqual([catToys[3]])
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&filter.cat.(size.height)=$not:25')
    })

    it('should return result based on filter on embedded on one-to-many relation', async () => {
        const config: PaginateConfig<CatEntity> = {
            relations: ['toys'],
            sortableColumns: ['id', 'name'],
            filterableColumns: {
                'toys.(size.height)': [FilterOperator.EQ],
            },
        }
        const query: PaginateQuery = {
            path: '',
            filter: {
                'toys.(size.height)': '1',
            },
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        const cat2 = clone(cats[1])
        const catToys3 = clone(catToys[3])
        delete catToys3.cat
        cat2.toys = [catToys3]

        expect(result.meta.filter).toStrictEqual({
            'toys.(size.height)': '1',
        })
        expect(result.data).toStrictEqual([cat2])
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&filter.toys.(size.height)=1')
    })

    it('should return result based on filter on embedded on one-to-one relation', async () => {
        const config: PaginateConfig<CatHomeEntity> = {
            relations: ['cat', 'naptimePillow.brand'],
            sortableColumns: ['id', 'name'],
            filterableColumns: {
                'cat.(size.height)': [FilterOperator.EQ],
            },
        }
        const query: PaginateQuery = {
            path: '',
            filter: {
                'cat.(size.height)': '$eq:30',
            },
        }

        const result = await paginate<CatHomeEntity>(query, catHomeRepo, config)

        expect(result.meta.filter).toStrictEqual({
            'cat.(size.height)': '$eq:30',
        })
        const catClone = clone(catHomes[1])
        catClone.countCat = cats.filter((cat) => cat.size.height === 30 && cat.id == catClone.cat.id).length
        expect(result.data).toStrictEqual([catClone])
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&filter.cat.(size.height)=$eq:30')
    })

    it('should return result based on $in filter on embedded on one-to-one relation', async () => {
        const config: PaginateConfig<CatHomeEntity> = {
            relations: ['cat', 'naptimePillow.brand'],
            sortableColumns: ['id', 'name'],
            filterableColumns: {
                'cat.(size.height)': [FilterOperator.IN],
            },
        }
        const query: PaginateQuery = {
            path: '',
            filter: {
                'cat.(size.height)': '$in:10,30,35',
            },
        }

        const result = await paginate<CatHomeEntity>(query, catHomeRepo, config)

        expect(result.meta.filter).toStrictEqual({
            'cat.(size.height)': '$in:10,30,35',
        })
        const catClone = clone(catHomes[1])
        catClone.countCat = cats.filter(
            (cat) =>
                (cat.size.height === 10 || cat.size.height === 30 || cat.size.height === 35) &&
                cat.id == catClone.cat.id
        ).length
        expect(result.data).toStrictEqual([catClone])
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&filter.cat.(size.height)=$in:10,30,35')
    })

    it('should return result based on $btw filter on embedded on one-to-one relation', async () => {
        const config: PaginateConfig<CatHomeEntity> = {
            relations: ['cat', 'naptimePillow.brand'],
            sortableColumns: ['id', 'name'],
            filterableColumns: {
                'cat.(size.height)': [FilterOperator.BTW],
            },
        }
        const query: PaginateQuery = {
            path: '',
            filter: {
                'cat.(size.height)': '$btw:18,33',
            },
        }

        const result = await paginate<CatHomeEntity>(query, catHomeRepo, config)

        expect(result.meta.filter).toStrictEqual({
            'cat.(size.height)': '$btw:18,33',
        })

        const catHomeClones = clone(catHomes)
        catHomeClones[0].countCat = cats.filter(
            (cat) => cat.size.height >= 18 && cat.size.height <= 33 && cat.id == catHomeClones[0].cat.id
        ).length
        catHomeClones[1].countCat = cats.filter(
            (cat) => cat.size.height >= 18 && cat.size.height <= 33 && cat.id == catHomeClones[1].cat.id
        ).length
        catHomeClones[2].countCat = cats.filter(
            (cat) => cat.size.height >= 18 && cat.size.height <= 33 && cat.id == catHomeClones[1].cat.id
        ).length
        expect(result.data).toStrictEqual(catHomeClones)
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&filter.cat.(size.height)=$btw:18,33')
    })

    it('should return result based on where array and filter', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            where: [
                {
                    color: 'white',
                },
                {
                    age: 4,
                },
            ],
            filterableColumns: {
                name: [FilterSuffix.NOT],
            },
        }
        const query: PaginateQuery = {
            path: '',
            filter: {
                name: '$not:Leche',
            },
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        expect(result.meta.filter).toStrictEqual({
            name: '$not:Leche',
        })
        expect(result.data).toStrictEqual([cats[2], cats[3], cats[6]])
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&filter.name=$not:Leche')
    })

    it('should return result based on multiple filter', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            filterableColumns: {
                name: [FilterSuffix.NOT],
                color: [FilterOperator.EQ],
            },
        }
        const query: PaginateQuery = {
            path: '',
            filter: {
                name: '$not:Leche',
                color: 'white',
            },
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        expect(result.meta.filter).toStrictEqual({
            name: '$not:Leche',
            color: 'white',
        })
        expect(result.data).toStrictEqual([cats[3]])
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&filter.name=$not:Leche&filter.color=white')
    })

    it('should return result based on $ilike filter', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            filterableColumns: {
                name: [FilterOperator.ILIKE],
            },
        }
        const query: PaginateQuery = {
            path: '',
            filter: {
                name: '$ilike:arf',
            },
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        expect(result.meta.filter).toStrictEqual({
            name: '$ilike:arf',
        })
        expect(result.data).toStrictEqual([cats[1]])
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&filter.name=$ilike:arf')
    })

    it('should return result based on $sw filter', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            filterableColumns: {
                name: [FilterOperator.SW],
            },
        }
        const query: PaginateQuery = {
            path: '',
            filter: {
                name: '$sw:Ga',
            },
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        expect(result.meta.filter).toStrictEqual({
            name: '$sw:Ga',
        })
        expect(result.data).toStrictEqual([cats[1]])
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&filter.name=$sw:Ga')
    })

    it('should return result based on filter and search term', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            searchableColumns: ['name', 'color'],
            filterableColumns: {
                id: [FilterSuffix.NOT, FilterOperator.IN],
            },
        }
        const query: PaginateQuery = {
            path: '',
            search: 'white',
            filter: {
                id: '$not:$in:1,2,5',
            },
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        expect(result.meta.search).toStrictEqual('white')
        expect(result.meta.filter).toStrictEqual({ id: '$not:$in:1,2,5' })
        expect(result.data).toStrictEqual([cats[3]])
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&search=white&filter.id=$not:$in:1,2,5')
    })

    it('should return result based on filter and where config', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            where: {
                color: In(['black', 'white']),
            },
            filterableColumns: {
                id: [FilterSuffix.NOT, FilterOperator.IN],
            },
        }
        const query: PaginateQuery = {
            path: '',
            filter: {
                id: '$not:$in:1,2,5',
            },
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        expect(result.data).toStrictEqual([cats[2], cats[3], cats[6]])
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&filter.id=$not:$in:1,2,5')
    })

    it('should return result based on range filter', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            filterableColumns: {
                age: [FilterOperator.GTE],
            },
        }
        const query: PaginateQuery = {
            path: '',
            filter: {
                age: '$gte:4',
            },
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        expect(result.data).toStrictEqual([cats[0], cats[1], cats[2], cats[6]])
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&filter.age=$gte:4')
    })

    it('should return result based on between range filter', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            filterableColumns: {
                age: [FilterOperator.BTW],
            },
        }
        const query: PaginateQuery = {
            path: '',
            filter: {
                age: '$btw:4,5',
            },
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        expect(result.data).toStrictEqual([cats[1], cats[2], cats[6]])
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&filter.age=$btw:4,5')
    })

    it('should return result based on is null query', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            filterableColumns: {
                age: [FilterOperator.NULL],
            },
        }
        const query: PaginateQuery = {
            path: '',
            filter: {
                age: '$null',
            },
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        expect(result.data).toStrictEqual([cats[4]])
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&filter.age=$null')
    })

    it('should return result based on not null query', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            filterableColumns: {
                age: [FilterSuffix.NOT, FilterOperator.NULL],
            },
        }
        const query: PaginateQuery = {
            path: '',
            filter: {
                age: '$not:$null',
            },
        }

        const result = await paginate<CatEntity>(query, catRepo, config)
        const ageNotNullCats = cats.filter((cat) => cat.age !== null)

        expect(result.data).toEqual(expect.arrayContaining(ageNotNullCats))
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&filter.age=$not:$null')
    })

    it('should return result based on not null query on relation', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            filterableColumns: {
                'home.street': [FilterSuffix.NOT, FilterOperator.NULL],
            },
            relations: ['home', 'home.naptimePillow.brand'],
        }
        const query: PaginateQuery = {
            path: '',
            filter: {
                'home.street': '$not:$null',
            },
        }

        const result = await paginate<CatEntity>(query, catRepo, config)
        const expectedResult = [1, 2].map((i) => {
            const ret = Object.assign(clone(cats[i]), { home: clone(catHomes[i]) })
            ret.home.countCat = 1
            delete ret.home.cat
            return ret
        })

        expect(result.data).toStrictEqual(expectedResult)
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&filter.home.street=$not:$null')
    })

    it('should return result based on null query on relation', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            filterableColumns: {
                'home.street': [FilterOperator.NULL],
            },
            relations: ['home', 'home.naptimePillow.brand'],
        }
        const query: PaginateQuery = {
            path: '',
            filter: {
                'home.street': '$null',
            },
        }

        const result = await paginate<CatEntity>(query, catRepo, config)
        const expectedResult = [0].map((i) => {
            const ret = Object.assign(clone(cats[i]), { home: Object.assign(clone(catHomes[i])) })
            ret.home.countCat = 1
            delete ret.home.cat
            return ret
        })

        expect(result.data).toStrictEqual(expectedResult)
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&filter.home.street=$null')
    })

    it('should return result based on null query on nested relation', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            filterableColumns: {
                'home.naptimePillow.brand.quality': [FilterOperator.NULL],
            },
        }
        const query: PaginateQuery = {
            path: '',
            filter: {
                'home.naptimePillow.brand.quality': '$null',
            },
        }

        const result = await paginate<CatEntity>(query, catRepo, config)
        const expectedResult = [2].map((i) => {
            const ret = Object.assign(clone(cats[i]), { home: Object.assign(clone(catHomes[i])) })
            ret.home.countCat = 1
            delete ret.home.cat
            return ret
        })

        expect(result.data).toStrictEqual(expectedResult)
        expect(result.links.current).toBe(
            '?page=1&limit=20&sortBy=id:ASC&filter.home.naptimePillow.brand.quality=$null'
        )
    })

    it('should ignore filterable column which is not configured', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            filterableColumns: {
                name: [FilterSuffix.NOT, FilterOperator.NULL],
            },
        }
        const query: PaginateQuery = {
            path: '',
            filter: {
                age: '$not:$null',
            },
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        expect(result.data).toStrictEqual(cats)
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&filter.age=$not:$null')
    })

    it('should ignore filter operator which is not configured', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            filterableColumns: {
                age: [FilterSuffix.NOT],
            },
        }
        const query: PaginateQuery = {
            path: '',
            filter: {
                age: '$not:$null',
            },
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        expect(result.data).toStrictEqual(cats)
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&filter.age=$not:$null')
    })

    it('should throw an error when no sortableColumns', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: [],
        }
        const query: PaginateQuery = {
            path: '',
        }

        try {
            await paginate<CatEntity>(query, catRepo, config)
        } catch (err) {
            expect(err).toBeInstanceOf(HttpException)
        }
    })

    it.each([
        { operator: '$eq', result: true },
        { operator: '$gte', result: true },
        { operator: '$gt', result: true },
        { operator: '$in', result: true },
        { operator: '$null', result: true },
        { operator: '$lt', result: true },
        { operator: '$lte', result: true },
        { operator: '$btw', result: true },
        { operator: '$ilike', result: true },
        { operator: '$fake', result: false },
    ])('should check operator "$operator" valid is $result', ({ operator, result }) => {
        expect(isOperator(operator)).toStrictEqual(result)
    })

    it.each([{ suffix: '$not', result: true }])(
        'should check suffix "$suffix" valid is $result',
        ({ suffix, result }) => {
            expect(isSuffix(suffix)).toStrictEqual(result)
        }
    )

    it.each([
        { operator: '$eq', name: 'Equal' },
        { operator: '$gt', name: 'MoreThan' },
        { operator: '$gte', name: 'MoreThanOrEqual' },
        { operator: '$in', name: 'In' },
        { operator: '$null', name: 'IsNull' },
        { operator: '$lt', name: 'LessThan' },
        { operator: '$lte', name: 'LessThanOrEqual' },
        { operator: '$btw', name: 'Between' },
        { operator: '$not', name: 'Not' },
        { operator: '$ilike', name: 'ILike' },
    ])('should get operator function $name for "$operator"', ({ operator, name }) => {
        const func = OperatorSymbolToFunction.get(operator as FilterOperator)
        expect(func.name).toStrictEqual(name)
    })

    for (const cc of [FilterComparator.AND, FilterComparator.OR, '']) {
        const comparator = cc === '' ? FilterComparator.AND : cc
        const cSrt = cc === '' ? cc : `${comparator}:`
        it.each([
            {
                string: cSrt + '$ilike:value',
                tokens: { comparator, operator: '$ilike', suffix: undefined, value: 'value' },
            },
            { string: cSrt + '$eq:value', tokens: { comparator, operator: '$eq', suffix: undefined, value: 'value' } },
            {
                string: cSrt + '$eq:val:ue',
                tokens: { comparator, operator: '$eq', suffix: undefined, value: 'val:ue' },
            },
            {
                string: cSrt + '$in:value1,value2,value3',
                tokens: { comparator, operator: '$in', suffix: undefined, value: 'value1,value2,value3' },
            },
            {
                string: cSrt + '$not:$in:value1:a,value2:b,value3:c',
                tokens: { comparator, operator: '$in', suffix: '$not', value: 'value1:a,value2:b,value3:c' },
            },
            { string: cSrt + 'value', tokens: { comparator, operator: '$eq', suffix: undefined, value: 'value' } },
            { string: cSrt + 'val:ue', tokens: { comparator, operator: '$eq', suffix: undefined, value: 'val:ue' } },
            { string: cSrt + '$not:value', tokens: { comparator, operator: '$eq', suffix: '$not', value: 'value' } },
            {
                string: cSrt + '$eq:$not:value',
                tokens: { comparator, operator: '$eq', suffix: '$not', value: 'value' },
            },
            {
                string: cSrt + '$eq:$null',
                tokens: { comparator, operator: '$null', suffix: undefined, value: undefined },
            },
            { string: cSrt + '$null', tokens: { comparator, operator: '$null', suffix: undefined, value: undefined } },
            { string: cSrt + '', tokens: { comparator, operator: '$eq', suffix: undefined, value: '' } },
            {
                string: cSrt + '$eq:$not:$in:value',
                tokens: { comparator, operator: '$in', suffix: '$not', value: 'value' },
            },
            {
                string: cSrt + '$eq:$not:value:$in',
                tokens: { comparator, operator: '$eq', suffix: '$not', value: 'value:$in' },
            },
            {
                string: cSrt + '$eq:$not:$null:value:$in',
                tokens: { comparator, operator: '$null', suffix: '$not', value: undefined },
            },
        ])('should get filter tokens for "$string"', ({ string, tokens }) => {
            expect(parseFilterToken(string)).toStrictEqual(tokens)
        })
    }

    it('should return result based on or between range filter', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            filterableColumns: {
                age: [FilterOperator.BTW],
            },
        }
        const query: PaginateQuery = {
            path: '',
            filter: {
                age: ['$btw:4,5', '$or:$btw:5,6'],
            },
        }
        const result = await paginate<CatEntity>(query, catRepo, config)

        expect(result.data).toStrictEqual([cats[0], cats[1], cats[2], cats[6]])
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&filter.age=$btw:4,5&filter.age=$or:$btw:5,6')
    })

    it('should return result based on or with all cats', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            filterableColumns: {
                age: [FilterOperator.BTW],
            },
        }
        const query: PaginateQuery = {
            path: '',
            filter: {
                age: ['$null', '$or:$not:$eq:$null'],
            },
        }
        const result = await paginate<CatEntity>(query, catRepo, config)

        expect(result.data).toStrictEqual([...cats])
        expect(result.links.current).toBe(
            '?page=1&limit=20&sortBy=id:ASC&filter.age=$null&filter.age=$or:$not:$eq:$null'
        )
    })

    it('should return result based on two ors and an and with two cats', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            filterableColumns: {
                age: [FilterOperator.BTW],
                name: true,
                color: true,
            },
        }
        const query: PaginateQuery = {
            path: '',
            filter: {
                name: '$or:Milo',
                color: '$or:white',
                age: '$btw:1,10',
            },
        }
        const result = await paginate<CatEntity>(query, catRepo, config)

        expect(result.data).toStrictEqual(
            cats.filter((cat) => (cat.name === 'Milo' || cat.color === 'white') && cat.age)
        )
        expect(result.links.current).toBe(
            '?page=1&limit=20&sortBy=id:ASC&filter.name=$or:Milo&filter.color=$or:white&filter.age=$btw:1,10'
        )
    })

    it('should return result based on two multifilters chained together with and operator', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            filterableColumns: {
                name: true,
                color: true,
            },
        }
        const query: PaginateQuery = {
            path: '',
            filter: {
                name: ['Milo', '$or:Garfield'],
                color: ['brown', '$or:white'],
            },
        }
        const result = await paginate<CatEntity>(query, catRepo, config)
        const expected = cats.filter(
            (cat) =>
                (cat.name === 'Milo' || cat.name === 'Garfield') && (cat.color === 'brown' || cat.color === 'white')
        )
        expect(result.data).toStrictEqual(expected)
        expect(result.links.current).toBe(
            '?page=1&limit=20&sortBy=id:ASC&filter.name=Milo&filter.name=$or:Garfield&filter.color=brown&filter.color=$or:white'
        )
    })

    it('should return result based on two multifilters chained together with or operator', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            filterableColumns: {
                name: true,
                color: true,
            },
        }
        const query: PaginateQuery = {
            path: '',
            filter: {
                name: ['$or:Milo', '$or:Garfield'],
                color: ['$or:brown', '$or:white'],
            },
        }
        const result = await paginate<CatEntity>(query, catRepo, config)
        const expected = cats.filter(
            (cat) => cat.name === 'Milo' || cat.name === 'Garfield' || cat.color === 'brown' || cat.color === 'white'
        )
        expect(result.data).toStrictEqual(expected)
        expect(result.links.current).toBe(
            '?page=1&limit=20&sortBy=id:ASC&filter.name=$or:Milo&filter.name=$or:Garfield&filter.color=$or:brown&filter.color=$or:white'
        )
    })

    it('should return result based on filters chained together with and operators and or operators', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            filterableColumns: {
                name: true,
                color: true,
                age: true,
                cutenessLevel: true,
            },
        }
        const query: PaginateQuery = {
            path: '',
            filter: {
                name: ['$or:Milo', '$or:Garfield'],
                age: '$or:$null',
                color: ['brown', '$or:white'],
                cutenessLevel: [CutenessLevel.HIGH, `$or:${CutenessLevel.LOW}`],
            },
        }
        const result = await paginate<CatEntity>(query, catRepo, config)
        const expected = cats.filter(
            (cat) =>
                (cat.name === 'Milo' || cat.name === 'Garfield' || cat.age === null) &&
                (cat.color === 'brown' || cat.color === 'white') &&
                (cat.cutenessLevel === CutenessLevel.HIGH || cat.cutenessLevel === CutenessLevel.LOW)
        )
        expect(result.data).toStrictEqual(expected)
        expect(result.links.current).toBe(
            '?page=1&limit=20&sortBy=id:ASC&filter.name=$or:Milo&filter.name=$or:Garfield&filter.age=$or:$null&filter.color=brown&filter.color=$or:white&filter.cutenessLevel=high&filter.cutenessLevel=$or:low'
        )
    })

    it("should return primary columns if select doesn't contain all primary columns", async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id', 'name'],
            select: ['name'],
        }
        const query: PaginateQuery = {
            path: '',
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        result.data.forEach((cat, index) => {
            expect(cat.id).toBe(cats[index].id)
            expect(cat.name).toBe(cats[index].name)
        })
        expect(result.meta.select).toStrictEqual(undefined)
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC')
    })

    it('should return all items even if deleted', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            withDeleted: true,
        }
        const query: PaginateQuery = {
            path: '',
        }
        await catRepo.softDelete({ id: cats[0].id })
        const result = await paginate<CatEntity>(query, catRepo, config)
        expect(result.meta.totalItems).toBe(cats.length)
        await catRepo.restore({ id: cats[0].id })
    })

    it('should return all items even if deleted, by passing with deleted in query params', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            allowWithDeletedInQuery: true,
        }
        const query: PaginateQuery = {
            path: '',
            withDeleted: true,
        }
        await catRepo.softDelete({ id: cats[0].id })
        const result = await paginate<CatEntity>(query, catRepo, config)
        expect(result.meta.totalItems).toBe(cats.length)
        await catRepo.restore({ id: cats[0].id })
    })

    it('should return all items even if deleted if config specified withDeleted false', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            allowWithDeletedInQuery: true,
            withDeleted: false,
        }
        const query: PaginateQuery = {
            path: '',
            withDeleted: true,
        }
        await catRepo.softDelete({ id: cats[0].id })
        const result = await paginate<CatEntity>(query, catRepo, config)
        expect(result.meta.totalItems).toBe(cats.length)
        await catRepo.restore({ id: cats[0].id })
    })

    it('should not return items with deleted not allowed in config', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
        }
        const query: PaginateQuery = {
            path: '',
            withDeleted: true,
        }
        await catRepo.softDelete({ id: cats[0].id })
        const result = await paginate<CatEntity>(query, catRepo, config)
        expect(result.meta.totalItems).toBe(cats.length - 1)
        await catRepo.restore({ id: cats[0].id })
    })

    it('should return all relation items even if deleted', async () => {
        const config: PaginateConfig<CatHomeEntity> = {
            sortableColumns: ['id'],
            withDeleted: true,
            relations: ['cat'],
        }
        const query: PaginateQuery = {
            path: '',
        }
        await catRepo.softDelete({ id: cats[0].id })
        const result = await paginate<CatHomeEntity>(query, catHomeRepo, config)
        expect(result.data[0].cat).not.toBeNull()
        await catRepo.restore({ id: cats[0].id })
    })

    it('should return only undeleted items', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            withDeleted: false,
        }
        const query: PaginateQuery = {
            path: '',
        }
        await catRepo.softDelete({ id: cats[0].id })
        const result = await paginate<CatEntity>(query, catRepo, config)
        expect(result.meta.totalItems).toBe(cats.length - 1)
        await catRepo.restore({ id: cats[0].id })
    })

    it('should return the specified columns only', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            select: ['id', 'name'],
        }
        const query: PaginateQuery = {
            path: '',
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        result.data.forEach((cat) => {
            expect(cat.id).toBeDefined()
            expect(cat.name).toBeDefined()
            expect(cat.color).not.toBeDefined()
        })
        expect(result.meta.select).toBe(undefined)
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC')
    })

    it('should ignore query select', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
        }
        const query: PaginateQuery = {
            path: '',
            select: ['id', 'name'],
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        result.data.forEach((cat) => {
            expect(cat.id).toBeDefined()
            expect(cat.name).toBeDefined()
            expect(cat.color).toBeDefined()
        })
        expect(result.meta.select).toEqual(undefined)
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC')
    })

    it('should only query select columns which have been config selected', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            select: ['id', 'name', 'color'],
        }
        const query: PaginateQuery = {
            path: '',
            select: ['id', 'color', 'age'],
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        result.data.forEach((cat) => {
            expect(cat.id).toBeDefined()
            expect(cat.name).not.toBeDefined()
            expect(cat.color).toBeDefined()
            expect(cat.age).not.toBeDefined()
        })
        expect(result.meta.select).toEqual(['id', 'color'])
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&select=id,color')
    })

    it('should return the specified relationship columns only', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['name'],
            select: ['id', 'name', 'toys.name'],
            relations: ['toys'],
        }
        const query: PaginateQuery = {
            path: '',
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        result.data.forEach((cat) => {
            expect(cat.id).toBeDefined()
            expect(cat.name).toBeDefined()
            expect(cat.color).not.toBeDefined()

            cat.toys.map((toy) => {
                expect(toy.name).toBeDefined()
                expect(toy.id).not.toBeDefined()
            })
        })
        expect(result.meta.select).toBe(undefined)
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=name:ASC')
    })

    it('should return selected columns', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id', 'name'],
            select: ['id', 'name', 'toys.name', 'toys.(size.height)', 'toys.(size.length)'],
            relations: ['toys'],
        }
        const query: PaginateQuery = {
            path: '',
            select: ['id', 'toys.(size.height)'],
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        result.data.forEach((cat) => {
            expect(cat.id).toBeDefined()
            expect(cat.name).not.toBeDefined()
        })

        result.data.forEach((cat) => {
            if (cat.id === 1 || cat.id === 2) {
                const toy = cat.toys[0]
                expect(toy.name).not.toBeDefined()
                expect(toy.id).not.toBeDefined()
                expect(toy.size.height).toBeDefined()
            } else {
                expect(cat.toys).toHaveLength(0)
            }
        })
        expect(result.meta.select).toStrictEqual(['id', 'toys.(size.height)'])
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&select=id,toys.(size.height)')
    })

    it('should only select columns via query which are selected in config', async () => {
        const config: PaginateConfig<CatEntity> = {
            select: ['id', 'home.id', 'home.pillows.id'],
            relations: { home: { pillows: true, naptimePillow: { brand: true } } },
            sortableColumns: ['id', 'name'],
        }
        const query: PaginateQuery = {
            path: '',
            select: ['id', 'home.id', 'home.name'],
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        result.data.forEach((cat) => {
            expect(cat.id).toBeDefined()

            if (cat.id === 1 || cat.id === 2 || cat.id == 3) {
                expect(cat.home.id).toBeDefined()
                expect(cat.home.name).not.toBeDefined()
            } else {
                expect(cat.home).toBeNull()
            }
        })
        expect(result.meta.select).toStrictEqual(['id', 'home.id'])
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&select=id,home.id')
    })

    it('should return the specified nested relationship columns only', async () => {
        const config: PaginateConfig<CatEntity> = {
            select: ['id', 'home.id', 'home.pillows.id', 'home.naptimePillow.brand'],
            relations: { home: { pillows: true, naptimePillow: { brand: true } } },
            sortableColumns: ['id', 'name'],
        }
        const query: PaginateQuery = {
            path: '',
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        result.data.forEach((cat) => {
            expect(cat.id).toBeDefined()
            expect(cat.name).not.toBeDefined()

            if (cat.id === 1 || cat.id === 2 || cat.id == 3) {
                expect(cat.home.id).toBeDefined()
                expect(cat.home.name).not.toBeDefined()
                expect(cat.home.countCat).not.toBeDefined()

                cat.home.pillows.forEach((pillow) => {
                    expect(pillow.id).toBeDefined()
                    expect(pillow.color).not.toBeDefined()
                })
            } else {
                expect(cat.home).toBeNull()
            }
        })
        expect(result.meta.select).toBe(undefined)
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC')
    })

    it('should return the right amount of results if a many to many relation is involved', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            defaultSortBy: [['id', 'ASC']],
            relations: ['friends'],
        }
        const query: PaginateQuery = {
            path: '',
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        expect(result.meta.totalItems).toBe(7)
        expect(result.data.length).toBe(7)
        expect(result.data[0].friends.length).toBe(6)
    })

    it('should return eager relations when set the property `loadEagerRelations` as true', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            defaultSortBy: [['id', 'ASC']],
            loadEagerRelations: true,
            searchableColumns: ['name'],
        }

        const query: PaginateQuery = {
            path: '',
            search: 'Garfield',
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        expect(result.data[0].toys).toBeDefined()

        expect(result.data[0].toys).toHaveLength(1)
    })

    it('should search nested relations', async () => {
        const config: PaginateConfig<CatEntity> = {
            relations: { home: { pillows: true, naptimePillow: { brand: true } } },
            sortableColumns: ['id', 'name'],
            searchableColumns: ['name', 'home.pillows.color', 'home.naptimePillow.brand'],
        }
        const query: PaginateQuery = {
            path: '',
            search: 'pink',
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        const cat = clone(cats[1])
        const catHomesClone = clone(catHomes[1])
        const catHomePillowsClone = clone(catHomePillows[3])
        delete catHomePillowsClone.home

        catHomesClone.countCat = cats.filter((cat) => cat.id === catHomesClone.cat.id).length
        catHomesClone.pillows = [catHomePillowsClone]
        cat.home = catHomesClone
        delete cat.home.cat

        expect(result.meta.search).toStrictEqual('pink')
        expect(result.data).toStrictEqual([cat])
        expect(result.data[0].home).toBeDefined()
        expect(result.data[0].home.pillows).toStrictEqual(cat.home.pillows)
    })

    it('should filter nested relations', async () => {
        const config: PaginateConfig<CatEntity> = {
            relations: { home: { pillows: true, naptimePillow: { brand: true } } },
            sortableColumns: ['id', 'name'],
            filterableColumns: { 'home.pillows.color': [FilterOperator.EQ] },
        }
        const query: PaginateQuery = {
            path: '',
            filter: { 'home.pillows.color': 'pink' },
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        const cat = clone(cats[1])
        const catHomesClone = clone(catHomes[1])
        const catHomePillowsClone = clone(catHomePillows[3])
        delete catHomePillowsClone.home

        catHomesClone.countCat = cats.filter((cat) => cat.id === catHomesClone.cat.id).length
        catHomesClone.pillows = [catHomePillowsClone]
        cat.home = catHomesClone
        delete cat.home.cat

        expect(result.meta.filter['home.pillows.color']).toStrictEqual('pink')
        expect(result.data).toStrictEqual([cat])
        expect(result.data[0].home).toBeDefined()
        expect(result.data[0].home.pillows).toStrictEqual(cat.home.pillows)
    })

    it('should allow all filters on a field when passing boolean', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            filterableColumns: {
                id: true,
            },
        }
        const query: PaginateQuery = {
            path: '',
            filter: {
                id: '$not:$in:1,2,5',
            },
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        expect(result.data).toStrictEqual([cats[2], cats[3], cats[5], cats[6]])
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&filter.id=$not:$in:1,2,5')
    })

    it('should ignore all filters on a field when not passing anything', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
        }
        const query: PaginateQuery = {
            path: '',
            filter: {
                id: '$not:$in:1,2,5',
            },
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        expect(result.data).toStrictEqual([cats[0], cats[1], cats[2], cats[3], cats[4], cats[5], cats[6]])
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&filter.id=$not:$in:1,2,5')
    })

    it('should use searchBy in query param when ignoreSearchByInQueryParam is not defined', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            searchableColumns: ['name', 'color'],
        }
        const query: PaginateQuery = {
            path: '',
            search: 'Milo',
            searchBy: ['color'],
        }

        const result = await paginate<CatEntity>(query, catRepo, config)
        expect(result.data.length).toEqual(0)
        expect(result.meta.searchBy).toStrictEqual(['color'])
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&search=Milo&searchBy=color')
    })

    it('should use searchBy in query param when ignoreSearchByInQueryParam is set to false', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            ignoreSearchByInQueryParam: false,
            searchableColumns: ['name', 'color'],
        }
        const query: PaginateQuery = {
            path: '',
            search: 'Milo',
            searchBy: ['color'],
        }

        const result = await paginate<CatEntity>(query, catRepo, config)
        expect(result.data.length).toEqual(0)
        expect(result.meta.searchBy).toStrictEqual(['color'])
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&search=Milo&searchBy=color')
    })

    it('should ignore searchBy in query param when ignoreSearchByInQueryParam is set to true', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            ignoreSearchByInQueryParam: true,
            searchableColumns: ['name', 'color'],
        }
        const query: PaginateQuery = {
            path: '',
            search: 'Milo',
            searchBy: ['color'],
        }

        const result = await paginate<CatEntity>(query, catRepo, config)
        expect(result.data.length).toEqual(1)
        expect(result.data).toStrictEqual([cats[0]])
        expect(result.meta.searchBy).toStrictEqual(['name', 'color'])
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&search=Milo')
    })

    it('should use select in query param when ignoreSelectInQueryParam is not defined', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            select: ['id', 'name', 'color'],
        }
        const query: PaginateQuery = {
            path: '',
            select: ['id', 'color'],
        }

        const result = await paginate<CatEntity>(query, catRepo, config)
        expect(result.data[0]).toEqual({ id: cats[0].id, color: cats[0].color })
        expect(result.meta.select).toStrictEqual(['id', 'color'])
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&select=id,color')
    })

    it('should use select in query param when ignoreSelectInQueryParam is set to false', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            ignoreSelectInQueryParam: false,
            select: ['id', 'name', 'color'],
        }
        const query: PaginateQuery = {
            path: '',
            select: ['id', 'color'],
        }

        const result = await paginate<CatEntity>(query, catRepo, config)
        expect(result.data[0]).toEqual({ id: cats[0].id, color: cats[0].color })
        expect(result.meta.select).toStrictEqual(['id', 'color'])
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&select=id,color')
    })

    it('should ignore select in query param when ignoreSelectInQueryParam is set to true', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            ignoreSelectInQueryParam: true,
            select: ['id', 'name', 'color'],
        }
        const query: PaginateQuery = {
            path: '',
            select: ['id', 'color'],
        }

        const result = await paginate<CatEntity>(query, catRepo, config)
        expect(result.data[0]).toEqual({ id: cats[0].id, color: cats[0].color, name: cats[0].name })
        expect(result.meta.select).toEqual(undefined)
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC')
    })

    it('uses custom count builder when provided', async () => {
        const fakeQB = { getCount: jest.fn().mockResolvedValue(42) } as any
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            select: ['id', 'name', 'color'],
            buildCountQuery: () => fakeQB,
        }
        const query: PaginateQuery = {
            path: '',
            select: ['id', 'color'],
        }

        const page = await paginate<CatEntity>(query, catRepo, config)

        expect(fakeQB.getCount).toHaveBeenCalledTimes(1)
        expect(page.meta.totalItems).toBe(42)
    })

    describe('should return result based on date column filter', () => {
        it('with $not and $null operators', async () => {
            const config: PaginateConfig<CatEntity> = {
                sortableColumns: ['id'],
                filterableColumns: {
                    lastVetVisit: [FilterSuffix.NOT, FilterOperator.NULL],
                },
            }
            const query: PaginateQuery = {
                path: '',
                filter: {
                    lastVetVisit: '$not:$null',
                },
            }

            const result = await paginate<CatEntity>(query, catRepo, config)

            expect(result.meta.filter).toStrictEqual({
                lastVetVisit: '$not:$null',
            })
            expect(result.data).toStrictEqual([cats[0], cats[1], cats[2], cats[6]])
            expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&filter.lastVetVisit=$not:$null')
        })

        it('with $lt operator', async () => {
            const config: PaginateConfig<CatEntity> = {
                sortableColumns: ['id'],
                filterableColumns: {
                    lastVetVisit: [FilterOperator.LT],
                },
            }
            const query: PaginateQuery = {
                path: '',
                filter: {
                    lastVetVisit: '$lt:2022-12-20T10:00:00.000Z',
                },
            }

            const result = await paginate<CatEntity>(query, catRepo, config)

            expect(result.meta.filter).toStrictEqual({
                lastVetVisit: '$lt:2022-12-20T10:00:00.000Z',
            })
            expect(result.data).toStrictEqual([cats[0]])
            expect(result.links.current).toBe(
                '?page=1&limit=20&sortBy=id:ASC&filter.lastVetVisit=$lt:2022-12-20T10:00:00.000Z'
            )
        })

        it('with $lte operator', async () => {
            const config: PaginateConfig<CatEntity> = {
                sortableColumns: ['id'],
                filterableColumns: {
                    lastVetVisit: [FilterOperator.LTE],
                },
            }
            const query: PaginateQuery = {
                path: '',
                filter: {
                    lastVetVisit: '$lte:2022-12-20T10:00:00.000Z',
                },
            }

            const result = await paginate<CatEntity>(query, catRepo, config)

            expect(result.meta.filter).toStrictEqual({
                lastVetVisit: '$lte:2022-12-20T10:00:00.000Z',
            })
            expect(result.data).toStrictEqual([cats[0], cats[1]])
            expect(result.links.current).toBe(
                '?page=1&limit=20&sortBy=id:ASC&filter.lastVetVisit=$lte:2022-12-20T10:00:00.000Z'
            )
        })

        it('with $btw operator', async () => {
            const config: PaginateConfig<CatEntity> = {
                sortableColumns: ['id'],
                filterableColumns: {
                    lastVetVisit: [FilterOperator.BTW],
                },
            }
            const query: PaginateQuery = {
                path: '',
                filter: {
                    lastVetVisit: '$btw:2022-12-20T08:00:00.000Z,2022-12-20T12:00:00.000Z',
                },
            }

            const result = await paginate<CatEntity>(query, catRepo, config)

            expect(result.meta.filter).toStrictEqual({
                lastVetVisit: '$btw:2022-12-20T08:00:00.000Z,2022-12-20T12:00:00.000Z',
            })
            expect(result.data).toStrictEqual([cats[1]])
            expect(result.links.current).toBe(
                '?page=1&limit=20&sortBy=id:ASC&filter.lastVetVisit=$btw:2022-12-20T08:00:00.000Z,2022-12-20T12:00:00.000Z'
            )
        })

        it('with $eq operator', async () => {
            const config: PaginateConfig<CatEntity> = {
                sortableColumns: ['id'],
                filterableColumns: {
                    lastVetVisit: [FilterOperator.EQ],
                },
            }
            const query: PaginateQuery = {
                path: '',
                filter: {
                    lastVetVisit: '$eq:2022-12-21T10:00:00.000Z',
                },
            }

            const result = await paginate<CatEntity>(query, catRepo, config)

            expect(result.meta.filter).toStrictEqual({
                lastVetVisit: '$eq:2022-12-21T10:00:00.000Z',
            })
            expect(result.data).toStrictEqual([cats[2]])
            expect(result.links.current).toBe(
                '?page=1&limit=20&sortBy=id:ASC&filter.lastVetVisit=$eq:2022-12-21T10:00:00.000Z'
            )
        })

        it('with $gte operator', async () => {
            const config: PaginateConfig<CatEntity> = {
                sortableColumns: ['id'],
                filterableColumns: {
                    lastVetVisit: [FilterOperator.GTE],
                },
            }
            const query: PaginateQuery = {
                path: '',
                filter: {
                    lastVetVisit: '$gte:2022-12-20T10:00:00.000Z',
                },
            }

            const result = await paginate<CatEntity>(query, catRepo, config)

            expect(result.meta.filter).toStrictEqual({
                lastVetVisit: '$gte:2022-12-20T10:00:00.000Z',
            })
            expect(result.data).toStrictEqual([cats[1], cats[2], cats[6]])
            expect(result.links.current).toBe(
                '?page=1&limit=20&sortBy=id:ASC&filter.lastVetVisit=$gte:2022-12-20T10:00:00.000Z'
            )
        })

        it('with $gt operator', async () => {
            const config: PaginateConfig<CatEntity> = {
                sortableColumns: ['id'],
                filterableColumns: {
                    lastVetVisit: [FilterOperator.GT],
                },
            }
            const query: PaginateQuery = {
                path: '',
                filter: {
                    lastVetVisit: '$gt:2022-12-20T10:00:00.000Z',
                },
            }

            const result = await paginate<CatEntity>(query, catRepo, config)

            expect(result.meta.filter).toStrictEqual({
                lastVetVisit: '$gt:2022-12-20T10:00:00.000Z',
            })
            expect(result.data).toStrictEqual([cats[2], cats[6]])
            expect(result.links.current).toBe(
                '?page=1&limit=20&sortBy=id:ASC&filter.lastVetVisit=$gt:2022-12-20T10:00:00.000Z'
            )
        })

        it('with $lt operator and date only', async () => {
            {
                const config: PaginateConfig<CatEntity> = {
                    sortableColumns: ['id'],
                    filterableColumns: {
                        lastVetVisit: [FilterOperator.LT],
                    },
                }
                const query: PaginateQuery = {
                    path: '',
                    filter: {
                        lastVetVisit: '$lt:2022-12-20',
                    },
                }

                const result = await paginate<CatEntity>(query, catRepo, config)

                expect(result.meta.filter).toStrictEqual({
                    lastVetVisit: '$lt:2022-12-20',
                })
                expect(result.data).toStrictEqual([cats[0]])
                expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&filter.lastVetVisit=$lt:2022-12-20')
            }
            {
                const config: PaginateConfig<CatEntity> = {
                    sortableColumns: ['id'],
                    filterableColumns: {
                        lastVetVisit: [FilterOperator.LT],
                    },
                }
                const query: PaginateQuery = {
                    path: '',
                    filter: {
                        lastVetVisit: '$lt:2022-12-21',
                    },
                }

                const result = await paginate<CatEntity>(query, catRepo, config)

                expect(result.meta.filter).toStrictEqual({
                    lastVetVisit: '$lt:2022-12-21',
                })
                expect(result.data).toStrictEqual([cats[0], cats[1]])
                expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&filter.lastVetVisit=$lt:2022-12-21')
            }
        })
    })

    describe('should correctly handle number column filter', () => {
        it('with $eq operator and valid number', async () => {
            const config: PaginateConfig<CatEntity> = {
                sortableColumns: ['id'],
                filterableColumns: {
                    lastVetVisit: [FilterOperator.LT],
                },
            }
            const query: PaginateQuery = {
                path: '',
                filter: {
                    lastVetVisit: '$lt:2022-12-20T10:00:00.000Z',
                },
            }

            const result = await paginate<CatEntity>(query, catRepo, config)

            expect(result.meta.filter).toStrictEqual({
                lastVetVisit: '$lt:2022-12-20T10:00:00.000Z',
            })
            expect(result.data).toStrictEqual([cats[0]])
            expect(result.links.current).toBe(
                '?page=1&limit=20&sortBy=id:ASC&filter.lastVetVisit=$lt:2022-12-20T10:00:00.000Z'
            )
        })
    })

    if (process.env.DB === 'postgres') {
        describe('should return results for an array column', () => {
            it.each`
                operator        | data         | expectedIndexes
                ${'$not:$null'} | ${undefined} | ${[0, 1, 2, 3]}
                ${'$lt'}        | ${2}         | ${[2, 3]}
                ${'$lte'}       | ${2}         | ${[1, 2, 3]}
                ${'$btw'}       | ${'1,2'}     | ${[1, 2]}
                ${'$gte'}       | ${2}         | ${[0, 1]}
                ${'$gt'}        | ${2}         | ${[0]}
                ${'$contains'}  | ${'brown'}   | ${[0, 1]}
            `('with $operator operator', async ({ operator, data, expectedIndexes }) => {
                const config: PaginateConfig<CatHairEntity> = {
                    sortableColumns: ['id'],
                    filterableColumns: {
                        colors: true,
                    },
                }

                const queryFilter = `${operator}${data ? `:${data}` : ''}`
                const query: PaginateQuery = {
                    path: '',
                    filter: {
                        colors: queryFilter,
                    },
                }

                const result = await paginate<CatHairEntity>(query, catHairRepo, config)
                expect(result.meta.filter).toStrictEqual({
                    colors: queryFilter,
                })
                expect(result.data).toStrictEqual(expectedIndexes.map((index) => catHairs[index]))
                expect(result.links.current).toBe(`?page=1&limit=20&sortBy=id:ASC&filter.colors=${queryFilter}`)
            })

            it('should work with search', async () => {
                const config: PaginateConfig<CatHairEntity> = {
                    sortableColumns: ['id'],
                    searchableColumns: ['colors'],
                }

                const query: PaginateQuery = {
                    path: '',
                    search: 'brown',
                }

                const result = await paginate<CatHairEntity>(query, catHairRepo, config)

                expect(result.meta.search).toStrictEqual('brown')
                expect(result.data).toStrictEqual([catHairs[0], catHairs[1]])
                expect(result.links.current).toBe(`?page=1&limit=20&sortBy=id:ASC&search=brown`)
            })
        })
    }

    if (process.env.DB === 'postgres') {
        describe('should be able to filter on jsonb columns', () => {
            beforeAll(async () => {
                underCoats = await catHairRepo.save([
                    catHairRepo.create({
                        name: 'full',
                        colors: ['orange'],
                        metadata: { length: 50, thickness: 2 },
                        underCoat: catHairs[0],
                    }),
                ])
            })

            it('should filter with single value', async () => {
                const config: PaginateConfig<CatHairEntity> = {
                    sortableColumns: ['id'],
                    filterableColumns: {
                        'metadata.length': true,
                    },
                }
                const query: PaginateQuery = {
                    path: '',
                    filter: {
                        'metadata.length': '$eq:5',
                    },
                }

                const result = await paginate<CatHairEntity>(query, catHairRepo, config)

                expect(result.meta.filter).toStrictEqual({
                    'metadata.length': '$eq:5',
                })
                expect(result.data).toStrictEqual([catHairs[0]])
                expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&filter.metadata.length=$eq:5')
            })

            it('should filter with multiple values', async () => {
                const config: PaginateConfig<CatHairEntity> = {
                    sortableColumns: ['id'],
                    filterableColumns: {
                        'metadata.length': true,
                        'metadata.thickness': true,
                    },
                }
                const query: PaginateQuery = {
                    path: '',
                    filter: {
                        'metadata.length': '$eq:0.5',
                        'metadata.thickness': '$eq:10',
                    },
                }

                const result = await paginate<CatHairEntity>(query, catHairRepo, config)

                expect(result.meta.filter).toStrictEqual({
                    'metadata.length': '$eq:0.5',
                    'metadata.thickness': '$eq:10',
                })
                expect(result.data).toStrictEqual([catHairs[2]])
                expect(result.links.current).toBe(
                    '?page=1&limit=20&sortBy=id:ASC&filter.metadata.length=$eq:0.5&filter.metadata.thickness=$eq:10'
                )
            })

            it('should filter on a nested property through a relation', async () => {
                const config: PaginateConfig<CatHairEntity> = {
                    sortableColumns: ['id'],
                    filterableColumns: {
                        'underCoat.metadata.length': true,
                    },
                    relations: ['underCoat'],
                }
                const query: PaginateQuery = {
                    path: '',
                    filter: {
                        'underCoat.metadata.length': '$eq:50',
                    },
                }

                const result = await paginate<CatHairEntity>(query, catHairRepo, config)

                expect(result.meta.filter).toStrictEqual({
                    'underCoat.metadata.length': '$eq:50',
                })
                expect(result.data).toStrictEqual([underCoats[0]])
                expect(result.links.current).toBe(
                    '?page=1&limit=20&sortBy=id:ASC&filter.underCoat.metadata.length=$eq:50'
                )
            })
        })
    }

    if (process.env.DB !== 'postgres') {
        describe('should return result based on virtual column', () => {
            it('should return result sorted and filter by a virtual column in main entity', async () => {
                const config: PaginateConfig<CatHomeEntity> = {
                    sortableColumns: ['countCat'],
                    relations: ['cat', 'naptimePillow.brand'],
                    filterableColumns: {
                        countCat: [FilterOperator.GT],
                    },
                }
                const query: PaginateQuery = {
                    path: '',
                    filter: {
                        countCat: '$gt:0',
                    },
                    sortBy: [['countCat', 'ASC']],
                }

                const result = await paginate<CatHomeEntity>(query, catHomeRepo, config)

                expect(result.data).toStrictEqual([catHomes[0], catHomes[1], catHomes[2]])
                expect(result.links.current).toBe('?page=1&limit=20&sortBy=countCat:ASC&filter.countCat=$gt:0')
            })

            it('should return result based on virtual column filter', async () => {
                const config: PaginateConfig<CatEntity> = {
                    sortableColumns: ['id'],
                    filterableColumns: {
                        'home.countCat': [FilterOperator.GT],
                    },
                    relations: ['home', 'home.naptimePillow.brand'],
                }
                const query: PaginateQuery = {
                    path: '',
                    filter: {
                        'home.countCat': '$gt:0',
                    },
                    sortBy: [['id', 'ASC']],
                }

                const result = await paginate<CatEntity>(query, catRepo, config)
                const expectedResult = [0, 1, 2].map((i) => {
                    const ret = Object.assign(clone(cats[i]), { home: Object.assign(clone(catHomes[i])) })
                    delete ret.home.cat
                    return ret
                })

                expect(result.data).toStrictEqual(expectedResult)
                expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&filter.home.countCat=$gt:0')
            })

            it('should return result sorted by a virtual column', async () => {
                const config: PaginateConfig<CatEntity> = {
                    sortableColumns: ['home.countCat'],
                    relations: ['home', 'home.naptimePillow.brand'],
                }
                const query: PaginateQuery = {
                    path: '',
                    sortBy: [['home.countCat', 'ASC']],
                }

                const result = await paginate<CatEntity>(query, catRepo, config)
                const expectedResult = [3, 4, 5, 6, 0, 1, 2].map((i) => {
                    const ret = clone(cats[i])
                    if (i < 3) {
                        ret.home = clone(catHomes[i])
                        ret.home.countCat = cats.filter((cat) => cat.id === ret.home.cat.id).length
                        delete ret.home.cat
                    } else {
                        ret.home = null
                    }
                    return ret
                })

                expect(result.data).toStrictEqual(expectedResult)
                expect(result.links.current).toBe('?page=1&limit=20&sortBy=home.countCat:ASC')
            })
        })
    }

    describe('cursor pagination', () => {
        describe('sortBy: id', () => {
            it('should paginate using cursor (sortableColumns[0], ASC)', async () => {
                const config: PaginateConfig<CatEntity> = {
                    sortableColumns: ['id'],
                    paginationType: PaginationType.CURSOR,
                    defaultLimit: 2,
                }
                const query: PaginateQuery = {
                    path: '',
                }

                const result = await paginate<CatEntity>(query, catRepo, config)

                expect(result.data).toStrictEqual(cats.slice(0, 2))
                expect(result.meta.itemsPerPage).toBe(2)
                expect(result.meta.cursor).toBeUndefined()
                expect(result.links.previous).toBe('?limit=2&sortBy=id:DESC&cursor=V00000000001V0000') // id=1, DESC (Milo) -> V + LPAD(1, 11, '0') + V + LPAD(0, 4, '0')
                expect(result.links.next).toBe(`?limit=2&sortBy=id:ASC&cursor=V99999999998X0000`) // id=2, ASC (Garfield) -> V + 10^11 - 2 + X + LPAD(0, 4, '0')
            })

            it('should paginate using cursor (id, ASC)', async () => {
                const config: PaginateConfig<CatEntity> = {
                    sortableColumns: ['id'],
                    paginationType: PaginationType.CURSOR,
                    defaultLimit: 2,
                }
                const query: PaginateQuery = {
                    path: '',
                    sortBy: [['id', 'ASC']],
                }

                const result = await paginate<CatEntity>(query, catRepo, config)

                expect(result.data).toStrictEqual(cats.slice(0, 2))
                expect(result.meta.itemsPerPage).toBe(2)
                expect(result.meta.cursor).toBeUndefined()
                expect(result.links.previous).toBe('?limit=2&sortBy=id:DESC&cursor=V00000000001V0000') // id=1, DESC (Milo) -> V + LPAD(1, 11, '0') + V + LPAD(0, 4, '0')
                expect(result.links.next).toBe(`?limit=2&sortBy=id:ASC&cursor=V99999999998X0000`) // id=2, ASC (Garfield) -> V + 10^11 - 2 + X + LPAD(0, 4, '0')
            })

            it('should paginate using cursor with specific cursor value (id, ASC)', async () => {
                const config: PaginateConfig<CatEntity> = {
                    sortableColumns: ['id'],
                    paginationType: PaginationType.CURSOR,
                    defaultLimit: 2,
                }
                const query: PaginateQuery = {
                    path: '',
                    cursor: 'V99999999998X0000', // id=2, ASC (Garfield)
                }

                const result = await paginate<CatEntity>(query, catRepo, config)

                expect(result.data).toStrictEqual(cats.slice(2, 4))
                expect(result.meta.itemsPerPage).toBe(2)
                expect(result.meta.cursor).toBe('V99999999998X0000')
                expect(result.links.previous).toBe(`?limit=2&sortBy=id:DESC&cursor=V00000000003V0000`) // id=3, DESC (Shadow) -> V + LPAD(3, 11, '0') + V + LPAD(0, 4, '0')
                expect(result.links.next).toBe(`?limit=2&sortBy=id:ASC&cursor=V99999999996X0000`) // id=4, ASC (George) -> V + 10^11 - 4 + X + LPAD(0, 4, '0')
            })

            it('should handle end of data with cursor pagination (id, ASC)', async () => {
                const config: PaginateConfig<CatEntity> = {
                    sortableColumns: ['id'],
                    paginationType: PaginationType.CURSOR,
                    defaultLimit: 10,
                }
                const query: PaginateQuery = {
                    path: '',
                    cursor: 'V99999999993X0000', // id=7, ASC (Baby) -> V + 10^11 - 7 + X + LPAD(0, 4, '0')
                }

                const result = await paginate<CatEntity>(query, catRepo, config)

                expect(result.data).toStrictEqual([])
                expect(result.meta.itemsPerPage).toBe(0)
                expect(result.meta.cursor).toBe('V99999999993X0000')
                expect(result.links.previous).toBeUndefined()
                expect(result.links.next).toBeUndefined()
            })

            it('should paginate using cursor (id, DESC)', async () => {
                const config: PaginateConfig<CatEntity> = {
                    sortableColumns: ['id'],
                    paginationType: PaginationType.CURSOR,
                    defaultLimit: 2,
                }
                const query: PaginateQuery = {
                    path: '',
                    sortBy: [['id', 'DESC']],
                }

                const result = await paginate<CatEntity>(query, catRepo, config)

                expect(result.data).toStrictEqual(cats.slice(5, 7).reverse())
                expect(result.meta.itemsPerPage).toBe(2)
                expect(result.meta.cursor).toBeUndefined()
                expect(result.links.previous).toBe(`?limit=2&sortBy=id:ASC&cursor=V99999999993X0000`) // id=7, ASC (Adam) -> V + 10^11 - 7 + X + LPAD(0, 4, '0')
                expect(result.links.next).toBe('?limit=2&sortBy=id:DESC&cursor=V00000000006V0000') // id=6, DESC (Baby) -> V + LPAD(6, 11, '0') + V + LPAD(0, 4, '0')
            })

            it('should paginate using cursor with specific cursor value (id, DESC)', async () => {
                const config: PaginateConfig<CatEntity> = {
                    sortableColumns: ['id'],
                    paginationType: PaginationType.CURSOR,
                    defaultLimit: 2,
                }
                const query: PaginateQuery = {
                    path: '',
                    cursor: 'V00000000004V0000', // id=4, DESC (George) -> V + LPAD(4, 11, '0') + V + LPAD(0, 4, '0')
                    sortBy: [['id', 'DESC']],
                }

                const result = await paginate<CatEntity>(query, catRepo, config)

                expect(result.data).toStrictEqual(cats.slice(1, 3).reverse())
                expect(result.meta.itemsPerPage).toBe(2)
                expect(result.meta.cursor).toBe('V00000000004V0000')
                expect(result.links.previous).toBe(`?limit=2&sortBy=id:ASC&cursor=V99999999997X0000`) // id=3, ASC (Shadow) -> V + 10^11 - 3 + X + LPAD(0, 4, '0')
                expect(result.links.next).toBe(`?limit=2&sortBy=id:DESC&cursor=V00000000002V0000`) // id=2, DESC (Garfield) -> V + LPAD(2, 11, '0') + V + LPAD(0, 4, '0')
            })

            it('should handle end of data with cursor pagination (id, DESC)', async () => {
                const config: PaginateConfig<CatEntity> = {
                    sortableColumns: ['id'],
                    paginationType: PaginationType.CURSOR,
                    defaultLimit: 10,
                }
                const query: PaginateQuery = {
                    path: '',
                    cursor: 'V00000000001V0000', // id=1, DESC (Milo) -> V + LPAD(1, 11, '0') + V + LPAD(0, 4, '0')
                    sortBy: [['id', 'DESC']],
                }

                const result = await paginate<CatEntity>(query, catRepo, config)

                expect(result.data).toStrictEqual([])
                expect(result.meta.itemsPerPage).toBe(0)
                expect(result.meta.cursor).toBe('V00000000001V0000')
                expect(result.links.previous).toBeUndefined()
                expect(result.links.next).toBeUndefined()
            })
        })

        describe('sortBy: lastVetVisit', () => {
            it('should handle date type cursor column (lastVetVisit, ASC)', async () => {
                const config: PaginateConfig<CatEntity> = {
                    sortableColumns: ['id', 'lastVetVisit'],
                    paginationType: PaginationType.CURSOR,
                    defaultSortBy: [['lastVetVisit', 'ASC']],
                    defaultLimit: 2,
                }
                const query: PaginateQuery = {
                    path: '',
                    cursor: 'V998328556000000', // lastVetVisit=2022-12-19T10:00:00.000Z, ASC (Milo) -> V + 10^15 - 1671444000000
                }

                const result = await paginate<CatEntity>(query, catRepo, config)

                expect(result.data).toStrictEqual([cats[1], cats[2]]) // Garfield, Shadow
                expect(result.links.previous).toBe(`?limit=2&sortBy=lastVetVisit:DESC&cursor=V001671530400000`) // lastVetVisit=2022-12-20T10:00:00.000Z, DESC (Garfield) -> V + LPAD(1671530400000, 15, '0')
                expect(result.links.next).toBe(`?limit=2&sortBy=lastVetVisit:ASC&cursor=V998328383200000`) // lastVetVisit=2022-12-21T10:00:00.000Z, ASC (Shadow) -> V + 10^15 - 1671616800000
            })

            it('should handle date type cursor column with reverse order (lastVetVisit, DESC)', async () => {
                const config: PaginateConfig<CatEntity> = {
                    sortableColumns: ['id', 'lastVetVisit'],
                    paginationType: PaginationType.CURSOR,
                    defaultSortBy: [['lastVetVisit', 'DESC']],
                    defaultLimit: 2,
                }
                const query: PaginateQuery = {
                    path: '',
                    cursor: 'V001671616800000', // lastVetVisit=2022-12-21T10:00:00.000Z, DESC (Shadow) -> V + LPAD(1671616800000, 15, '0')
                }

                const result = await paginate<CatEntity>(query, catRepo, config)

                expect(result.data).toStrictEqual([cats[1], cats[0]]) // Garfield, Milo
                expect(result.links.previous).toBe(`?limit=2&sortBy=lastVetVisit:ASC&cursor=V998328469600000`) // lastVetVisit=2022-12-20T10:00:00.000Z, ASC (Garfield) -> V + 10^15 - 1671530400000
                expect(result.links.next).toBe(`?limit=2&sortBy=lastVetVisit:DESC&cursor=V001671444000000`) // lastVetVisit=2022-12-19T10:00:00.000Z, DESC (Milo) -> V + LPAD(1671444000000, 15, '0')
            })

            // The range of mysql timestamp is from 1970-01-01 00:00:01
            if (process.env.DB !== 'mariadb') {
                it('should handle date type cursor column with zero timestamp (lastVetVisit, ASC)', async () => {
                    // Create a new cat with lastVetVisit = new Date(0)
                    const zeroDateCat = await catRepo.save(
                        catRepo.create({
                            name: 'ZeroCat',
                            color: 'grey',
                            age: 1,
                            cutenessLevel: CutenessLevel.LOW,
                            lastVetVisit: isoStringToDate('1970-01-01T00:00:00.000Z'), // new Date(0)
                            size: { height: 20, width: 10, length: 30 },
                            weightChange: 0,
                        })
                    )

                    const config: PaginateConfig<CatEntity> = {
                        sortableColumns: ['id', 'lastVetVisit'],
                        paginationType: PaginationType.CURSOR,
                        defaultSortBy: [['lastVetVisit', 'ASC']],
                        defaultLimit: 2,
                    }
                    const query: PaginateQuery = {
                        path: '',
                    }

                    const result = await paginate<CatEntity>(query, catRepo, config)

                    // Should appear first as it has the earliest possible timestamp
                    expect(result.data[0]).toStrictEqual(zeroDateCat)
                    expect(result.links.previous).toBe(`?limit=2&sortBy=lastVetVisit:DESC&cursor=V000000000000000`) // lastVetVisit=1970-01-01T00:00:00.000Z, DESC (ZeroCat)
                    expect(result.links.next).toBe(`?limit=2&sortBy=lastVetVisit:ASC&cursor=V998328556000000`) // lastVetVisit=2022-12-19T10:00:00.000Z, ASC (Milo)

                    // Clean up
                    await catRepo.remove(zeroDateCat)
                })

                it('should handle date type cursor column with zero timestamp (lastVetVisit, DESC)', async () => {
                    // Create a new cat with lastVetVisit = new Date(0)
                    const zeroDateCat = await catRepo.save(
                        catRepo.create({
                            name: 'ZeroCat',
                            color: 'grey',
                            age: 1,
                            cutenessLevel: CutenessLevel.LOW,
                            lastVetVisit: isoStringToDate('1970-01-01T00:00:00.000Z'), // new Date(0)
                            size: { height: 20, width: 10, length: 30 },
                            weightChange: 0,
                        })
                    )

                    const config: PaginateConfig<CatEntity> = {
                        sortableColumns: ['id', 'lastVetVisit'],
                        paginationType: PaginationType.CURSOR,
                        defaultSortBy: [['lastVetVisit', 'DESC']],
                        defaultLimit: 2,
                        filterableColumns: {
                            lastVetVisit: [FilterOperator.NULL, FilterSuffix.NOT],
                        },
                    }
                    const query: PaginateQuery = {
                        path: '',
                        filter: { lastVetVisit: '$not:$null' }, // to ensure null values are not included
                        cursor: 'V001671444000000', // lastVetVisit=2022-12-19T10:00:00.000Z, DESC (Milo)
                    }

                    const result = await paginate<CatEntity>(query, catRepo, config)

                    // Should appear last as it has the earliest possible timestamp
                    expect(result.data[result.data.length - 1]).toStrictEqual(zeroDateCat)
                    expect(result.links.previous).toBe(
                        `?limit=2&sortBy=lastVetVisit:ASC&filter.lastVetVisit=$not:$null&cursor=X000000000000000`
                    ) // lastVetVisit=1970-01-01T00:00:00.000Z, ASC (ZeroCat)
                    expect(result.links.next).toBe(
                        `?limit=2&sortBy=lastVetVisit:DESC&filter.lastVetVisit=$not:$null&cursor=V000000000000000`
                    ) // lastVetVisit=1970-01-01T00:00:00.000Z, DESC (ZeroCat)

                    // Clean up
                    await catRepo.remove(zeroDateCat)
                })
            }
        })

        describe('sortBy: age, lastVetVisit', () => {
            it('should handle multiple cursor columns checking sorted data (age:ASC, lastVetVisit:ASC)', async () => {
                const config: PaginateConfig<CatEntity> = {
                    sortableColumns: ['age', 'lastVetVisit'],
                    paginationType: PaginationType.CURSOR,
                }
                const query: PaginateQuery = {
                    path: '',
                    sortBy: [
                        ['age', 'ASC'],
                        ['lastVetVisit', 'ASC'],
                    ],
                }

                const result = await paginate<CatEntity>(query, catRepo, config)

                const ageNotNullCats = cats.filter((cat) => cat.age !== null)
                const ageNullCats = cats.filter((cat) => cat.age === null)
                const sortedAgeNotNullCats = ageNotNullCats.sort((a, b) => {
                    if (a.age === b.age) {
                        return a.lastVetVisit.getTime() - b.lastVetVisit.getTime()
                    }
                    return a.age - b.age
                })
                const sortedAgeNullCats = ageNullCats.sort((a, b) => {
                    return a.lastVetVisit.getTime() - b.lastVetVisit.getTime()
                })

                expect(result.data).toStrictEqual([...sortedAgeNotNullCats, ...sortedAgeNullCats])
                expect(result.meta.cursor).toBeUndefined()
                expect(result.meta.sortBy).toStrictEqual([
                    ['age', 'ASC'],
                    ['lastVetVisit', 'ASC'],
                ])
                expect(result.links.previous).toBe(
                    '?limit=20&sortBy=age:DESC&sortBy=lastVetVisit:DESC&cursor=N00000000000X0000A000000000000000'
                ) // age=0, DESC + lastVetVisit=null, DESC (Baby) -> N + LPAD(0, 11, '0') + X + LPAD(0, 4, '0') + A + LPAD(0, 15, '0')
                expect(result.links.next).toBe(
                    '?limit=20&sortBy=age:ASC&sortBy=lastVetVisit:ASC&cursor=A000000000000000A000000000000000'
                ) // age=null, ASC + lastVetVisit=null, ASC (Leche) -> A + LPAD(0, 15, '0') + A + LPAD(0, 15, '0')
            })

            it('should handle multiple cursor columns checking combined cursor (age:ASC, lastVetVisit:ASC)', async () => {
                const config: PaginateConfig<CatEntity> = {
                    sortableColumns: ['age', 'lastVetVisit'],
                    paginationType: PaginationType.CURSOR,
                    defaultLimit: 4,
                }
                const query: PaginateQuery = {
                    path: '',
                    sortBy: [
                        ['age', 'ASC'],
                        ['lastVetVisit', 'ASC'],
                    ],
                }

                const result = await paginate<CatEntity>(query, catRepo, config)

                expect(result.data).toStrictEqual([cats[5], cats[3], cats[2], cats[6]]) // Baby, George, Shadow, Adam
                expect(result.meta.itemsPerPage).toBe(4)
                expect(result.meta.cursor).toBeUndefined()
                expect(result.meta.sortBy).toStrictEqual([
                    ['age', 'ASC'],
                    ['lastVetVisit', 'ASC'],
                ])
                expect(result.links.previous).toBe(
                    '?limit=4&sortBy=age:DESC&sortBy=lastVetVisit:DESC&cursor=N00000000000X0000A000000000000000'
                ) // age=0, DESC + lastVetVisit=null, DESC (Baby) -> N + LPAD(0, 11, '0') + X + LPAD(0, 4, '0') + A + LPAD(0, 15, '0')
                expect(result.links.next).toBe(
                    '?limit=4&sortBy=age:ASC&sortBy=lastVetVisit:ASC&cursor=V99999999996X0000V998328296800000'
                ) // age=4, ASC + lastVetVisit=2022-12-22T10:00:00.000Z, ASC (Adam) -> V + 10^11 - 4 + X + LPAD(0, 4, '0') + V + 10^15 - 1671703200000

                const result2 = await paginate<CatEntity>(
                    { ...query, cursor: 'V99999999996X0000V998328296800000' },
                    catRepo,
                    config
                )

                expect(result2.data).toStrictEqual([cats[1], cats[0], cats[4]]) // Garfield, Milo, Leche
                expect(result2.meta.cursor).toBe('V99999999996X0000V998328296800000')
                expect(result2.meta.sortBy).toStrictEqual([
                    ['age', 'ASC'],
                    ['lastVetVisit', 'ASC'],
                ])
                expect(result2.links.previous).toBe(
                    '?limit=4&sortBy=age:DESC&sortBy=lastVetVisit:DESC&cursor=V00000000005V0000V001671530400000'
                ) // age=5, DESC + lastVetVisit=2022-12-20T10:00:00.000Z, DESC (Garfield) -> V + LPAD(5, 11, '0') + V + LPAD(0, 4, '0') + V + LPAD(1671530400000, 15, '0')
                expect(result2.links.next).toBe(
                    `?limit=4&sortBy=age:ASC&sortBy=lastVetVisit:ASC&cursor=A000000000000000A000000000000000`
                ) // age=null, ASC + lastVetVisit=null, ASC (Leche) -> A + LPAD(0, 15, '0') + A + LPAD(0, 15, '0')
            })

            it('should handle multiple cursor columns with different directions (age:DESC, lastVetVisit:ASC)', async () => {
                const config: PaginateConfig<CatEntity> = {
                    sortableColumns: ['age', 'lastVetVisit'],
                    paginationType: PaginationType.CURSOR,
                }
                const query: PaginateQuery = {
                    path: '',
                    sortBy: [
                        ['age', 'DESC'],
                        ['lastVetVisit', 'ASC'],
                    ],
                }

                const result = await paginate<CatEntity>(query, catRepo, config)

                const ageNotNullCats = cats.filter((cat) => cat.age !== null)
                const ageNullCats = cats.filter((cat) => cat.age === null)
                const sortedAgeNotNullCats = ageNotNullCats.sort((a, b) => {
                    if (a.age === b.age) {
                        return a.lastVetVisit.getTime() - b.lastVetVisit.getTime()
                    }
                    return b.age - a.age
                })
                const sortedAgeNullCats = ageNullCats.sort((a, b) => {
                    return a.lastVetVisit.getTime() - b.lastVetVisit.getTime()
                })

                expect(result.data).toStrictEqual([...sortedAgeNotNullCats, ...sortedAgeNullCats]) // Milo, Garfield, Shadow, Adam, George, Baby, Leche
                expect(result.meta.cursor).toBeUndefined()
                expect(result.meta.sortBy).toStrictEqual([
                    ['age', 'DESC'],
                    ['lastVetVisit', 'ASC'],
                ])
                expect(result.links.previous).toBe(
                    '?limit=20&sortBy=age:ASC&sortBy=lastVetVisit:DESC&cursor=V99999999994X0000V001671444000000'
                ) // age=6, ASC + lastVetVisit=2022-12-19T10:00:00.000Z DESC (Milo) -> V + (10^11 - 6) + X + LPAD(0, 4, '0') + V + LPAD(1671444000000, 15, '0')
                expect(result.links.next).toBe(
                    `?limit=20&sortBy=age:DESC&sortBy=lastVetVisit:ASC&cursor=A000000000000000A000000000000000`
                ) // age=null, DESC + lastVetVisit=null, ASC (Leche) -> A + LPAD(0, 15, '0') + A + LPAD(0, 15, '0')
            })
        })

        describe('handling null and 0 values', () => {
            it('should handle 0 and null distinctly (DESC)', async () => {
                const config: PaginateConfig<CatEntity> = {
                    sortableColumns: ['age'],
                    paginationType: PaginationType.CURSOR,
                    defaultSortBy: [['age', 'DESC']],
                }
                const result = await paginate({ path: '', limit: 6 }, catRepo, config)

                const ageNotNullCats = cats.filter((cat) => cat.age !== null)

                expect(result.data).toEqual(expect.arrayContaining(ageNotNullCats)) // If there are multiple data with the same age value, sorting is not guaranteed among them
                expect(result.meta.itemsPerPage).toBe(6)
                expect(result.meta.cursor).toBeUndefined()
                expect(result.links.previous).toBe('?limit=6&sortBy=age:ASC&cursor=V99999999994X0000') // age=6 ASC (Milo) -> V + 10^11 - 6 + X + LPAD(0, 4, '0')
                expect(result.links.next).toBe('?limit=6&sortBy=age:DESC&cursor=N00000000000X0000') // age=0 DESC (Baby) -> V + LPAD(0, 11, '0') + X + LPAD(0, 4, '0')

                const result2 = await paginate({ path: '', cursor: 'N00000000000X0000', limit: 6 }, catRepo, config)

                expect(result2.data).toStrictEqual([cats[4]]) // Leche
                expect(result2.meta.itemsPerPage).toBe(1)
                expect(result2.meta.cursor).toBe('N00000000000X0000')
                expect(result2.links.previous).toBe('?limit=6&sortBy=age:ASC&cursor=A000000000000000') // age=null ASC (Leche) -> A + LPAD(0, 15, '0')
                expect(result2.links.current).toBe('?limit=6&sortBy=age:DESC&cursor=N00000000000X0000')
                expect(result2.links.next).toBe('?limit=6&sortBy=age:DESC&cursor=A000000000000000') // age=null DESC (Leche) -> A + LPAD(0, 15, '0')
            })

            it('should handle 0 and null distinctly (ASC)', async () => {
                const config: PaginateConfig<CatEntity> = {
                    sortableColumns: ['age'],
                    paginationType: PaginationType.CURSOR,
                    defaultSortBy: [['age', 'ASC']],
                }
                const result = await paginate({ path: '', limit: 1 }, catRepo, config)

                expect(result.data).toStrictEqual([cats[5]]) // Baby
                expect(result.meta.itemsPerPage).toBe(1)
                expect(result.meta.cursor).toBeUndefined()
                expect(result.links.previous).toBe('?limit=1&sortBy=age:DESC&cursor=N00000000000X0000') // age=0 DESC (Baby) -> N + LPAD(0, 11, '0') + X + LPAD(0, 4, '0')
                expect(result.links.next).toBe('?limit=1&sortBy=age:ASC&cursor=X00000000000X0000') // age=0 ASC (Baby) -> X + LPAD(0, 11, '0') + X + LPAD(0, 4, '0')

                const result2 = await paginate({ path: '', cursor: 'X00000000000X0000' }, catRepo, config)

                const catsExceptBaby = cats.filter((cat) => cat.name !== 'Baby')

                expect(result2.data).toEqual(expect.arrayContaining(catsExceptBaby)) // cats except Baby
                expect(result2.meta.cursor).toBe('X00000000000X0000')
                expect(result2.links.previous).toBe('?limit=20&sortBy=age:DESC&cursor=V00000000003V0000') // age=3 DESC (George) -> V + LPAD(3, 11, '0') + X + LPAD(0, 4, '0')
                expect(result2.links.current).toBe('?limit=20&sortBy=age:ASC&cursor=X00000000000X0000')
                expect(result2.links.next).toBe('?limit=20&sortBy=age:ASC&cursor=A000000000000000') // age=null ASC (Leche) -> A + LPAD(0, 15, '0')
            })
        })

        describe('with other options', () => {
            it('should work with filter and cursor pagination (sortBy id + filter color)', async () => {
                const config: PaginateConfig<CatEntity> = {
                    sortableColumns: ['id'],
                    paginationType: PaginationType.CURSOR,
                    defaultLimit: 2,
                    filterableColumns: {
                        color: [FilterOperator.EQ],
                    },
                }
                const query: PaginateQuery = {
                    path: '',
                    filter: { color: 'white' },
                }

                const result = await paginate<CatEntity>(query, catRepo, config)

                const whiteCats = cats.filter((cat) => cat.color === 'white')
                expect(result.data).toStrictEqual(whiteCats.slice(0, 2))
                expect(result.links.previous).toBe(
                    '?limit=2&sortBy=id:DESC&filter.color=white&cursor=V00000000004V0000'
                )
                expect(result.links.current).toBe('?limit=2&sortBy=id:ASC&filter.color=white')
                expect(result.links.next).toBe(`?limit=2&sortBy=id:ASC&filter.color=white&cursor=V99999999995X0000`)
            })

            it('should work with filter and cursor pagination (sortBy id + filter age)', async () => {
                const config: PaginateConfig<CatEntity> = {
                    sortableColumns: ['id'],
                    paginationType: PaginationType.CURSOR,
                    filterableColumns: {
                        age: [FilterSuffix.NOT, FilterOperator.NULL],
                    },
                }
                const query: PaginateQuery = {
                    path: '',
                    sortBy: [['id', 'ASC']],
                    filter: { age: '$not:$null' },
                    limit: 20,
                }

                const result = await paginate<CatEntity>(query, catRepo, config)

                const ageNotNullCats = cats.filter((cat) => cat.age !== null)
                expect(result.data).toStrictEqual(ageNotNullCats.sort((a, b) => a.id - b.id))
                expect(result.links.previous).toBe(
                    '?limit=20&sortBy=id:DESC&filter.age=$not:$null&cursor=V00000000001V0000'
                )
                expect(result.links.current).toBe('?limit=20&sortBy=id:ASC&filter.age=$not:$null')
                expect(result.links.next).toBe('?limit=20&sortBy=id:ASC&filter.age=$not:$null&cursor=V99999999993X0000')
            })
        })

        describe('handling data including decimal and negative numbers', () => {
            it('should handle data including decimal and negative numbers (weightChange, ASC)', async () => {
                const config: PaginateConfig<CatEntity> = {
                    sortableColumns: ['weightChange'],
                    paginationType: PaginationType.CURSOR,
                    defaultSortBy: [['weightChange', 'ASC']],
                }
                const query: PaginateQuery = {
                    path: '',
                }

                const result = await paginate<CatEntity>(query, catRepo, config)

                const sortedCats = cats.sort((a, b) => a.weightChange - b.weightChange)
                expect(result.data).toEqual(sortedCats)
                expect(result.links.previous).toBe('?limit=20&sortBy=weightChange:DESC&cursor=M99999999997X0000') // weightChange=-3.00 DESC (Shadow) -> (M + 10^11 - 3) + (X + PAD(0, 4, '0'))
                expect(result.links.next).toBe('?limit=20&sortBy=weightChange:ASC&cursor=V99999999995V7500') // weightChange=5.25 ASC (Garfield) -> (V + 10^11 - 5) + (V + 10^4 - 2500)
            })

            it('should handle data including decimal and negative numbers (weightChange, DESC)', async () => {
                const config: PaginateConfig<CatEntity> = {
                    sortableColumns: ['weightChange'],
                    paginationType: PaginationType.CURSOR,
                    defaultSortBy: [['weightChange', 'DESC']],
                }
                const query: PaginateQuery = {
                    path: '',
                }

                const result = await paginate<CatEntity>(query, catRepo, config)

                const sortedCats = cats.sort((a, b) => b.weightChange - a.weightChange)
                expect(result.data).toEqual(sortedCats)
                expect(result.links.previous).toBe('?limit=20&sortBy=weightChange:ASC&cursor=V99999999995V7500') // weightChange=5.25 ASC (Garfield) -> (V + 10^11 - 5) + (V + 10^4 - 2500)
                expect(result.links.next).toBe('?limit=20&sortBy=weightChange:DESC&cursor=M99999999997X0000') // weightChange=-3.00 DESC (Shadow) -> (M + 10^11 - 3) + (X + LPAD(0, 4, '0'))
            })

            it('should put null values last', async () => {
                const nullCat = await catRepo.save(
                    catRepo.create({
                        name: 'nullCat',
                        color: 'black',
                        age: null,
                        weightChange: null,
                        cutenessLevel: CutenessLevel.LOW,
                        size: { height: 0, width: 0, length: 0 },
                    })
                )
                const config: PaginateConfig<CatEntity> = {
                    sortableColumns: ['weightChange'],
                    paginationType: PaginationType.CURSOR,
                    defaultSortBy: [['weightChange', 'ASC']],
                }
                const query: PaginateQuery = {
                    path: '',
                }

                const result = await paginate<CatEntity>(query, catRepo, config)
                expect(result.data[result.data.length - 1]).toStrictEqual(nullCat)

                await catRepo.remove(nullCat)
            })

            it('should handle multiple cursor columns checking sorted data (age:ASC, weightChange:ASC)', async () => {
                const config: PaginateConfig<CatEntity> = {
                    sortableColumns: ['age', 'weightChange'],
                    paginationType: PaginationType.CURSOR,
                    defaultSortBy: [
                        ['age', 'ASC'],
                        ['weightChange', 'ASC'],
                    ],
                }
                const query: PaginateQuery = {
                    path: '',
                }

                const result = await paginate<CatEntity>(query, catRepo, config)
                const ageNotNullCats = cats.filter((cat) => cat.age !== null)
                const ageNullCats = cats.filter((cat) => cat.age === null)
                const sortedAgeNotNullCats = ageNotNullCats.sort((a, b) => {
                    if (a.age === b.age) {
                        return a.weightChange - b.weightChange
                    }
                    return a.age - b.age
                })
                const sortedAgeNullCats = ageNullCats.sort((a, b) => {
                    return a.weightChange - b.weightChange
                })

                expect(result.data).toEqual([...sortedAgeNotNullCats, ...sortedAgeNullCats])
                expect(result.meta.cursor).toBeUndefined()
                expect(result.meta.sortBy).toStrictEqual([
                    ['age', 'ASC'],
                    ['weightChange', 'ASC'],
                ])
                expect(result.links.previous).toBe(
                    '?limit=20&sortBy=age:DESC&sortBy=weightChange:DESC&cursor=N00000000000X0000V00000000000V0100'
                ) // age=0, DESC + weightChange=0.01 DESC (Baby) -> (V + LPAD(0, 11, '0')) + (X + LPAD(0, 4, '0')) + (V + LPAD(0, 11, '0')) + (V + LPAD(100, 4, '0'))
                expect(result.links.next).toBe(
                    '?limit=20&sortBy=age:ASC&sortBy=weightChange:ASC&cursor=A000000000000000Y00000000001V2500'
                ) // age=null, ASC + weightChange=-1.25 ASC (Leche) -> (A + LPAD(0, 15, '0')) + (Y + LPAD(1, 11, '0')) + (V + LPAD(2500, 4, '0'))
            })

            it('should handle multiple cursor columns with different directions (age:DESC, weightChange:ASC)', async () => {
                const config: PaginateConfig<CatEntity> = {
                    sortableColumns: ['age', 'weightChange'],
                    paginationType: PaginationType.CURSOR,
                    defaultSortBy: [
                        ['age', 'DESC'],
                        ['weightChange', 'ASC'],
                    ],
                }
                const query: PaginateQuery = {
                    path: '',
                }

                const result = await paginate<CatEntity>(query, catRepo, config)
                const ageNotNullCats = cats.filter((cat) => cat.age !== null)
                const ageNullCats = cats.filter((cat) => cat.age === null)
                const sortedAgeNotNullCats = ageNotNullCats.sort((a, b) => {
                    if (a.age === b.age) {
                        return a.weightChange - b.weightChange
                    }
                    return b.age - a.age
                })
                const sortedAgeNullCats = ageNullCats.sort((a, b) => {
                    return a.weightChange - b.weightChange
                })
                expect(result.data).toEqual([...sortedAgeNotNullCats, ...sortedAgeNullCats])
                expect(result.meta.cursor).toBeUndefined()
                expect(result.meta.sortBy).toStrictEqual([
                    ['age', 'DESC'],
                    ['weightChange', 'ASC'],
                ])
                expect(result.links.previous).toBe(
                    '?limit=20&sortBy=age:ASC&sortBy=weightChange:DESC&cursor=V99999999994X0000N00000000000V2500'
                ) // age=6, ASC + weightChange=-0.75 DESC (Milo) -> (V + 10^11 - 6) + (X + LPAD(0, 4, '0')) + (N + LPAD(0, 11, '0')) + (V + LPAD(10^4 - 7500), 4, '0'))
                expect(result.links.next).toBe(
                    '?limit=20&sortBy=age:DESC&sortBy=weightChange:ASC&cursor=A000000000000000Y00000000001V2500'
                ) // age=null, DESC + weightChange=-1.25 ASC (Leche) -> (A + LPAD(0, 15, '0')) + (Y + LPAD(1, 11, '0')) + (V + LPAD(2500, 4, '0'))
            })
        })

        describe('handling relation column', () => {
            let relationTestCats: CatEntity[]
            let relationTestToys: CatToyEntity[]
            let relationTestCatsIds: number[]
            let relationTestToysIds: number[]

            beforeAll(async () => {
                relationTestCats = await catRepo.save([
                    catRepo.create({
                        name: 'TestCat1',
                        color: 'orange',
                        age: 2,
                        cutenessLevel: CutenessLevel.MEDIUM,
                        lastVetVisit: isoStringToDate('2022-11-15T10:00:00.000Z'),
                        size: { height: 22, width: 8, length: 35 },
                        weightChange: 1.5,
                    }),
                    catRepo.create({
                        name: 'TestCat2',
                        color: 'grey',
                        age: 3,
                        cutenessLevel: CutenessLevel.HIGH,
                        lastVetVisit: isoStringToDate('2022-11-20T10:00:00.000Z'),
                        size: { height: 28, width: 12, length: 42 },
                        weightChange: -0.8,
                    }),
                    catRepo.create({
                        name: 'TestCat3',
                        color: 'cream',
                        age: 4,
                        cutenessLevel: CutenessLevel.LOW,
                        lastVetVisit: isoStringToDate('2022-11-25T10:00:00.000Z'),
                        size: { height: 18, width: 9, length: 38 },
                        weightChange: 2.2,
                    }),
                ])
                relationTestCatsIds = relationTestCats.map((cat) => cat.id)

                relationTestToys = await catToyRepo.save([
                    catToyRepo.create({
                        name: 'TestToy1',
                        cat: relationTestCats[0],
                        size: { height: 3, width: 3, length: 8 },
                    }),
                    catToyRepo.create({
                        name: 'TestToy2',
                        cat: relationTestCats[0],
                        size: { height: 6, width: 2, length: 7 },
                    }),
                    catToyRepo.create({
                        name: 'TestToy3',
                        cat: relationTestCats[1],
                        size: { height: 2, width: 2, length: 10 },
                    }),
                    catToyRepo.create({
                        name: 'TestToy4',
                        cat: relationTestCats[2],
                        size: { height: 5, width: 5, length: 5 },
                    }),
                ])
                relationTestToysIds = relationTestToys.map((toy) => toy.id)
            })

            afterAll(async () => {
                if (relationTestToys?.length) {
                    await catToyRepo.remove(relationTestToys)
                }
                if (relationTestCats?.length) {
                    await catRepo.remove(relationTestCats)
                }
            })

            it('should handle cursor pagination on many-to-one relation column (cat.age, ASC)', async () => {
                const config: PaginateConfig<CatToyEntity> = {
                    sortableColumns: ['cat.age'],
                    paginationType: PaginationType.CURSOR,
                    relations: ['cat'],
                    filterableColumns: {
                        id: [FilterOperator.IN],
                    },
                    defaultLimit: 4,
                }
                const query: PaginateQuery = {
                    path: '',
                    sortBy: [['cat.age', 'ASC']],
                    filter: { id: `$in:${relationTestToysIds.join(',')}` }, // Filter by test toy IDs
                }

                const result = await paginate<CatToyEntity>(query, catToyRepo, config)

                expect(result.data.length).toBe(4)
                expect(result.data[0].cat.age).toBeLessThanOrEqual(result.data[1].cat.age)
                expect(result.data[1].cat.age).toBeLessThanOrEqual(result.data[2].cat.age)
                expect(result.data[2].cat.age).toBeLessThanOrEqual(result.data[3].cat.age)
                expect(result.meta.cursor).toBeUndefined()
                expect(result.links.previous).toBe(
                    `?limit=4&sortBy=cat.age:DESC&filter.id=$in:${relationTestToysIds.join(
                        ','
                    )}&cursor=V00000000002V0000`
                )
                expect(result.links.next).toBe(
                    `?limit=4&sortBy=cat.age:ASC&filter.id=$in:${relationTestToysIds.join(
                        ','
                    )}&cursor=V99999999996X0000`
                )
            })

            it('should handle cursor pagination on many-to-one relation column with cursor (cat.age, ASC)', async () => {
                const config: PaginateConfig<CatToyEntity> = {
                    sortableColumns: ['cat.age'],
                    paginationType: PaginationType.CURSOR,
                    relations: ['cat'],
                    defaultLimit: 2,
                }

                // First, get the first page of results
                const firstPageQuery: PaginateQuery = {
                    path: '',
                    sortBy: [['cat.age', 'ASC']],
                }
                const firstResult = await paginate<CatToyEntity>(firstPageQuery, catToyRepo, config)
                expect(firstResult.data.length).toBe(2)
                expect(firstResult.links.previous).toBe('?limit=2&sortBy=cat.age:DESC&cursor=V00000000002V0000')
                expect(firstResult.links.next).toBe('?limit=2&sortBy=cat.age:ASC&cursor=V99999999998X0000')
                expect(firstResult.data[0].cat.age).toBeLessThanOrEqual(firstResult.data[1].cat.age)

                // Extract cursor from the next link
                const cursor = firstResult.links.next.split('cursor=')[1]
                expect(cursor).toBeDefined()

                // Use the cursor to get the next page
                const secondPageQuery: PaginateQuery = {
                    path: '',
                    sortBy: [['cat.age', 'ASC']],
                    cursor: cursor,
                }

                const secondResult = await paginate<CatToyEntity>(secondPageQuery, catToyRepo, config)

                expect(secondResult.data.length).toBe(2)
                expect(firstResult.data[1].cat.age).toBeLessThanOrEqual(secondResult.data[0].cat.age)
                expect(secondResult.data[0].cat.age).toBeLessThanOrEqual(secondResult.data[1].cat.age)
                expect(secondResult.meta.cursor).toBe(cursor)
                expect(secondResult.links.previous).toBe('?limit=2&sortBy=cat.age:DESC&cursor=V00000000003V0000')
                expect(secondResult.links.next).toBe('?limit=2&sortBy=cat.age:ASC&cursor=V99999999996X0000')
            })

            it('should handle cursor pagination on many-to-one relation column (cat.age, DESC)', async () => {
                const config: PaginateConfig<CatToyEntity> = {
                    sortableColumns: ['cat.age'],
                    paginationType: PaginationType.CURSOR,
                    relations: ['cat'],
                    filterableColumns: {
                        id: [FilterOperator.IN],
                    },
                }
                const query: PaginateQuery = {
                    path: '',
                    sortBy: [['cat.age', 'DESC']],
                    filter: { id: `$in:${relationTestToysIds.join(',')}` }, // Filter by test toy IDs
                }

                const result = await paginate<CatToyEntity>(query, catToyRepo, config)

                expect(result.data.length).toBe(4)
                expect(result.data[0].cat.age).toBeGreaterThanOrEqual(result.data[1].cat.age)
                expect(result.data[1].cat.age).toBeGreaterThanOrEqual(result.data[2].cat.age)
                expect(result.data[2].cat.age).toBeGreaterThanOrEqual(result.data[3].cat.age)
                expect(result.meta.cursor).toBeUndefined()
                expect(result.links.previous).toBe(
                    `?limit=20&sortBy=cat.age:ASC&filter.id=$in:${relationTestToysIds.join(
                        ','
                    )}&cursor=V99999999996X0000`
                )
                expect(result.links.next).toBe(
                    `?limit=20&sortBy=cat.age:DESC&filter.id=$in:${relationTestToysIds.join(
                        ','
                    )}&cursor=V00000000002V0000`
                )
            })

            it('should handle cursor pagination on many-to-one relation column with cursor (cat.age, DESC)', async () => {
                const config: PaginateConfig<CatToyEntity> = {
                    sortableColumns: ['cat.age'],
                    paginationType: PaginationType.CURSOR,
                    relations: ['cat'],
                    defaultLimit: 2,
                }

                // First, get the first page of results
                const firstPageQuery: PaginateQuery = {
                    path: '',
                    sortBy: [['cat.age', 'DESC']],
                }
                const firstResult = await paginate<CatToyEntity>(firstPageQuery, catToyRepo, config)
                expect(firstResult.data.length).toBe(2)
                expect(firstResult.links.previous).toBe('?limit=2&sortBy=cat.age:ASC&cursor=V99999999994X0000')
                expect(firstResult.links.next).toBe('?limit=2&sortBy=cat.age:DESC&cursor=V00000000006V0000')
                expect(firstResult.data[0].cat.age).toBeGreaterThanOrEqual(firstResult.data[1].cat.age)

                // Extract cursor from the next link
                const cursor = firstResult.links.next.split('cursor=')[1]
                expect(cursor).toBeDefined()

                // Use the cursor to get the next page
                const secondPageQuery: PaginateQuery = {
                    path: '',
                    sortBy: [['cat.age', 'DESC']],
                    cursor: cursor,
                }

                const secondResult = await paginate<CatToyEntity>(secondPageQuery, catToyRepo, config)

                expect(secondResult.data.length).toBe(2)
                expect(firstResult.data[1].cat.age).toBeGreaterThanOrEqual(secondResult.data[0].cat.age)
                expect(secondResult.data[0].cat.age).toBeGreaterThanOrEqual(secondResult.data[1].cat.age)
                expect(secondResult.meta.cursor).toBe(cursor)
                expect(secondResult.links.previous).toBe('?limit=2&sortBy=cat.age:ASC&cursor=V99999999995X0000')
                expect(secondResult.links.next).toBe('?limit=2&sortBy=cat.age:DESC&cursor=V00000000004V0000')
            })

            it('should handle cursor pagination on one-to-many relation column & embedded entity (toys.(size.height), ASC)', async () => {
                const config: PaginateConfig<CatEntity> = {
                    sortableColumns: ['toys.(size.height)'],
                    paginationType: PaginationType.CURSOR,
                    relations: ['toys'],
                    filterableColumns: {
                        id: [FilterOperator.IN],
                    },
                }
                const query: PaginateQuery = {
                    path: '',
                    sortBy: [['toys.(size.height)', 'ASC']],
                    filter: { id: `$in:${relationTestCatsIds.join(',')}` }, // Filter by test toy IDs
                }

                const result = await paginate<CatEntity>(query, catRepo, config)

                // Verify sort order - toys.(size.height) ASC
                // Former cat should have toys with shortest height, then latter cat
                if (result.data[0].toys.length > 0 && result.data[1].toys.length > 0) {
                    const minHeight1 = Math.min(...result.data[0].toys.map((toy) => toy.size.height))
                    const minHeight2 = Math.min(...result.data[1].toys.map((toy) => toy.size.height))
                    expect(minHeight1).toBeLessThanOrEqual(minHeight2)
                }
                if (result.data[1].toys.length > 0 && result.data[2].toys.length > 0) {
                    const minHeight1 = Math.min(...result.data[1].toys.map((toy) => toy.size.height))
                    const minHeight2 = Math.min(...result.data[2].toys.map((toy) => toy.size.height))
                    expect(minHeight1).toBeLessThanOrEqual(minHeight2)
                }
                expect(result.links.previous).toBe(
                    `?limit=20&sortBy=toys.(size.height):DESC&filter.id=$in:${relationTestCatsIds.join(
                        ','
                    )}&cursor=V00000000002V0000`
                )
                expect(result.links.next).toBe(
                    `?limit=20&sortBy=toys.(size.height):ASC&filter.id=$in:${relationTestCatsIds.join(
                        ','
                    )}&cursor=V99999999995X0000`
                )
            })

            it('should handle cursor pagination on one-to-many relation column & embedded entity (toys.(size.height), ASC) for a cat that has more than one toy', async () => {
                const config: PaginateConfig<CatEntity> = {
                    sortableColumns: ['toys.(size.height)'],
                    paginationType: PaginationType.CURSOR,
                    relations: ['toys'],
                    filterableColumns: {
                        id: [FilterOperator.IN],
                    },
                }
                const query: PaginateQuery = {
                    path: '',
                    sortBy: [['toys.(size.height)', 'ASC']],
                    cursor: 'V99999999996X0000',
                    filter: { id: `$in:${relationTestCatsIds.join(',')}` }, // Filter by test toy IDs
                }

                const result = await paginate<CatEntity>(query, catRepo, config)

                // Verify sort order - toys.(size.height) ASC
                // Former cat should have toys with shortest height, then latter cat
                if (result.data[0].toys.length > 0 && result.data[1].toys.length > 0) {
                    const minHeight1 = Math.min(...result.data[0].toys.map((toy) => toy.size.height))
                    const minHeight2 = Math.min(...result.data[1].toys.map((toy) => toy.size.height))
                    expect(minHeight1).toBeLessThanOrEqual(minHeight2)
                }
                expect(result.links.previous).toBe(
                    `?limit=20&sortBy=toys.(size.height):DESC&filter.id=$in:${relationTestCatsIds.join(
                        ','
                    )}&cursor=V00000000005V0000`
                )
                expect(result.links.next).toBe(
                    `?limit=20&sortBy=toys.(size.height):ASC&filter.id=$in:${relationTestCatsIds.join(
                        ','
                    )}&cursor=V99999999994X0000`
                )
            })

            it('should handle cursor pagination on one-to-many relation column & embedded entity (toys.(size.height), DESC)', async () => {
                const config: PaginateConfig<CatEntity> = {
                    sortableColumns: ['toys.(size.height)'],
                    paginationType: PaginationType.CURSOR,
                    relations: ['toys'],
                    filterableColumns: {
                        id: [FilterOperator.IN],
                    },
                }
                const query: PaginateQuery = {
                    path: '',
                    sortBy: [['toys.(size.height)', 'DESC']],
                    filter: { id: `$in:${relationTestCatsIds.join(',')}` }, // Filter by test toy IDs
                }

                const result = await paginate<CatEntity>(query, catRepo, config)

                // Verify sort order - toys.(size.height) DESC
                // Former cat should have toys with tallest height, then latter cat
                if (result.data[0].toys.length > 0 && result.data[1].toys.length > 0) {
                    const maxHeight1 = Math.max(...result.data[0].toys.map((toy) => toy.size.height))
                    const maxHeight2 = Math.max(...result.data[1].toys.map((toy) => toy.size.height))
                    expect(maxHeight1).toBeGreaterThanOrEqual(maxHeight2)
                }
                if (result.data[1].toys.length > 0 && result.data[2].toys.length > 0) {
                    const maxHeight1 = Math.max(...result.data[1].toys.map((toy) => toy.size.height))
                    const maxHeight2 = Math.max(...result.data[2].toys.map((toy) => toy.size.height))
                    expect(maxHeight1).toBeGreaterThanOrEqual(maxHeight2)
                }
                expect(result.links.previous).toBe(
                    `?limit=20&sortBy=toys.(size.height):ASC&filter.id=$in:${relationTestCatsIds.join(
                        ','
                    )}&cursor=V99999999994X0000`
                )
                expect(result.links.next).toBe(
                    `?limit=20&sortBy=toys.(size.height):DESC&filter.id=$in:${relationTestCatsIds.join(
                        ','
                    )}&cursor=V00000000002V0000`
                )
            })

            it('should handle cursor pagination on one-to-one relation column (cat.lastVetVisit, ASC)', async () => {
                const config: PaginateConfig<CatToyEntity> = {
                    sortableColumns: ['cat.lastVetVisit'],
                    paginationType: PaginationType.CURSOR,
                    relations: ['cat'],
                    filterableColumns: {
                        id: [FilterOperator.IN],
                    },
                }
                const query: PaginateQuery = {
                    path: '',
                    sortBy: [['cat.lastVetVisit', 'ASC']],
                    filter: { id: `$in:${relationTestToysIds.join(',')}` }, // Filter by test toy IDs
                }

                const result = await paginate<CatToyEntity>(query, catToyRepo, config)

                expect(result.data.length).toBe(4)

                // Verify sort order - cat.lastVetVisit ASC
                // Toys should be ordered by their cats' last vet visit date ASC
                const date1 = new Date(result.data[0].cat.lastVetVisit).getTime()
                const date2 = new Date(result.data[1].cat.lastVetVisit).getTime()
                const date3 = new Date(result.data[2].cat.lastVetVisit).getTime()
                const date4 = new Date(result.data[3].cat.lastVetVisit).getTime()
                expect(date1).toBeLessThanOrEqual(date2)
                expect(date2).toBeLessThanOrEqual(date3)
                expect(date3).toBeLessThanOrEqual(date4)
                expect(result.links.previous).toBe(
                    `?limit=20&sortBy=cat.lastVetVisit:DESC&filter.id=$in:${relationTestToysIds.join(
                        ','
                    )}&cursor=V001668506400000`
                )
                expect(result.links.next).toBe(
                    `?limit=20&sortBy=cat.lastVetVisit:ASC&filter.id=$in:${relationTestToysIds.join(
                        ','
                    )}&cursor=V998330629600000`
                )
            })

            it('should handle cursor pagination on one-to-one relation column (cat.lastVetVisit, DESC)', async () => {
                const config: PaginateConfig<CatToyEntity> = {
                    sortableColumns: ['cat.lastVetVisit'],
                    paginationType: PaginationType.CURSOR,
                    relations: ['cat'],
                    filterableColumns: {
                        id: [FilterOperator.IN],
                    },
                }
                const query: PaginateQuery = {
                    path: '',
                    sortBy: [['cat.lastVetVisit', 'DESC']],
                    filter: { id: `$in:${relationTestToysIds.join(',')}` }, // Filter by test toy IDs
                }

                const result = await paginate<CatToyEntity>(query, catToyRepo, config)

                expect(result.data.length).toBe(4)

                // Verify sort order - cat.lastVetVisit DESC
                // Toys should be ordered by their cats' last vet visit date DESC
                const date1 = new Date(result.data[0].cat.lastVetVisit).getTime()
                const date2 = new Date(result.data[1].cat.lastVetVisit).getTime()
                const date3 = new Date(result.data[2].cat.lastVetVisit).getTime()
                const date4 = new Date(result.data[3].cat.lastVetVisit).getTime()
                expect(date1).toBeGreaterThanOrEqual(date2)
                expect(date2).toBeGreaterThanOrEqual(date3)
                expect(date3).toBeGreaterThanOrEqual(date4)
                expect(result.links.previous).toBe(
                    `?limit=20&sortBy=cat.lastVetVisit:ASC&filter.id=$in:${relationTestToysIds.join(
                        ','
                    )}&cursor=V998330629600000`
                )
                expect(result.links.next).toBe(
                    `?limit=20&sortBy=cat.lastVetVisit:DESC&filter.id=$in:${relationTestToysIds.join(
                        ','
                    )}&cursor=V001668506400000`
                )
            })

            it('should handle multiple cursor columns with relation (cat.age:ASC, id:DESC)', async () => {
                // Configure pagination with multiple sorting criteria - cat.age ASC and id DESC
                const config: PaginateConfig<CatToyEntity> = {
                    sortableColumns: ['cat.age', 'id'],
                    paginationType: PaginationType.CURSOR,
                    relations: ['cat'],
                }
                const query: PaginateQuery = {
                    path: '',
                    sortBy: [
                        ['cat.age', 'ASC'],
                        ['id', 'DESC'],
                    ],
                }

                const result = await paginate<CatToyEntity>(query, catToyRepo, config)

                // Verify results exist
                expect(result.data.length).toBeGreaterThan(0)

                // Verify sort order - first by cat.age ASC, then by id DESC
                if (result.data.length >= 2) {
                    for (let i = 0; i < result.data.length - 1; i++) {
                        if (result.data[i].cat.age === result.data[i + 1].cat.age) {
                            // If ages are equal, ids should be in DESC order
                            expect(result.data[i].id).toBeGreaterThanOrEqual(result.data[i + 1].id)
                        } else {
                            // Otherwise ages should be in ASC order
                            expect(result.data[i].cat.age).toBeLessThan(result.data[i + 1].cat.age)
                        }
                    }
                }

                expect(result.links.previous).toBe(
                    '?limit=20&sortBy=cat.age:DESC&sortBy=id:ASC&cursor=V00000000002V0000V99999999994X0000'
                )
                expect(result.links.next).toBe(
                    '?limit=20&sortBy=cat.age:ASC&sortBy=id:DESC&cursor=V99999999994X0000V00000000001V0000'
                )
            })

            it('should handle cursor pagination with filter on relation column', async () => {
                const config: PaginateConfig<CatToyEntity> = {
                    sortableColumns: ['size.height'],
                    paginationType: PaginationType.CURSOR,
                    relations: ['cat'],
                    filterableColumns: {
                        'cat.age': [FilterOperator.EQ],
                    },
                    defaultLimit: 4,
                }

                // Get target age from test data
                const targetAge = relationTestCats[0].age

                const query: PaginateQuery = {
                    path: '',
                    filter: {
                        'cat.age': `${targetAge}`,
                    },
                    sortBy: [['size.height', 'ASC']],
                }

                const result = await paginate<CatToyEntity>(query, catToyRepo, config)

                // Verify all toys belong to cats with the target age
                result.data.forEach((toy) => {
                    expect(toy.cat.age).toBe(targetAge)
                })

                // Verify sort order - size.height ASC
                if (result.data.length >= 2) {
                    for (let i = 0; i < result.data.length - 1; i++) {
                        expect(result.data[i].size.height).toBeLessThanOrEqual(result.data[i + 1].size.height)
                    }
                }
            })
        })
    })

    describe('Wildcard Select', () => {
        it('should expand * wildcard to all main entity columns', async () => {
            const query: PaginateQuery = {
                page: 1,
                limit: 10,
                select: ['*'],
                path: '/cats',
            }

            const result = await paginate(query, catRepo, {
                sortableColumns: ['id'],
                select: ['*'],
            })

            expect(result.data[0]).toHaveProperty('id')
            expect(result.data[0]).toHaveProperty('name')
            expect(result.data[0]).toHaveProperty('color')
            expect(result.data[0]).toHaveProperty('age')
            expect(result.data[0]).toHaveProperty('cutenessLevel')
            expect(result.data[0]).toHaveProperty('lastVetVisit')
            expect(result.data[0]).toHaveProperty('createdAt')
            expect(result.data[0]).toHaveProperty('deletedAt')
            expect(result.data[0]).toHaveProperty('weightChange')
            expect(result.data[0]).toHaveProperty('size')
            expect(result.data[0]).toHaveProperty('size.height')
            expect(result.data[0]).toHaveProperty('size.width')
            expect(result.data[0]).toHaveProperty('size.length')
        })

        it('should expand relation.* wildcard to all relation columns', async () => {
            const query: PaginateQuery = {
                page: 1,
                limit: 10,
                select: ['id', 'name', 'toys.*'],
                path: '/cats',
            }

            const result = await paginate(query, catRepo, {
                sortableColumns: ['id'],
                select: ['id', 'name', 'toys.*'],
                relations: ['toys'],
            })

            expect(result.data[0]).toHaveProperty('id')
            expect(result.data[0]).toHaveProperty('name')
            expect(result.data[0]).not.toHaveProperty('color')
            expect(result.data[0]).not.toHaveProperty('age')
            expect(result.data[0]).not.toHaveProperty('cutenessLevel')
            expect(result.data[0]).not.toHaveProperty('lastVetVisit')
            expect(result.data[0]).not.toHaveProperty('createdAt')
            expect(result.data[0]).not.toHaveProperty('deletedAt')
            expect(result.data[0]).not.toHaveProperty('weightChange')
            expect(result.data[0].toys[0]).toHaveProperty('id')
            expect(result.data[0].toys[0]).toHaveProperty('name')
            expect(result.data[0].toys[0]).toHaveProperty('createdAt')
            expect(result.data[0].toys[0]).toHaveProperty('size')
            expect(result.data[0].toys[0]).toHaveProperty('size.height')
            expect(result.data[0].toys[0]).toHaveProperty('size.width')
            expect(result.data[0].toys[0]).toHaveProperty('size.length')
        })

        it('should handle both * and relation.* wildcards together', async () => {
            const query: PaginateQuery = {
                page: 1,
                limit: 10,
                select: ['*', 'toys.*'],
                path: '/cats',
            }

            const result = await paginate(query, catRepo, {
                sortableColumns: ['id'],
                select: ['*', 'toys.*'],
                relations: ['toys'],
            })

            expect(result.data[0]).toHaveProperty('id')
            expect(result.data[0]).toHaveProperty('name')
            expect(result.data[0]).toHaveProperty('color')
            expect(result.data[0]).toHaveProperty('age')
            expect(result.data[0]).toHaveProperty('cutenessLevel')
            expect(result.data[0]).toHaveProperty('lastVetVisit')
            expect(result.data[0]).toHaveProperty('createdAt')
            expect(result.data[0]).toHaveProperty('deletedAt')
            expect(result.data[0]).toHaveProperty('weightChange')
            expect(result.data[0].toys[0]).toHaveProperty('id')
            expect(result.data[0].toys[0]).toHaveProperty('name')
            expect(result.data[0].toys[0]).toHaveProperty('createdAt')
        })

        it('should handle non-existent relation wildcard gracefully', async () => {
            const query: PaginateQuery = {
                page: 1,
                limit: 10,
                select: ['id', 'name', 'nonExistentRelation.*'],
                path: '/cats',
            }

            const result = await paginate(query, catRepo, {
                sortableColumns: ['id'],
                select: ['id', 'name', 'nonExistentRelation.*'],
            })

            expect(result.data[0]).toHaveProperty('id')
            expect(result.data[0]).toHaveProperty('name')
            expect(result.data[0]).not.toHaveProperty('nonExistentRelation.*')
        })

        it('should handle nested relation wildcards correctly', async () => {
            const query: PaginateQuery = {
                page: 1,
                limit: 10,
                select: ['*', 'toys.*', 'toys.shop.*', 'toys.shop.address.*'],
                sortBy: [
                    ['id', 'ASC'],
                    ['toys.id', 'ASC'],
                ],
                path: '/cats',
            }

            const result = await paginate(query, catRepo, {
                sortableColumns: ['id', 'toys.id'],
                select: ['*', 'toys.*', 'toys.shop.*', 'toys.shop.address.*'],
                relations: ['toys', 'toys.shop', 'toys.shop.address'],
            })

            expect(result.data[0]).toHaveProperty('id')
            expect(result.data[0]).toHaveProperty('name')
            expect(result.data[0].toys[1]).toHaveProperty('id')
            expect(result.data[0].toys[1]).toHaveProperty('name')
            expect(result.data[0].toys[1].shop).toHaveProperty('id')
            expect(result.data[0].toys[1].shop).toHaveProperty('shopName')
            expect(result.data[0].toys[1].shop.address).toHaveProperty('id')
            expect(result.data[0].toys[1].shop.address).toHaveProperty('address')
        })

        it('should restrict query.select to only fields allowed in config.select', async () => {
            // Server-side config only allows id and name
            const config: PaginateConfig<CatEntity> = {
                sortableColumns: ['id'],
                select: ['id', 'name'],
            }

            // Client tries to request additional fields
            const query: PaginateQuery = {
                page: 1,
                limit: 10,
                select: ['id', 'name', 'color', 'age'], // color and age not in config.select
                path: '/cats',
            }

            const result = await paginate(query, catRepo, config)

            // Should only include fields that exist in both config.select and query.select
            expect(result.data[0]).toHaveProperty('id')
            expect(result.data[0]).toHaveProperty('name')
            expect(result.data[0]).not.toHaveProperty('color')
            expect(result.data[0]).not.toHaveProperty('age')
        })

        it('should restrict wildcard query.select to only fields allowed in config.select', async () => {
            // Server-side config only allows id, name and toys.id
            const config: PaginateConfig<CatEntity> = {
                sortableColumns: ['id'],
                select: ['id', 'name', 'toys.id'],
                relations: ['toys'],
            }

            // Client tries to request all fields with wildcards
            const query: PaginateQuery = {
                page: 1,
                limit: 10,
                select: ['*', 'toys.*'], // Requesting all fields with wildcards
                path: '/cats',
            }

            const result = await paginate(query, catRepo, config)

            // Should only include fields that exist in both expanded config.select and expanded query.select
            expect(result.data[0]).toHaveProperty('id')
            expect(result.data[0]).toHaveProperty('name')
            expect(result.data[0]).not.toHaveProperty('color')
            expect(result.data[0]).not.toHaveProperty('age')

            // Should only have toys.id, not other toy properties
            expect(result.data[0].toys[0]).toHaveProperty('id')
            expect(result.data[0].toys[0]).not.toHaveProperty('name')
            expect(result.data[0].toys[0]).not.toHaveProperty('createdAt')
        })
    })
})
