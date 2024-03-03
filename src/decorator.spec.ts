import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants'
import { CustomParamFactory, ExecutionContext, HttpArgumentsHost } from '@nestjs/common/interfaces'
import { Request as ExpressRequest } from 'express'
import { FastifyRequest } from 'fastify'
import { Paginate, PaginateQuery } from './decorator'

// eslint-disable-next-line @typescript-eslint/ban-types
function getParamDecoratorFactory<T>(decorator: Function): CustomParamFactory {
    class Test {
        public test(@decorator() _value: T): void {
            //
        }
    }
    const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, Test, 'test')
    return args[Object.keys(args)[0]].factory
}
const decoratorFactory = getParamDecoratorFactory<PaginateQuery>(Paginate)

const emptyQuery = {
    page: undefined,
    limit: undefined,
    sortBy: undefined,
    search: undefined,
    searchBy: undefined,
    filter: undefined,
    select: undefined,
    path: 'http://localhost/items',
} as const

function resultFactory(defined: Partial<typeof emptyQuery>): typeof emptyQuery {
    return Object.assign({}, emptyQuery, defined)
}

function expressContextFactory(query: ExpressRequest['query']): Partial<ExecutionContext> {
    return {
        switchToHttp: (): HttpArgumentsHost =>
            Object({
                getRequest: (): Partial<ExpressRequest> =>
                    Object({
                        protocol: 'http',
                        get: () => 'localhost',
                        originalUrl: '/items?@search=2423',
                        query,
                    }),
            }),
    }
}

function fastifyContextFactory(query: FastifyRequest['query']): Partial<ExecutionContext> {
    return {
        switchToHttp: (): HttpArgumentsHost =>
            Object({
                getRequest: (): Partial<FastifyRequest> =>
                    Object({
                        protocol: 'http',
                        hostname: 'localhost',
                        url: '/items?@search=2423',
                        originalUrl: '/items?@search=2423',
                        query,
                    }),
            }),
    }
}

describe('Decorator', () => {
    it('should handle express undefined query fields', () => {
        const context = expressContextFactory({})

        const result: PaginateQuery = decoratorFactory(null, context)

        expect(result).toStrictEqual(resultFactory({}))
    })

    it('should handle fastify undefined query fields', () => {
        const context = fastifyContextFactory({})

        const result: PaginateQuery = decoratorFactory(null, context)

        expect(result).toStrictEqual(resultFactory({}))
    })

    it('should parse @search object', () => {
        const context = expressContextFactory({
            ['@search']: {
                query: '432',
                fields: 'field1,field2',
            },
        })

        const result: PaginateQuery = decoratorFactory(null, context)

        expect(result).toStrictEqual(resultFactory({ search: '432', searchBy: ['field1', 'field2'] }))
    })

    it('should parse @search query', () => {
        const context = expressContextFactory({
            ['@search']: '432',
        })

        const result: PaginateQuery = decoratorFactory(null, context)

        expect(result).toStrictEqual(resultFactory({ search: '432' }))
    })

    it('should handle express defined query fields', () => {
        const context = expressContextFactory({
            page: { number: '1', size: '20' },
            sort: 'id,-createdAt',
            ['@search']: 'white',
            filter: { name: '$not:$eq:Kitty', createdAt: ['$gte:2020-01-01', '$lte:2020-12-31'] },
            select: 'name,createdAt',
        })

        const result: PaginateQuery = decoratorFactory(null, context)

        expect(result).toStrictEqual(resultFactory({
            page: 1,
            limit: 20,
            sortBy: [
                ['id', 'ASC'],
                ['createdAt', 'DESC'],
            ],
            search: 'white',
            select: ['name', 'createdAt'],
            filter: {
                name: '$not:$eq:Kitty',
                createdAt: ['$gte:2020-01-01', '$lte:2020-12-31'],
            },
        }))
    })

    it('should handle express partially defined query families', () => {
        const context = expressContextFactory({
            page: { number: '1' },
            sort: 'id,-createdAt',
            ['@search']: 'white',
            filter: { name: '$not:$eq:Kitty', createdAt: ['$gte:2020-01-01', '$lte:2020-12-31'] },
            select: 'name,createdAt',
        })

        const result: PaginateQuery = decoratorFactory(null, context)

        expect(result).toStrictEqual(resultFactory({
            page: 1,
            sortBy: [
                ['id', 'ASC'],
                ['createdAt', 'DESC'],
            ],
            search: 'white',
            select: ['name', 'createdAt'],
            filter: {
                name: '$not:$eq:Kitty',
                createdAt: ['$gte:2020-01-01', '$lte:2020-12-31'],
            },
        }))
    })

    it('should handle fastify defined query fields', () => {
        const context = fastifyContextFactory({
            page: {
                number: '1',
                size: '20',
            },
            sort: 'id,-createdAt',
            ['@search']: 'white',
            filter: { name: '$not:$eq:Kitty', createdAt: ['$gte:2020-01-01', '$lte:2020-12-31'] },
            select: 'name,createdAt',
        })

        const result: PaginateQuery = decoratorFactory(null, context)

        expect(result).toStrictEqual(resultFactory({
            page: 1,
            limit: 20,
            sortBy: [
                ['id', 'ASC'],
                ['createdAt', 'DESC'],
            ],
            search: 'white',
            filter: {
                name: '$not:$eq:Kitty',
                createdAt: ['$gte:2020-01-01', '$lte:2020-12-31'],
            },
            select: ['name', 'createdAt'],
        }))
    })
})
