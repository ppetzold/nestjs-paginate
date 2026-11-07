import { DataSource, Repository } from 'typeorm'
import { BaseDataSourceOptions } from 'typeorm/data-source/BaseDataSourceOptions'
import { LongAliasLeafEntity, LongAliasOwnerEntity, LongAliasTargetEntity } from './__tests__/long-alias.entity'
import { PaginateQuery } from './decorator'
import { FilterOperator } from './filter'
import { getJoinAlias } from './helper'
import { paginate, PaginateConfig } from './paginate'

describe('getJoinAlias', () => {
    const driver = (maxAliasLength?: number) => ({ connection: { driver: { maxAliasLength } } }) as any

    it('keeps aliases that fit within the driver limit unchanged', () => {
        expect(getJoinAlias(driver(63), '__root_toys_rel')).toBe('__root_toys_rel')
        expect(getJoinAlias(driver(undefined), 'x'.repeat(200))).toBe('x'.repeat(200))
    })

    it('shortens long aliases deterministically and keeps them distinct', () => {
        const prefix = '__root_' + 'a'.repeat(60)
        const first = getJoinAlias(driver(63), `${prefix}_first_rel`)
        const second = getJoinAlias(driver(63), `${prefix}_second_rel`)

        expect(first.length).toBeLessThanOrEqual(63)
        expect(second.length).toBeLessThanOrEqual(63)
        expect(first).not.toBe(second)
        expect(getJoinAlias(driver(63), `${prefix}_first_rel`)).toBe(first)
    })
})

describe('paginate with join aliases longer than the database identifier limit', () => {
    let dataSource: DataSource
    let ownerRepo: Repository<LongAliasOwnerEntity>

    const first = 'relationWithAnExceptionallyLongNameThatOverflowsTheAliasLimitFirst'
    const second = 'relationWithAnExceptionallyLongNameThatOverflowsTheAliasLimitSecond'
    const nested = 'leafReachedThroughAnotherVeryLongRelationName'
    const toMany = 'targetsReachedThroughAVeryLongRelationName'

    beforeAll(async () => {
        const dbOptions: Omit<Partial<BaseDataSourceOptions>, 'poolSize'> = {
            dropSchema: true,
            synchronize: true,
            logging: ['error'],
            entities: [LongAliasOwnerEntity, LongAliasTargetEntity, LongAliasLeafEntity],
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
                    type: 'better-sqlite3',
                    database: ':memory:',
                })
                break
            default:
                throw new Error('Invalid DB')
        }
        await dataSource.initialize()

        ownerRepo = dataSource.getRepository(LongAliasOwnerEntity)
        const targetRepo = dataSource.getRepository(LongAliasTargetEntity)
        const leafRepo = dataSource.getRepository(LongAliasLeafEntity)

        const [leafA, leafB] = await leafRepo.save([leafRepo.create({ label: 'A' }), leafRepo.create({ label: 'B' })])
        const [one, two] = await targetRepo.save([
            targetRepo.create({ name: 'one', [nested]: leafA }),
            targetRepo.create({ name: 'two', [nested]: leafB }),
        ])
        const [alpha, beta] = await ownerRepo.save([
            ownerRepo.create({ name: 'alpha', [first]: one, [second]: two }),
            ownerRepo.create({ name: 'beta', [first]: two, [second]: one }),
        ])
        await targetRepo.save([
            targetRepo.create({ name: 'child of alpha', owner: alpha }),
            targetRepo.create({ name: 'child of beta', owner: beta }),
        ])
    })

    afterAll(async () => {
        await dataSource?.destroy()
    })

    it('loads, sorts and filters two relations whose aliases share a long prefix', async () => {
        const config: PaginateConfig<LongAliasOwnerEntity> = {
            relations: { [first]: { [nested]: true }, [second]: { [nested]: true } },
            sortableColumns: ['id', `${first}.name`, `${second}.${nested}.label`],
            filterableColumns: {
                [`${first}.name`]: [FilterOperator.EQ],
                [`${second}.${nested}.label`]: [FilterOperator.EQ],
            },
            searchableColumns: [`${first}.name`, `${second}.name`],
        }

        const result = await paginate<LongAliasOwnerEntity>(
            {
                path: '',
                sortBy: [[`${second}.${nested}.label`, 'DESC']],
                filter: { [`${first}.name`]: '$eq:one', [`${second}.${nested}.label`]: '$eq:B' },
                search: 'o',
            },
            ownerRepo,
            config
        )

        expect(result.data.map((owner) => owner.name)).toStrictEqual(['alpha'])
        const [alpha] = result.data
        expect(alpha[first].name).toBe('one')
        expect(alpha[first][nested].label).toBe('A')
        expect(alpha[second].name).toBe('two')
        expect(alpha[second][nested].label).toBe('B')
    })

    it('filters through to-many and nested relations without loading them', async () => {
        const result = await paginate<LongAliasOwnerEntity>(
            {
                path: '',
                filter: {
                    [`${toMany}.name`]: '$eq:child of beta',
                    [`${first}.${nested}.label`]: '$eq:B',
                },
            },
            ownerRepo,
            {
                sortableColumns: ['id'],
                filterableColumns: {
                    [`${toMany}.name`]: [FilterOperator.EQ],
                    [`${first}.${nested}.label`]: [FilterOperator.EQ],
                },
            }
        )

        expect(result.data.map((owner) => owner.name)).toStrictEqual(['beta'])
    })

    it('applies a config where on nested relations that are not loaded', async () => {
        const result = await paginate<LongAliasOwnerEntity>({ path: '' }, ownerRepo, {
            sortableColumns: ['id'],
            where: {
                [first]: { [nested]: { label: 'A' } },
                [second]: { [nested]: { label: 'B' } },
            },
        })

        expect(result.data.map((owner) => owner.name)).toStrictEqual(['alpha'])
    })

    it('joins the relation parts of a polymorphic (~) filter', async () => {
        const column = `${first}.${nested}.label~${second}.${nested}.label`
        const result = await paginate<LongAliasOwnerEntity>(
            { path: '', filterExpression: `${column}=$eq:B` } as PaginateQuery,
            ownerRepo,
            { sortableColumns: ['id'], filterableColumns: { [column]: true } }
        )

        expect(result.data.map((owner) => owner.name)).toStrictEqual(['beta'])
    })
})
