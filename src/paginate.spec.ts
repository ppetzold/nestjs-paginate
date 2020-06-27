import { createConnection, Repository } from 'typeorm'
import { Paginated, paginate, PaginateConfig } from './paginate'
import { PaginateQuery } from './decorator'
import { Entity, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm'
import { HttpException } from '@nestjs/common'

@Entity()
export class CatEntity {
    @PrimaryGeneratedColumn()
    id: number

    @CreateDateColumn()
    createdAt: string
}

describe('paginate', () => {
    let repo: Repository<CatEntity>

    beforeAll(async () => {
        const connection = await createConnection({
            type: 'sqlite',
            database: ':memory:',
            synchronize: true,
            logging: false,
            entities: [CatEntity],
        })
        repo = connection.getRepository(CatEntity)
        await repo.save([repo.create(), repo.create(), repo.create(), repo.create(), repo.create()])
    })

    it('should return an instance of Paginated', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
            defaultSortBy: [['createdAt', 'DESC']], // Should fall back to id
            defaultLimit: 1,
        }
        const query: PaginateQuery = {
            path: '',
            page: 30, // will fallback to last available page
            limit: 2,
            sortBy: [['id', 'ASC']],
        }

        const results = await paginate<CatEntity>(query, repo, config)

        expect(results).toBeInstanceOf(Paginated)
    })

    it('should default to index 0 of sortableColumns, when no other are given', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id'],
        }
        const query: PaginateQuery = {
            path: '',
            page: 0,
        }

        const results = await paginate<CatEntity>(query, repo, config)

        expect(results).toBeInstanceOf(Paginated)
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
            defaultSortBy: [['createdAt', 'DESC']],
        }
        const query: PaginateQuery = {
            path: '',
        }

        const results = await paginate<CatEntity>(query, repo, config)

        expect(results.meta.sortBy).toStrictEqual([['createdAt', 'DESC']])
    })

    it('should accept multiple columns to sort', async () => {
        const config: PaginateConfig<CatEntity> = {
            sortableColumns: ['id', 'createdAt'],
        }
        const query: PaginateQuery = {
            path: '',
            sortBy: [
                ['createdAt', 'DESC'],
                ['id', 'ASC'],
            ],
        }

        const { meta } = await paginate<CatEntity>(query, repo, config)

        expect(meta.sortBy).toStrictEqual([
            ['createdAt', 'DESC'],
            ['id', 'ASC'],
        ])
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
