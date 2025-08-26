import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants'
import {
    CustomParamFactory,
    ExecutionContext,
    HttpArgumentsHost,
    RpcArgumentsHost,
    Type,
    WsArgumentsHost,
} from '@nestjs/common/interfaces'
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

function expressContextFactory(query: ExpressRequest['query']): ExecutionContext {
    const mockContext: ExecutionContext = {
        getType: <ContextType>() => 'http' as ContextType,
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
        getClass: <T = any>(): Type<T> => {
            throw new Error('Function not implemented.')
        },
        getHandler: (): (() => void) => {
            throw new Error('Function not implemented.')
        },
        getArgs: <T extends Array<any> = any[]>(): T => {
            throw new Error('Function not implemented.')
        },
        getArgByIndex: <T = any>(): T => {
            throw new Error('Function not implemented.')
        },
        switchToRpc: (): RpcArgumentsHost => {
            throw new Error('Function not implemented.')
        },
        switchToWs: (): WsArgumentsHost => {
            throw new Error('Function not implemented.')
        },
    }
    return mockContext
}

function fastifyContextFactory(query: FastifyRequest['query']): ExecutionContext {
    const mockContext: ExecutionContext = {
        getType: <ContextType>() => 'http' as ContextType,
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
        getClass: <T = any>(): Type<T> => {
            throw new Error('Function not implemented.')
        },
        getHandler: (): (() => void) => {
            throw new Error('Function not implemented.')
        },
        getArgs: <T extends Array<any> = any[]>(): T => {
            throw new Error('Function not implemented.')
        },
        getArgByIndex: <T = any>(): T => {
            throw new Error('Function not implemented.')
        },
        switchToRpc: (): RpcArgumentsHost => {
            throw new Error('Function not implemented.')
        },
        switchToWs: (): WsArgumentsHost => {
            throw new Error('Function not implemented.')
        },
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
            cursor: undefined,
            withDeleted: undefined,
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
            cursor: undefined,
            withDeleted: undefined,
            path: 'http://localhost/items',
        })
    })

    it('should handle express defined query fields', () => {
        const context = expressContextFactory({
            page: '1',
            limit: '20',
            sortBy: ['id:ASC', 'createdAt:DESC'],
            search: 'white',
            withDeleted: 'true',
            'filter.name': '$not:$eq:Kitty',
            'filter.createdAt': ['$gte:2020-01-01', '$lte:2020-12-31'],
            select: ['name', 'createdAt'],
            cursor: 'abc123',
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
            withDeleted: true,
            select: ['name', 'createdAt'],
            path: 'http://localhost/items',
            filter: {
                name: '$not:$eq:Kitty',
                createdAt: ['$gte:2020-01-01', '$lte:2020-12-31'],
            },
            cursor: 'abc123',
        })
    })

    it('should handle fastify defined query fields', () => {
        const context = fastifyContextFactory({
            page: '1',
            limit: '20',
            sortBy: ['id:ASC', 'createdAt:DESC'],
            search: 'white',
            withDeleted: 'false',
            'filter.name': '$not:$eq:Kitty',
            'filter.createdAt': ['$gte:2020-01-01', '$lte:2020-12-31'],
            select: ['name', 'createdAt'],
            cursor: 'abc123',
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
            withDeleted: false,
            path: 'http://localhost/items',
            filter: {
                name: '$not:$eq:Kitty',
                createdAt: ['$gte:2020-01-01', '$lte:2020-12-31'],
            },
            select: ['name', 'createdAt'],
            cursor: 'abc123',
        })
    })
})
