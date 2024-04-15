import { Get, Post, Type } from '@nestjs/common'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { FilterOperator, FilterSuffix, PaginateConfig } from '../paginate'
import { Test } from '@nestjs/testing'
import { PaginatedSwaggerDocs } from './api-paginated-swagger-docs.decorator'
import { ApiPaginationQuery } from './api-paginated-query.decorator'
import { ApiOkPaginatedResponse } from './api-ok-paginated-response.decorator'

const BASE_PAGINATION_CONFIG = {
    sortableColumns: ['id'],
} satisfies PaginateConfig<TestDto>

const FULL_CONFIG = {
    ...BASE_PAGINATION_CONFIG,
    defaultSortBy: [['id', 'DESC']],
    defaultLimit: 20,
    maxLimit: 100,
    filterableColumns: {
        id: true,
        name: [FilterOperator.EQ, FilterSuffix.NOT],
    },
    searchableColumns: ['name'],
    select: ['id', 'name'],
} satisfies PaginateConfig<TestDto>

class TestDto {
    id: string
    name: string
}

// eslint-disable-next-line @typescript-eslint/ban-types
async function getSwaggerDefinitionForEndpoint<T>(entityType: Type<T>, config: PaginateConfig<T>) {
    class TestController {
        @PaginatedSwaggerDocs(entityType, config)
        @Get('/test')
        public test(): void {
            //
        }

        @ApiPaginationQuery(config)
        @ApiOkPaginatedResponse(entityType, config)
        @Post('/test')
        public testPost(): void {
            //
        }
    }

    const fakeAppModule = await Test.createTestingModule({
        controllers: [TestController],
    }).compile()
    const fakeApp = fakeAppModule.createNestApplication()

    return SwaggerModule.createDocument(fakeApp, new DocumentBuilder().build())
}

