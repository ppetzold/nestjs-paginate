import { applyDecorators, Type } from '@nestjs/common'
import { ApiExtraModels, ApiOkResponse, ApiProperty, ApiQuery, getSchemaPath } from '@nestjs/swagger'

export interface PaginatedEndpointOptions {
    search?: boolean
    sort?: boolean
    filterProperties?: string[]
}

class PaginatedResponseMetadataDto {
    @ApiProperty()
    itemsPerPage: number
    @ApiProperty()
    totalItems: number
    @ApiProperty()
    currentPage: number
    @ApiProperty()
    totalPages: number
    @ApiProperty()
    sortBy: string[][]
    @ApiProperty()
    searchBy: string[]
    @ApiProperty()
    search: string
    @ApiProperty({ required: false })
    filter?: Record<string, string | string[]>
}

class PaginatedResponseLinksDto {
    @ApiProperty({ required: false })
    first?: string
    @ApiProperty({ required: false })
    previous?: string
    @ApiProperty()
    current: string
    @ApiProperty({ required: false })
    next?: string
    @ApiProperty({ required: false })
    last?: string
}

class PaginatedResponseDto<T> {
    data: T[]
    @ApiProperty()
    meta: PaginatedResponseMetadataDto
    @ApiProperty()
    links: PaginatedResponseLinksDto
}

const searchDecorators = [
    ApiQuery({ name: 'search', required: false, description: 'Multicolumn search term' }),
    ApiQuery({
        name: 'searchBy',
        required: false,
        description: "Limit columns to which apply 'search' term",
        isArray: true,
        type: 'string',
    }),
]
const sortDecorators = [
    ApiQuery({
        name: 'sortBy',
        required: false,
        description: 'Format: _field_:_direction_ [direction may be ASC or DESC] e.g. id:DESC',
    }),
]

function buildApiOkResponse(responseClass: Type<unknown>) {
    return ApiOkResponse({
        schema: {
            allOf: [
                { $ref: getSchemaPath(PaginatedResponseDto) },
                {
                    properties: {
                        data: {
                            type: 'array',
                            items: { $ref: getSchemaPath(responseClass) },
                        },
                    },
                },
            ],
        },
    })
}

function buildApiQueryForFilters(properties: string[]) {
    return properties.map((property) =>
        ApiQuery({
            name: `filter.${property}`,
            required: false,
            description:
                'Format: $_comp_:_value_ [comp may be $eq, $not, $null, $in, $gt, $gte, $lt, $lte, $btw, $ilike] e.g. $eq:1',
        })
    )
}

export function PaginatedEndpoint<ResponseType extends Type<unknown>>(
    responseType: ResponseType,
    { search, sort, filterProperties }: PaginatedEndpointOptions = {
        search: true,
        sort: true,
        filterProperties: [],
    }
) {
    const decorators: MethodDecorator[] = [
        ApiExtraModels(PaginatedResponseDto, responseType),
        buildApiOkResponse(responseType),
        ApiQuery({ name: 'page', required: false, description: 'Page number (starting from 1)', example: 1 }),
        ApiQuery({ name: 'limit', required: false, description: 'Number of records per page', example: 10 }),
    ]

    if (search) decorators.push(...searchDecorators)
    if (sort) decorators.push(...sortDecorators)
    if (filterProperties) decorators.push(...buildApiQueryForFilters(filterProperties))

    return applyDecorators(...decorators)
}
