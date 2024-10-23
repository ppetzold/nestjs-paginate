import { HttpException } from '@nestjs/common'
import { clone } from 'lodash'
import * as process from 'process'
import { DataSource, In, Like, Repository, TypeORMError } from 'typeorm'
import { BaseDataSourceOptions } from 'typeorm/data-source/BaseDataSourceOptions'
import { CatHairEntity } from './__tests__/cat-hair.entity'
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
    OperatorSymbolToFunction,
    isOperator,
    isSuffix,
    parseFilterToken,
} from './filter'
import { PaginateConfig, Paginated, PaginationLimit, paginate } from './paginate'

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
    let cats: CatEntity[]
    let catToys: CatToyEntity[]
    let catToysWithoutShop: CatToyEntity[]
    let toyShopsAddresses: ToyShopAddressEntity[]
    let toysShops: ToyShopEntity[]
    let catHomes: CatHomeEntity[]
    let catHomePillows: CatHomePillowEntity[]
    let catHairs: CatHairEntity[] = []

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
            }),
            catRepo.create({
                name: 'Garfield',
                color: 'ginger',
                age: 5,
                cutenessLevel: CutenessLevel.MEDIUM,
                lastVetVisit: isoStringToDate('2022-12-20T10:00:00.000Z'),
                size: { height: 30, width: 15, length: 45 },
            }),
            catRepo.create({
                name: 'Shadow',
                color: 'black',
                age: 4,
                cutenessLevel: CutenessLevel.HIGH,
                lastVetVisit: isoStringToDate('2022-12-21T10:00:00.000Z'),
                size: { height: 25, width: 10, length: 50 },
            }),
            catRepo.create({
                name: 'George',
                color: 'white',
                age: 3,
                cutenessLevel: CutenessLevel.LOW,
                lastVetVisit: null,
                size: { height: 35, width: 12, length: 40 },
            }),
            catRepo.create({
                name: 'Leche',
                color: 'white',
                age: null,
                cutenessLevel: CutenessLevel.HIGH,
                lastVetVisit: null,
                size: { height: 10, width: 5, length: 15 },
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

        catHomes = await catHomeRepo.save([
            catHomeRepo.create({ name: 'Box', cat: cats[0] }),
            catHomeRepo.create({ name: 'House', cat: cats[1] }),
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

        if (process.env.DB === 'postgres') {
            catHairRepo = dataSource.getRepository(CatHairEntity)
            catHairs = await catHairRepo.save([
                catHairRepo.create({ name: 'short', colors: ['white', 'brown', 'black'] }),
                catHairRepo.create({ name: 'long', colors: ['white', 'brown'] }),
                catHairRepo.create({ name: 'buzzed', colors: ['white'] }),
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

        expect(result.data).toStrictEqual(cats.slice(0, PaginationLimit.DEFAULT_LIMIT))
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
        expect(result.meta.totalItems).toBe(5)
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
        expect(links.last).toBe('?page=3&limit=2&sortBy=id:ASC')
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
        expect(links.last).toBe('/cats?page=3&limit=2&sortBy=id:ASC')
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
        expect(links.last).toBe('http://localhost/cats?page=3&limit=2&sortBy=id:ASC')
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
        expect(links.last).toBe('http://cats.example/cats?page=3&limit=2&sortBy=id:ASC')
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
        const expectedResult = [...cats.slice(0, -1).reverse(), cats.slice(-1)[0]]

        expect(result.meta.sortBy).toStrictEqual([['age', 'ASC']])
        expect(result.data).toStrictEqual(expectedResult)
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

        const expectedResult = [cats[cats.length - 1], ...cats.slice(0, cats.length - 1).reverse()]

        expect(result.meta.sortBy).toStrictEqual([['age', 'ASC']])
        expect(result.data).toStrictEqual(expectedResult)
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

        expect(result.meta.sortBy).toStrictEqual([
            ['color', 'DESC'],
            ['name', 'ASC'],
        ])
        expect(result.data).toStrictEqual([cats[3], cats[4], cats[1], cats[0], cats[2]])
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

        expect(result.meta.sortBy).toStrictEqual([
            ['cutenessLevel', 'ASC'],
            ['name', 'ASC'],
        ])
        expect(result.data).toStrictEqual([cats[4], cats[0], cats[2], cats[3], cats[1]])
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

        expect(result.meta.search).toStrictEqual('hi')
        expect(result.data).toStrictEqual([cats[0], cats[2], cats[4]])
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
            relations: ['cat'],
            sortableColumns: ['id', 'name', 'cat.id'],
        }
        const query: PaginateQuery = {
            path: '',
            sortBy: [['cat.id', 'DESC']],
        }

        const result = await paginate<CatHomeEntity>(query, catHomeRepo, config)
        expect(result.meta.sortBy).toStrictEqual([['cat.id', 'DESC']])

        const catHomesClone = clone([catHomes[0], catHomes[1]])
        catHomesClone[0].countCat = cats.filter((cat) => cat.id === catHomesClone[0].cat.id).length
        catHomesClone[1].countCat = cats.filter((cat) => cat.id === catHomesClone[1].cat.id).length

        expect(result.data).toStrictEqual(catHomesClone.sort((a, b) => b.cat.id - a.cat.id))
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=cat.id:DESC')
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
            relations: ['cat'],
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
            relations: { home: { pillows: true } },
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
            relations: ['home.pillows'],
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
            relations: ['cat'],
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

        const catHomesClone = clone(catHomes[0])
        catHomesClone.countCat = cats.filter((cat) => cat.id === catHomesClone.cat.id).length

        expect(result.data).toStrictEqual([catHomesClone])
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&filter.cat.name=$not:Garfield')
    })

    it('should return result based on $in filter on one-to-one relation', async () => {
        const config: PaginateConfig<CatHomeEntity> = {
            relations: ['cat'],
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

        const catHomesClone = clone(catHomes[0])
        catHomesClone.countCat = cats.filter((cat) => cat.id === catHomesClone.cat.id).length

        expect(result.data).toStrictEqual([catHomesClone])
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&filter.cat.age=$in:4,6')
    })

    it('should return result based on $btw filter on one-to-one relation', async () => {
        const config: PaginateConfig<CatHomeEntity> = {
            relations: ['cat'],
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

        const orderedCats = [cats[4], cats[0], cats[2], cats[1], cats[3]]
        expect(result.data).toStrictEqual(orderedCats)
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=size.height:ASC&sortBy=size.length:ASC')
    })

    it('should return result based on sort on embedded entity when other relations loaded', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id', 'name', 'size.height', 'size.length', 'size.width', 'toys.(size.height)'],
            searchableColumns: ['name'],
            relations: ['home', 'toys'],
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

        const copyToys = catToysWithoutShop.map((toy: CatToyEntity) => {
            const copy = clone(toy)
            delete copy.cat
            return copy
        })
        copyCats[0].toys = [copyToys[0], copyToys[2], copyToys[1]]
        copyCats[1].toys = [copyToys[3]]

        const orderedCats = [copyCats[3], copyCats[1], copyCats[2], copyCats[0], copyCats[4]]

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
            relations: ['cat'],
        }
        const query: PaginateQuery = {
            path: '',
            sortBy: [['cat.(size.height)', 'DESC']],
        }

        const result = await paginate<CatHomeEntity>(query, catHomeRepo, config)
        const orderedHomes = clone([catHomes[1], catHomes[0]])

        orderedHomes[0].countCat = cats.filter((cat) => cat.id === orderedHomes[0].cat.id).length
        orderedHomes[1].countCat = cats.filter((cat) => cat.id === orderedHomes[1].cat.id).length

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

        expect(result.data).toStrictEqual([cats[4]])
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

        expect(result.data).toStrictEqual([copyCat])
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
            relations: ['cat'],
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

        expect(result.data).toStrictEqual([cats[1], cats[3], cats[4]])
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&filter.size.height=$not:25')
    })

    it('should return result based on filter on embedded entity when other relations loaded', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id', 'name', 'size.height', 'size.length', 'size.width'],
            searchableColumns: ['size.height'],
            filterableColumns: {
                'size.height': [FilterSuffix.NOT],
            },
            relations: ['home'],
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
            relations: ['cat'],
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
            relations: ['cat'],
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
            relations: ['cat'],
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

        const catHomeClone = clone(catHomes)
        catHomeClone[0].countCat = cats.filter(
            (cat) => cat.size.height >= 18 && cat.size.height <= 33 && cat.id == catHomeClone[0].cat.id
        ).length
        catHomeClone[1].countCat = cats.filter(
            (cat) => cat.size.height >= 18 && cat.size.height <= 33 && cat.id == catHomeClone[1].cat.id
        ).length
        expect(result.data).toStrictEqual([catHomeClone[0], catHomeClone[1]])
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
        expect(result.data).toStrictEqual([cats[2], cats[3]])
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

        expect(result.data).toStrictEqual([cats[2], cats[3]])
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

        expect(result.data).toStrictEqual([cats[0], cats[1], cats[2]])
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

        expect(result.data).toStrictEqual([cats[1], cats[2]])
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

        expect(result.data).toStrictEqual([cats[0], cats[1], cats[2], cats[3]])
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&filter.age=$not:$null')
    })

    it('should return result based on not null query on relation', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            filterableColumns: {
                'home.name': [FilterSuffix.NOT, FilterOperator.NULL],
            },
            relations: ['home'],
        }
        const query: PaginateQuery = {
            path: '',
            filter: {
                'home.name': '$not:$null',
            },
        }

        const result = await paginate<CatEntity>(query, catRepo, config)
        const expectedResult = [0, 1].map((i) => {
            const ret = Object.assign(clone(cats[i]), { home: Object.assign(clone(catHomes[i])) })
            delete ret.home.cat
            return ret
        })

        expect(result.data).toStrictEqual(expectedResult)
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&filter.home.name=$not:$null')
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

        expect(result.data).toStrictEqual([cats[0], cats[1], cats[2]])
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
                (cat.name === 'Milo' || cat.name === 'Garfield' || !cat.age) &&
                (cat.color === 'brown' || cat.color === 'white') &&
                (cat.cutenessLevel === CutenessLevel.HIGH || cat.cutenessLevel === CutenessLevel.LOW)
        )
        expect(result.data).toStrictEqual(expected)
        expect(result.links.current).toBe(
            '?page=1&limit=20&sortBy=id:ASC&filter.name=$or:Milo&filter.name=$or:Garfield&filter.age=$or:$null&filter.color=brown&filter.color=$or:white&filter.cutenessLevel=high&filter.cutenessLevel=$or:low'
        )
    })

    it("should return all columns if select doesn't contain all primary columns", async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id', 'name'],
            select: ['name'],
        }
        const query: PaginateQuery = {
            path: '',
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        expect(result.data).toStrictEqual(cats)
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
            relations: { home: { pillows: true } },
            sortableColumns: ['id', 'name'],
        }
        const query: PaginateQuery = {
            path: '',
            select: ['id', 'home.id', 'home.name'],
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        result.data.forEach((cat) => {
            expect(cat.id).toBeDefined()

            if (cat.id === 1 || cat.id === 2) {
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
            select: ['id', 'home.id', 'home.pillows.id'],
            relations: { home: { pillows: true } },
            sortableColumns: ['id', 'name'],
        }
        const query: PaginateQuery = {
            path: '',
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        result.data.forEach((cat) => {
            expect(cat.id).toBeDefined()
            expect(cat.name).not.toBeDefined()

            if (cat.id === 1 || cat.id === 2) {
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

        expect(result.meta.totalItems).toBe(5)
        expect(result.data.length).toBe(5)
        expect(result.data[0].friends.length).toBe(4)
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
            relations: { home: { pillows: true } },
            sortableColumns: ['id', 'name'],
            searchableColumns: ['name', 'home.pillows.color'],
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
            relations: { home: { pillows: true } },
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

        expect(result.data).toStrictEqual([cats[2], cats[3]])
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

        expect(result.data).toStrictEqual([cats[0], cats[1], cats[2], cats[3], cats[4]])
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
            expect(result.data).toStrictEqual([cats[0], cats[1], cats[2]])
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
            expect(result.data).toStrictEqual([cats[1], cats[2]])
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
            expect(result.data).toStrictEqual([cats[2]])
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

    if (process.env.DB !== 'postgres') {
        describe('should return result based on virtual column', () => {
            it('should return result sorted and filter by a virtual column in main entity', async () => {
                const config: PaginateConfig<CatHomeEntity> = {
                    sortableColumns: ['countCat'],
                    relations: ['cat'],
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

                expect(result.data).toStrictEqual([catHomes[0], catHomes[1]])
                expect(result.links.current).toBe('?page=1&limit=20&sortBy=countCat:ASC&filter.countCat=$gt:0')
            })

            it('should return result based on virtual column filter', async () => {
                const config: PaginateConfig<CatEntity> = {
                    sortableColumns: ['id'],
                    filterableColumns: {
                        'home.countCat': [FilterOperator.GT],
                    },
                    relations: ['home'],
                }
                const query: PaginateQuery = {
                    path: '',
                    filter: {
                        'home.countCat': '$gt:0',
                    },
                    sortBy: [['id', 'ASC']],
                }

                const result = await paginate<CatEntity>(query, catRepo, config)
                const expectedResult = [0, 1].map((i) => {
                    const ret = Object.assign(clone(cats[i]), { home: Object.assign(clone(catHomes[i])) })
                    delete ret.home.cat
                    return ret
                })

                expect(result.data).toStrictEqual(expectedResult)
                expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&filter.home.countCat=$gt:0')
            })

            it('should return result sorted and filter by a virtual column in main entity', async () => {
                const config: PaginateConfig<CatHomeEntity> = {
                    sortableColumns: ['countCat'],
                    relations: ['cat'],
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

                expect(result.data).toStrictEqual([catHomes[0], catHomes[1]])
                expect(result.links.current).toBe('?page=1&limit=20&sortBy=countCat:ASC&filter.countCat=$gt:0')
            })

            it('should return result based on virtual column filter', async () => {
                const config: PaginateConfig<CatEntity> = {
                    sortableColumns: ['id'],
                    filterableColumns: {
                        'home.countCat': [FilterOperator.GT],
                    },
                    relations: ['home'],
                }
                const query: PaginateQuery = {
                    path: '',
                    filter: {
                        'home.countCat': '$gt:0',
                    },
                    sortBy: [['id', 'ASC']],
                }

                const result = await paginate<CatEntity>(query, catRepo, config)
                const expectedResult = [0, 1].map((i) => {
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
                    relations: ['home'],
                }
                const query: PaginateQuery = {
                    path: '',
                    sortBy: [['home.countCat', 'ASC']],
                }

                const result = await paginate<CatEntity>(query, catRepo, config)
                const expectedResult = [2, 3, 4, 0, 1].map((i) => {
                    const ret = clone(cats[i])
                    if (i == 0 || i == 1) {
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
})