describe('PaginatedEndpoint decorator', () => {
    it('post and get definition should be the same', async () => {
        const openApiDefinition = await getSwaggerDefinitionForEndpoint(TestDto, BASE_PAGINATION_CONFIG)

        expect(openApiDefinition.paths['/test'].get.parameters).toStrictEqual(
            openApiDefinition.paths['/test'].post.parameters
        )
    })

    it('should annotate endpoint with OpenApi documentation with limited config', async () => {
        const openApiDefinition = await getSwaggerDefinitionForEndpoint(TestDto, BASE_PAGINATION_CONFIG)

        const params = openApiDefinition.paths['/test'].get.parameters
        expect(params).toStrictEqual([
            {
                name: 'page[number]',
                required: false,
                in: 'query',
                description:
                    'Page number to retrieve. If you provide an invalid value the default page number will applied.\n        <p>\n             <b>Example: </b> 1\n          </p>\n        <p>\n             <b>Default Value: </b> 1\n          </p>\n        ',
                schema: {
                    type: 'number',
                },
            },
            {
                name: 'page[size]',
                required: false,
                in: 'query',
                description:
                    'Number of records per page.\n      <p>\n             <b>Example: </b> 20\n          </p>\n      <p>\n             <b>Default Value: </b> 20\n          </p>\n      <p>\n             <b>Max Value: </b> 100\n          </p>\n\n      If the provided value is greater than the maximum value, the maximum value will be applied.\n      ',
                schema: {
                    type: 'number',
                },
            },
            {
                name: 'sort',
                required: false,
                in: 'query',
                explode: false,
                style: 'form',
                description:
                    'Comma separated list of field names to sort by. Add a minus to use a field name for a descending sort.\n      <p>\n             <b>Format: </b> fieldName OR -fieldName\n          </p>\n      <p>\n             <b>Example: </b> sort=-id,createdAt\n          </p>\n      <p>\n             <b>Default Value: </b> No default sorting specified, the result order is not guaranteed\n          </p>\n      <h4>Available Fields</h4><ul><li>id</li></ul>\n      ',
                schema: {
                    type: 'array',
                    items: {
                        type: 'string',
                        enum: ['id', '-id'],
                    },
                },
            },
        ])
        expect(openApiDefinition.paths['/test'].get.responses).toEqual({
            '200': {
                description: '',
                content: {
                    'application/json': {
                        schema: {
                            allOf: [
                                {
                                    $ref: '#/components/schemas/PaginatedDocumented',
                                },
                                {
                                    properties: {
                                        data: {
                                            type: 'array',
                                            items: {
                                                $ref: '#/components/schemas/TestDto',
                                            },
                                        },
                                        meta: {
                                            properties: {
                                                select: {
                                                    type: 'array',
                                                    items: {
                                                        type: 'string',
                                                    },
                                                },
                                                filter: {
                                                    type: 'object',
                                                    properties: {},
                                                },
                                            },
                                        },
                                    },
                                },
                            ],
                        },
                    },
                },
            },
        })
    })

    it('should annotate endpoint with OpenApi documentation with full config', async () => {
        const openApiDefinition = await getSwaggerDefinitionForEndpoint(TestDto, FULL_CONFIG)

        const params = openApiDefinition.paths['/test'].get.parameters
        expect(params).toStrictEqual([
            {
                name: 'page[number]',
                required: false,
                in: 'query',
                description:
                    'Page number to retrieve. If you provide an invalid value the default page number will applied.\n        <p>\n             <b>Example: </b> 1\n          </p>\n        <p>\n             <b>Default Value: </b> 1\n          </p>\n        ',
                schema: {
                    type: 'number',
                },
            },
            {
                name: 'page[size]',
                required: false,
                in: 'query',
                description:
                    'Number of records per page.\n      <p>\n             <b>Example: </b> 20\n          </p>\n      <p>\n             <b>Default Value: </b> 20\n          </p>\n      <p>\n             <b>Max Value: </b> 100\n          </p>\n\n      If the provided value is greater than the maximum value, the maximum value will be applied.\n      ',
                schema: {
                    type: 'number',
                },
            },
            {
                name: 'filter[id]',
                required: false,
                in: 'query',
                description:
                    'Filter by id query param.\n          <p>\n             <b>Format: </b> filter[id]={$not}:OPERATION:VALUE\n          </p>\n          <p>\n             <b>Example: </b> filter[id]=$not:$like:John Doe&filter[id]=like:John\n          </p>\n          <h4>Available Operations</h4><ul><li>$and</li>\n<li>$or</li>\n<li>$not</li>\n<li>$eq</li>\n<li>$gt</li>\n<li>$gte</li>\n<li>$in</li>\n<li>$null</li>\n<li>$lt</li>\n<li>$lte</li>\n<li>$btw</li>\n<li>$ilike</li>\n<li>$sw</li>\n<li>$contains</li></ul>',
                schema: {
                    type: 'array',
                    items: {
                        type: 'string',
                    },
                },
            },
            {
                name: 'filter[name]',
                required: false,
                in: 'query',
                description:
                    'Filter by name query param.\n          <p>\n             <b>Format: </b> filter[name]={$not}:OPERATION:VALUE\n          </p>\n          <p>\n             <b>Example: </b> filter[name]=$not:$like:John Doe&filter[name]=like:John\n          </p>\n          <h4>Available Operations</h4><ul><li>$eq</li>\n<li>$not</li></ul>',
                schema: {
                    type: 'array',
                    items: {
                        type: 'string',
                    },
                },
            },
            {
                name: 'sort',
                required: false,
                explode: false,
                style: 'form',
                in: 'query',
                description:
                    'Comma separated list of field names to sort by. Add a minus to use a field name for a descending sort.\n      <p>\n             <b>Format: </b> fieldName OR -fieldName\n          </p>\n      <p>\n             <b>Example: </b> sort=-id,createdAt\n          </p>\n      <p>\n             <b>Default Value: </b> -id\n          </p>\n      <h4>Available Fields</h4><ul><li>id</li></ul>\n      ',
                schema: {
                    type: 'array',
                    items: {
                        type: 'string',
                        enum: ['id', '-id'],
                    },
                },
            },
            {
                name: '@search[query]',
                required: false,
                in: 'query',
                description:
                    'Search term to filter result values across all searchable fields.\n        <p>\n             <b>Example: </b> John\n          </p>\n        <p>\n             <b>Default Value: </b> No default value\n          </p>\n        ',
                schema: {
                    type: 'string',
                },
            },
            {
                name: '@search[fields]',
                required: false,
                explode: false,
                in: 'query',
                description:
                    'List of fields to search by term to filter result values\n        <p>\n             <b>Example: </b> name\n          </p>\n        <p>\n             <b>Default Value: </b> By default all fields mentioned below will be used to search by term\n          </p>\n        <h4>Available Fields</h4><ul><li>name</li></ul>\n        ',
                schema: {
                    type: 'array',
                    items: {
                        enum: ['name'],
                        type: 'string',
                    },
                },
            },
            {
                name: 'select',
                required: false,
                in: 'query',
                description:
                    'List of fields to select.\n      <p>\n             <b>Example: </b> id,name\n          </p>\n      <p>\n             <b>Default Value: </b> By default all fields returns. If you want to select only some fields, provide them in query param\n          </p>\n      ',
                schema: {
                    type: 'string',
                },
            },
        ])
        expect(openApiDefinition.paths['/test'].get.responses).toEqual({
            '200': {
                description: '',
                content: {
                    'application/json': {
                        schema: {
                            allOf: [
                                {
                                    $ref: '#/components/schemas/PaginatedDocumented',
                                },
                                {
                                    properties: {
                                        data: {
                                            type: 'array',
                                            items: {
                                                $ref: '#/components/schemas/TestDto',
                                            },
                                        },
                                        meta: {
                                            properties: {
                                                select: {
                                                    type: 'array',
                                                    items: {
                                                        type: 'string',
                                                        enum: ['id', 'name'],
                                                    },
                                                },
                                                filter: {
                                                    type: 'object',
                                                    properties: {
                                                        id: {
                                                            oneOf: [
                                                                {
                                                                    type: 'string',
                                                                },
                                                                {
                                                                    type: 'array',
                                                                    items: {
                                                                        type: 'string',
                                                                    },
                                                                },
                                                            ],
                                                        },
                                                        name: {
                                                            oneOf: [
                                                                {
                                                                    type: 'string',
                                                                },
                                                                {
                                                                    type: 'array',
                                                                    items: {
                                                                        type: 'string',
                                                                    },
                                                                },
                                                            ],
                                                        },
                                                    },
                                                },
                                            },
                                        },
                                    },
                                },
                            ],
                        },
                    },
                },
            },
        })
    })
})
