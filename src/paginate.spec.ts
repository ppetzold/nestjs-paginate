import { createConnection, Repository, Column, In } from 'typeorm'
import { Paginated, paginate, PaginateConfig, FilterOperator } from './paginate'
import { PaginateQuery } from './decorator'
import { Entity, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm'
import { HttpException } from '@nestjs/common'

@Entity()
export class CatEntity {
    @PrimaryGeneratedColumn()
    id: number

    @Column()
    name: string

    @Column()
    color: string

    @Column({ nullable: true })
    age: number | null

    @CreateDateColumn()
    createdAt: string
}

describe('paginate', () => {
    let repo: Repository<CatEntity>
    let cats: CatEntity[]

    beforeAll(async () => {
        const connection = await createConnection({
            type: 'sqlite',
            database: ':memory:',
            synchronize: true,
            logging: false,
            entities: [CatEntity],
        })
        repo = connection.getRepository(CatEntity)
        cats = await repo.save([
            repo.create({ name: 'Milo', color: 'brown', age: 6 }),
            repo.create({ name: 'Garfield', color: 'ginger', age: null }),
            repo.create({ name: 'Shadow', color: 'black', age: 4 }),
            repo.create({ name: 'George', color: 'white', age: 3 }),
            repo.create({ name: 'Leche', color: 'white', age: null }),
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

        const result = await paginate<CatEntity>(query, repo, config)

        expect(result).toBeInstanceOf(Paginated)
        expect(result.data).toStrictEqual(cats.slice(0, 1))
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

        const result = await paginate<CatEntity>(query, repo, config)

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

        const result = await paginate<CatEntity>(query, repo, config)

        expect(result.data).toStrictEqual(cats.slice(0, 2))
    })

    it('should return correct links', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
        }
        const query: PaginateQuery = {
            path: '',
            page: 2,
            limit: 2,
        }

        const { links } = await paginate<CatEntity>(query, repo, config)

        expect(links.first).toBe('?page=1&limit=2&sortBy=id:ASC')
        expect(links.previous).toBe('?page=1&limit=2&sortBy=id:ASC')
        expect(links.current).toBe('?page=2&limit=2&sortBy=id:ASC')
        expect(links.next).toBe('?page=3&limit=2&sortBy=id:ASC')
        expect(links.last).toBe('?page=3&limit=2&sortBy=id:ASC')
    })

    it('should default to defaultSortBy if query sortBy does not exist', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id', 'createdAt'],
            defaultSortBy: [['id', 'DESC']],
        }
        const query: PaginateQuery = {
            path: '',
        }

        const result = await paginate<CatEntity>(query, repo, config)

        expect(result.meta.sortBy).toStrictEqual([['id', 'DESC']])
        expect(result.data).toStrictEqual(cats.slice(0).reverse())
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

        const result = await paginate<CatEntity>(query, repo, config)

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

        const result = await paginate<CatEntity>(query, repo, config)

        expect(result.meta.search).toStrictEqual('i')
        expect(result.data).toStrictEqual([cats[0], cats[1], cats[3], cats[4]])
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&search=i')
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

        const result = await paginate<CatEntity>(query, repo, config)

        expect(result.meta.filter).toStrictEqual({
            name: '$not:Leche',
        })
        expect(result.data).toStrictEqual([cats[3]])
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

        const result = await paginate<CatEntity>(query, repo, config)

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

        const result = await paginate<CatEntity>(query, repo, config)

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

        const result = await paginate<CatEntity>(query, repo, config)

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

        const result = await paginate<CatEntity>(query, repo, config)

        expect(result.data).toStrictEqual([cats[0], cats[2]])
        expect(result.links.current).toBe('?page=1&limit=20&sortBy=id:ASC&filter.age=$gte:4')
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

        const result = await paginate<CatEntity>(query, repo, config)

        expect(result.data).toStrictEqual([cats[1], cats[4]])
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

        const result = await paginate<CatEntity>(query, repo, config)

        expect(result.data).toStrictEqual([cats[0], cats[2], cats[3]])
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

        const result = await paginate<CatEntity>(query, repo, config)

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

        const result = await paginate<CatEntity>(query, repo, config)

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
            await paginate<CatEntity>(query, repo, config)
        } catch (err) {
            expect(err).toBeInstanceOf(HttpException)
        }
    })
})
