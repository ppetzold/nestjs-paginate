import { Get, Post, Type } from '@nestjs/common'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { FilterOperator, FilterSuffix, PaginateConfig } from '../paginate'
import { Test } from '@nestjs/testing'
import { PaginatedSwaggerDocs } from './api-paginated-swagger-docs.decorator'
import { ApiPaginationQuery } from './api-paginated-query.decorator'
import { ApiOkPaginatedResponse } from './api-ok-paginated-response.decorator'
import * as fs from 'node:fs'
import * as path from 'node:path'

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
                name: 'page',
                required: false,
                in: 'query',
                description:
                    'Page number to retrieve. If you provide invalid value the default page number will applied\n\n**Example:** 1\n\n\n**Default Value:** 1\n\n',
                schema: {
                    type: 'number',
                },
            },
            {
                name: 'limit',
                required: false,
                in: 'query',
                description:
                    'Number of records per page.\n\n\n**Example:** 20\n\n\n\n**Default Value:** 20\n\n\n\n**Max Value:** 100\n\n\nIf provided value is greater than max value, max value will be applied.\n',
                schema: {
                    type: 'number',
                },
            },
            {
                name: 'sortBy',
                required: false,
                in: 'query',
                description:
                    'Parameter to sort by.\nTo sort by multiple fields, just provide query param multiple types. The order in url defines an order of sorting\n\n**Format:** {fieldName}:{DIRECTION}\n\n\n**Example:** sortBy=id:DESC\n\n\n**Default Value:** No default sorting specified, the result order is not guaranteed if not provided\n\n**Available Fields**\n- id\n',
                schema: {
                    type: 'array',
                    items: {
                        type: 'string',
                        enum: ['id:ASC', 'id:DESC'],
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
                name: 'page',
                required: false,
                in: 'query',
                description:
                    'Page number to retrieve. If you provide invalid value the default page number will applied\n\n**Example:** 1\n\n\n**Default Value:** 1\n\n',
                schema: {
                    type: 'number',
                },
            },
            {
                name: 'limit',
                required: false,
                in: 'query',
                description:
                    'Number of records per page.\n\n\n**Example:** 20\n\n\n\n**Default Value:** 20\n\n\n\n**Max Value:** 100\n\n\nIf provided value is greater than max value, max value will be applied.\n',
                schema: {
                    type: 'number',
                },
            },
            {
                name: 'filter.id',
                required: false,
                in: 'query',
                description:
                    'Filter by id query param.\n\n**Format:** filter.id={$not}:OPERATION:VALUE\n\n\n\n**Example:** filter.id=$btw:John Doe&filter.id=$contains:John Doe\n\n**Available Operations**\n- $eq\n\n- $gt\n\n- $gte\n\n- $in\n\n- $null\n\n- $lt\n\n- $lte\n\n- $btw\n\n- $ilike\n\n- $sw\n\n- $contains\n\n- $not\n\n- $and\n\n- $or',
                schema: {
                    type: 'array',
                    items: {
                        type: 'string',
                    },
                },
            },
            {
                name: 'filter.name',
                required: false,
                in: 'query',
                description:
                    'Filter by name query param.\n\n**Format:** filter.name={$not}:OPERATION:VALUE\n\n\n\n**Example:** filter.name=$eq:John Doe\n\n**Available Operations**\n- $eq\n\n- $not\n\n- $and\n\n- $or',
                schema: {
                    type: 'array',
                    items: {
                        type: 'string',
                    },
                },
            },
            {
                name: 'sortBy',
                required: false,
                in: 'query',
                description:
                    'Parameter to sort by.\nTo sort by multiple fields, just provide query param multiple types. The order in url defines an order of sorting\n\n**Format:** {fieldName}:{DIRECTION}\n\n\n**Example:** sortBy=id:DESC\n\n\n**Default Value:** id:DESC\n\n**Available Fields**\n- id\n',
                schema: {
                    type: 'array',
                    items: {
                        type: 'string',
                        enum: ['id:ASC', 'id:DESC'],
                    },
                },
            },
            {
                name: 'search',
                required: false,
                in: 'query',
                description:
                    'Search term to filter result values\n\n**Example:** John\n\n\n**Default Value:** No default value\n\n',
                schema: {
                    type: 'string',
                },
            },
            {
                name: 'searchBy',
                required: false,
                in: 'query',
                description:
                    'List of fields to search by term to filter result values\n\n**Example:** name\n\n\n**Default Value:** By default all fields mentioned below will be used to search by term\n\n**Available Fields**\n- name\n',
                schema: {
                    type: 'array',
                    items: {
                        type: 'string',
                    },
                },
            },
            {
                name: 'select',
                required: false,
                in: 'query',
                description:
                    'List of fields to select.\n\n**Example:** id,name\n\n\n**Default Value:** By default all fields returns. If you want to select only some fields, provide them in query param\n\n',
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

    it('should match a base config, snapshot test for all config', async () => {
        const openApiDefinition = await getSwaggerDefinitionForEndpoint(TestDto, FULL_CONFIG)
        const fullOpenApiDefinition = JSON.parse(
            fs.readFileSync(path.join(__dirname, 'resources/full-openapi-definition.json')).toString('utf-8')
        )

        expect(openApiDefinition).toStrictEqual(fullOpenApiDefinition)
    })
})
