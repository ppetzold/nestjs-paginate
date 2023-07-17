import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants'
import { HttpArgumentsHost, CustomParamFactory, ExecutionContext } from '@nestjs/common/interfaces'
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
const decoratorfactory = getParamDecoratorFactory<PaginateQuery>(Paginate)

function expressContextFactory(query: ExpressRequest['query']): Partial<ExecutionContext> {
    const mockContext: Partial<ExecutionContext> = {
        switchToHttp: (): HttpArgumentsHost =>
            Object({
                getRequest: (): Partial<ExpressRequest> =>
                    Object({
                        protocol: 'http',
                        get: () => 'localhost',
                        originalUrl: '/items?search=2423',
                        query: query,
                    }),
            }),
    }
    return mockContext
}

function fastifyContextFactory(query: FastifyRequest['query']): Partial<ExecutionContext> {
    const mockContext: Partial<ExecutionContext> = {
        switchToHttp: (): HttpArgumentsHost =>
            Object({
                getRequest: (): Partial<FastifyRequest> =>
                    Object({
                        protocol: 'http',
                        hostname: 'localhost',
                        url: '/items?search=2423',
                        originalUrl: '/items?search=2423',
                        query: query,
                    }),
            }),
    }
    return mockContext
}

describe('Decorator', () => {
    it('should handle express undefined query fields', () => {
        const context = expressContextFactory({})

        const result: PaginateQuery = decoratorfactory(null, context)

        expect(result).toStrictEqual({
            page: undefined,
            limit: undefined,
            sortBy: undefined,
            search: undefined,
            searchBy: undefined,
            filter: undefined,
            select: undefined,
            path: 'http://localhost/items',
        })
    })

    it('should handle fastify undefined query fields', () => {
        const context = fastifyContextFactory({})

        const result: PaginateQuery = decoratorfactory(null, context)

        expect(result).toStrictEqual({
            page: undefined,
            limit: undefined,
            sortBy: undefined,
            search: undefined,
            searchBy: undefined,
            filter: undefined,
            select: undefined,
            path: 'http://localhost/items',
        })
    })

    it('should handle express defined query fields', () => {
        const context = expressContextFactory({
            page: '1',
            limit: '20',
            sortBy: ['id:ASC', 'createdAt:DESC'],
            search: 'white',
            'filter.name': '$not:$eq:Kitty',
            'filter.createdAt': ['$gte:2020-01-01', '$lte:2020-12-31'],
            select: ['name', 'createdAt'],
        })

        const result: PaginateQuery = decoratorfactory(null, context)

        expect(result).toStrictEqual({
            page: 1,
            limit: 20,
            sortBy: [
                ['id', 'ASC'],
                ['createdAt', 'DESC'],
            ],
            search: 'white',
            searchBy: undefined,
            select: ['name', 'createdAt'],
            path: 'http://localhost/items',
            filter: {
                name: '$not:$eq:Kitty',
                createdAt: ['$gte:2020-01-01', '$lte:2020-12-31'],
            },
        })
    })

    it('should handle fastify defined query fields', () => {
        const context = fastifyContextFactory({
            page: '1',
            limit: '20',
            sortBy: ['id:ASC', 'createdAt:DESC'],
            search: 'white',
            'filter.name': '$not:$eq:Kitty',
            'filter.createdAt': ['$gte:2020-01-01', '$lte:2020-12-31'],
            select: ['name', 'createdAt'],
        })

        const result: PaginateQuery = decoratorfactory(null, context)

        expect(result).toStrictEqual({
            page: 1,
            limit: 20,
            sortBy: [
                ['id', 'ASC'],
                ['createdAt', 'DESC'],
            ],
            search: 'white',
            searchBy: undefined,
            path: 'http://localhost/items',
            filter: {
                name: '$not:$eq:Kitty',
                createdAt: ['$gte:2020-01-01', '$lte:2020-12-31'],
            },
            select: ['name', 'createdAt'],
        })
    })
})
