import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants'
import { HttpArgumentsHost, CustomParamFactory, ExecutionContext } from '@nestjs/common/interfaces'
import { Request } from 'express'
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

function contextFactory(query: Request['query']): Partial<ExecutionContext> {
    const mockContext: Partial<ExecutionContext> = {
        switchToHttp: (): HttpArgumentsHost =>
            Object({
                getRequest: (): Partial<Request> =>
                    Object({
                        protocol: 'http',
                        get: () => 'localhost',
                        baseUrl: '',
                        path: '/items',
                        query: query,
                    }),
            }),
    }
    return mockContext
}

describe('Decorator', () => {
    it('should handle undefined query fields', () => {
        const context = contextFactory({})

        const result: PaginateQuery = decoratorfactory(null, context)

        expect(result).toStrictEqual({
            page: undefined,
            limit: undefined,
            sort: undefined,
            search: undefined,
            path: 'http://localhost/items',
        })
    })

    it('should handle defined query fields', () => {
        const context = contextFactory({
            page: '1',
            limit: '20',
            sort: ['id:ASC', 'createdAt:DESC'],
            search: 'white',
        })

        const result: PaginateQuery = decoratorfactory(null, context)

        expect(result).toStrictEqual({
            page: 1,
            limit: 20,
            sort: [
                ['id', 'ASC'],
                ['createdAt', 'DESC'],
            ],
            search: 'white',
            path: 'http://localhost/items',
        })
    })
})
