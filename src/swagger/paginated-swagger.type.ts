import { ApiProperty } from '@nestjs/swagger'
import { Column, SortBy } from '../helper'
import { Paginated } from '../paginate'

class PaginatedLinksDocumented {
    @ApiProperty({
        title: 'Link to first page',
        required: false,
        type: 'string',
    })
    first?: string

    @ApiProperty({
        title: 'Link to previous page',
        required: false,
        type: 'string',
    })
    previous?: string

    @ApiProperty({
        title: 'Link to current page',
        required: false,
        type: 'string',
    })
    current!: string

    @ApiProperty({
        title: 'Link to next page',
        required: false,
        type: 'string',
    })
    next?: string

    @ApiProperty({
        title: 'Link to last page',
        required: false,
        type: 'string',
    })
    last?: string
}

export class PaginatedMetaDocumented<T> {
    @ApiProperty({
        title: 'Number of items per page',
        required: true,
        type: 'number',
    })
    itemsPerPage!: number

    @ApiProperty({
        title: 'Total number of items',
        required: true,
        type: 'number',
    })
    totalItems!: number

    @ApiProperty({
        title: 'Current requested page',
        required: true,
        type: 'number',
    })
    currentPage!: number

    @ApiProperty({
        title: 'Total number of pages',
        required: true,
        type: 'number',
    })
    totalPages!: number

    @ApiProperty({
        title: 'Sorting by columns',
        required: false,
        type: 'array',
        items: {
            type: 'array',
            items: {
                oneOf: [
                    {
                        type: 'string',
                    },
                    {
                        type: 'string',
                        enum: ['ASC', 'DESC'],
                    },
                ],
            },
        },
    })
    sortBy!: SortBy<T>

    @ApiProperty({
        title: 'Search by fields',
        required: false,
        isArray: true,
        type: 'string',
    })
    searchBy!: Column<T>[]

    @ApiProperty({
        title: 'Search term',
        required: false,
        type: 'string',
    })
    search!: string

    @ApiProperty({
        title: 'List of selected fields',
        required: false,
        isArray: true,
        type: 'string',
    })
    select!: string[]

    @ApiProperty({
        title: 'Filters that applied to the query',
        required: false,
        isArray: false,
        type: 'object',
    })
    filter?: {
        [p: string]: string | string[]
    }
}

export class PaginatedDocumented<T> extends Paginated<T> {
    @ApiProperty({
        isArray: true,
        required: true,
        title: 'Array of entities',
        type: 'object'
    })
    override data!: T[]

    @ApiProperty({
        title: 'Pagination Metadata',
        required: true,
    })
    override meta!: PaginatedMetaDocumented<T>

    @ApiProperty({
        title: 'Links to pages',
        required: true,
    })
    override links!: PaginatedLinksDocumented
}
