import { applyDecorators, Type } from '@nestjs/common'
import { ApiExtraModels, ApiOkResponse, getSchemaPath } from '@nestjs/swagger'
import { ReferenceObject, SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface'
import { PaginateConfig } from '../paginate'
import { PaginatedDocumented } from './paginated-swagger.type'

export const ApiOkPaginatedResponse = <DTO extends Type<unknown>>(
    dataDto: DTO,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    paginatedConfig: PaginateConfig<any>
) => {
    const cols = paginatedConfig?.filterableColumns || {}

    return applyDecorators(
        ApiExtraModels(PaginatedDocumented, dataDto),
        ApiOkResponse({
            schema: {
                allOf: [
                    { $ref: getSchemaPath(PaginatedDocumented) },
                    {
                        properties: {
                            data: {
                                type: 'array',
                                items: { $ref: getSchemaPath(dataDto) },
                            },
                            meta: {
                                properties: {
                                    select: {
                                        type: 'array',
                                        items: {
                                            type: 'string',
                                            enum: paginatedConfig?.select,
                                        },
                                    },
                                    filter: {
                                        type: 'object',
                                        properties: Object.keys(cols).reduce(
                                            (acc, key) => {
                                                acc[key] = {
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
                                                }
                                                return acc
                                            },
                                            {} as Record<string, SchemaObject | ReferenceObject>
                                        ),
                                    },
                                },
                            },
                        },
                    },
                ],
            },
        })
    )
}
