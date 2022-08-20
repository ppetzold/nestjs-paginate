import { createConnection, Repository, In, Connection } from 'typeorm'
import {
    Paginated,
    paginate,
    PaginateConfig,
    FilterOperator,
    isOperator,
    getFilterTokens,
    OperatorSymbolToFunction,
} from './paginate'
import { PaginateQuery } from './decorator'
import { HttpException } from '@nestjs/common'
import { CatEntity } from './__tests__/cat.entity'
import { CatToyEntity } from './__tests__/cat-toy.entity'
import { CatHomeEntity } from './__tests__/cat-home.entity'
import { clone } from 'lodash'

describe('paginate', () => {
    let connection: Connection
    let catRepo: Repository<CatEntity>
    let catToyRepo: Repository<CatToyEntity>
    let catHomeRepo: Repository<CatHomeEntity>
    let cats: CatEntity[]
    let catToys: CatToyEntity[]
    let catHomes: CatHomeEntity[]

    beforeAll(async () => {
        connection = await createConnection({
            type: 'sqlite',
            database: ':memory:',
            synchronize: true,
            logging: false,
            entities: [CatEntity, CatToyEntity, CatHomeEntity],
        })
        catRepo = connection.getRepository(CatEntity)
        catToyRepo = connection.getRepository(CatToyEntity)
        catHomeRepo = connection.getRepository(CatHomeEntity)
        cats = await catRepo.save([
            catRepo.create({ name: 'Milo', color: 'brown', age: 6 }),
            catRepo.create({ name: 'Garfield', color: 'ginger', age: 5 }),
            catRepo.create({ name: 'Shadow', color: 'black', age: 4 }),
            catRepo.create({ name: 'George', color: 'white', age: 3 }),
            catRepo.create({ name: 'Leche', color: 'white', age: null }),
        ])
        catToys = await catToyRepo.save([
            catToyRepo.create({ name: 'Fuzzy Thing', cat: cats[0] }),
            catToyRepo.create({ name: 'Stuffed Mouse', cat: cats[0] }),
            catToyRepo.create({ name: 'Mouse', cat: cats[0] }),
            catToyRepo.create({ name: 'String', cat: cats[1] }),
        ])
        catHomes = await catHomeRepo.save([
            catHomeRepo.create({ name: 'Box', cat: cats[0] }),
            catHomeRepo.create({ name: 'House', cat: cats[1] }),
        ])
    })

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
            defaultLimit: 1,
        }
        const query: PaginateQuery = {
            path: '',
        }

        const queryBuilder = await connection
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
            defaultSortBy: [['age', 'DESC']],
        }
        const query: PaginateQuery = {
            path: '',
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        expect(result.meta.sortBy).toStrictEqual([['age', 'DESC']])
        expect(result.data).toStrictEqual(cats)
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
        expect(result.data).toStrictEqual([catToys[0], catToys[1], catToys[2]])
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&search=Milo')
    })

    it('should return result based on search term on one-to-many relation', async () => {
        const config: PaginateConfig<CatEntity> = {
            relations: ['toys'],
            sortableColumns: ['id', 'name'],
            searchableColumns: ['name', 'toys.name'],
        }
        const query: PaginateQuery = {
            path: '',
            search: 'Mouse',
        }

        const result = await paginate<CatEntity>(query, catRepo, config)

        expect(result.meta.search).toStrictEqual('Mouse')
        const toy = clone(catToys[1])
        delete toy.cat
        const toy2 = clone(catToys[2])
        delete toy2.cat
        expect(result.data).toStrictEqual([Object.assign(clone(cats[0]), { toys: [toy, toy2] })])
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&search=Mouse')
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
        expect(result.data).toStrictEqual([catHomes[0], catHomes[1]].sort((a, b) => b.cat.id - a.cat.id))
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
        expect(result.data).toStrictEqual([catToys[0], catToys[1], catToys[2]].sort((a, b) => b.cat.id - a.cat.id))
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=cat.id:DESC&search=Milo')
    })

    it('should return result based on sort on one-to-many relation', async () => {
        const config: PaginateConfig<CatEntity> = {
            relations: ['toys'],
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
        expect(result.data).toStrictEqual([catHomes[1]])
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&search=Garfield')
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
                name: [FilterOperator.NOT],
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

    it('should return result based on filter on many-to-one relation', async () => {
        const config: PaginateConfig<CatToyEntity> = {
            relations: ['cat'],
            sortableColumns: ['id', 'name'],
            filterableColumns: {
                'cat.name': [FilterOperator.NOT],
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

    it('should return result based on filter on one-to-many relation', async () => {
        const config: PaginateConfig<CatEntity> = {
            relations: ['toys'],
            sortableColumns: ['id', 'name'],
            filterableColumns: {
                'toys.name': [FilterOperator.NOT],
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
        const catToys1 = clone(catToys[0])
        const catToys2 = clone(catToys[2])
        const catToys3 = clone(catToys[3])
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
                'cat.name': [FilterOperator.NOT],
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
        expect(result.data).toStrictEqual([catHomes[0]])
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
        expect(result.data).toStrictEqual([catHomes[0]])
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&filter.cat.age=$in:4,6')
    })

    it('should return result based on $btw filter on one-to-one relation', async () => {
        const config: PaginateConfig<CatHomeEntity> = {
            relations: ['cat'],
            sortableColumns: ['id', 'name'],
            filterableColumns: {
                createdAt: [FilterOperator.BTW],
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
        expect(result.data).toStrictEqual([catHomes[0], catHomes[1]])
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&filter.cat.age=$btw:6,10')
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
                name: [FilterOperator.NOT],
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
                name: [FilterOperator.NOT],
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

    it('should return result based on filter and search term', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            searchableColumns: ['name', 'color'],
            filterableColumns: {
                id: [FilterOperator.NOT, FilterOperator.IN],
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
                id: [FilterOperator.NOT, FilterOperator.IN],
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
                age: [FilterOperator.NOT, FilterOperator.NULL],
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

    it('should ignore filterable column which is not configured', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            filterableColumns: {
                name: [FilterOperator.NOT, FilterOperator.NULL],
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
                age: [FilterOperator.NOT],
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
        { operator: '$not', result: true },
        { operator: '$fake', result: false },
    ])('should check operator "$operator" valid is $result', ({ operator, result }) => {
        expect(isOperator(operator)).toStrictEqual(result)
    })

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
    ])('should get operator function $name for "$operator"', ({ operator, name }) => {
        const func = OperatorSymbolToFunction.get(operator as FilterOperator)
        expect(func.name).toStrictEqual(name)
    })

    it.each([
        { string: '$eq:value', tokens: [null, '$eq', 'value'] },
        { string: '$eq:val:ue', tokens: [null, '$eq', 'val:ue'] },
        { string: '$in:value1,value2,value3', tokens: [null, '$in', 'value1,value2,value3'] },
        { string: '$not:$in:value1:a,value2:b,value3:c', tokens: ['$not', '$in', 'value1:a,value2:b,value3:c'] },
        { string: 'value', tokens: [null, '$eq', 'value'] },
        { string: 'val:ue', tokens: [null, '$eq', 'val:ue'] },
        { string: '$not:value', tokens: [null, '$not', 'value'] },
        { string: '$eq:$not:value', tokens: ['$eq', '$not', 'value'] },
        { string: '$eq:$null', tokens: ['$eq', '$null'] },
        { string: '$null', tokens: [null, '$null'] },
        { string: '', tokens: [null, '$eq', ''] },
        { string: '$eq:$not:$in:value', tokens: [] },
    ])('should get filter tokens for "$string"', ({ string, tokens }) => {
        expect(getFilterTokens(string)).toStrictEqual(tokens)
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
            expect(cat.color).not.toBeDefined()
        })
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
    })
})
