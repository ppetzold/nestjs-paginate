import { PaginatedEndpoint, PaginatedEndpointOptions } from './paginated-endpoint.decorator'
import { Type } from '@nestjs/common'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { Get } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { ParameterObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface'

class TestDto {
    id: string
}

// eslint-disable-next-line @typescript-eslint/ban-types
async function getSwaggerDefinitionForEndpoint(entityType: Type<unknown>, options?: PaginatedEndpointOptions) {
    class TestController {
        @PaginatedEndpoint(entityType, options)
        @Get('/test')
        public test(): void {
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
    it('should annotate endpoint with OpenApi documentation', async () => {
        const openApiDefinition = await getSwaggerDefinitionForEndpoint(TestDto)

        expect(openApiDefinition.paths['/test'].get.parameters).toEqual([
            {
                name: 'page',
                required: false,
                in: 'query',
                description: 'Page number (starting from 1)',
                example: 1,
                schema: {},
            },
            {
                name: 'limit',
                required: false,
                in: 'query',
                description: 'Number of records per page',
                example: 10,
                schema: {},
            },
            {
                name: 'search',
                required: false,
                in: 'query',
                description: 'Multicolumn search term',
                schema: {},
            },
            {
                name: 'searchBy',
                required: false,
                in: 'query',
                description: "Limit columns to which apply 'search' term",
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
                description: 'Format: _field_:_direction_ [direction may be ASC or DESC] e.g. id:DESC',
                schema: {},
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
                                    $ref: '#/components/schemas/PaginatedResponseDto',
                                },
                                {
                                    properties: {
                                        data: {
                                            type: 'array',
                                            items: {
                                                $ref: '#/components/schemas/TestDto',
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

    it('should not add search options to OpenApi documentation when search is false', async () => {
        const openApiDefinition = await getSwaggerDefinitionForEndpoint(TestDto, { search: false })
        const queryParametersNotExpected = ['search', 'searchBy']
        const foundParameter = openApiDefinition.paths['/test'].get.parameters.find((parameter: ParameterObject) =>
            queryParametersNotExpected.includes(parameter.name)
        )

        expect(foundParameter).toBeUndefined()
    })

    it('should not add sort options to OpenApi documentation when search is false', async () => {
        const openApiDefinition = await getSwaggerDefinitionForEndpoint(TestDto, { sort: false })
        const foundParameter = openApiDefinition.paths['/test'].get.parameters.find(
            (parameter: ParameterObject) => parameter.name == 'sortBy'
        )

        expect(foundParameter).toBeUndefined()
    })

    it('should add one filter query parameter to OpenApi documentation when giving one filter', async () => {
        const openApiDefinition = await getSwaggerDefinitionForEndpoint(TestDto, { filterProperties: ['name'] })

        const foundParameters = openApiDefinition.paths['/test'].get.parameters.filter((parameter: ParameterObject) =>
            parameter.name.startsWith('filter.')
        )

        expect(foundParameters).toHaveLength(1)
        expect(foundParameters[0]).toEqual({
            name: 'filter.name',
            required: false,
            in: 'query',
            description:
                'Format: $_comp_:_value_ [comp may be $eq, $not, $null, $in, $gt, $gte, $lt, $lte, $btw, $ilike] e.g. $eq:1',
            schema: {},
        })
    })

    it('should add all provided filters properties to OpenApi documentation when providing multiple filter properties', async () => {
        const openApiDefinition = await getSwaggerDefinitionForEndpoint(TestDto, { filterProperties: ['name', 'age'] })

        const foundParameters = openApiDefinition.paths['/test'].get.parameters.filter((parameter: ParameterObject) =>
            parameter.name.startsWith('filter.')
        )

        expect(foundParameters).toEqual([
            {
                name: 'filter.name',
                required: false,
                in: 'query',
                description:
                    'Format: $_comp_:_value_ [comp may be $eq, $not, $null, $in, $gt, $gte, $lt, $lte, $btw, $ilike] e.g. $eq:1',
                schema: {},
            },
            {
                name: 'filter.age',
                required: false,
                in: 'query',
                description:
                    'Format: $_comp_:_value_ [comp may be $eq, $not, $null, $in, $gt, $gte, $lt, $lte, $btw, $ilike] e.g. $eq:1',
                schema: {},
            },
        ])
    })
})
