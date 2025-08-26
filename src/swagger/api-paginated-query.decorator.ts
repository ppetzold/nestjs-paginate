import { applyDecorators } from '@nestjs/common'
import { ApiQuery } from '@nestjs/swagger'
import { FilterComparator } from '../filter'
import { FilterOperator, FilterSuffix, PaginateConfig } from '../paginate'
import globalConfig from '../global-config'
import { isNil } from '../helper'

const DEFAULT_VALUE_KEY = 'Default Value'

const allFilterSuffixes = Object.values(FilterSuffix).map((v) => v.toString())

function p(key: string | 'Format' | 'Example' | 'Default Value' | 'Max Value', value: string) {
    return `
**${key}:** ${value}
`
}

function li(key: string | 'Available Fields', values: string[]) {
    return `**${key}**
${values.map((v) => `- ${v}`).join('\n\n')}`
}

export function SortBy(paginationConfig: PaginateConfig<any>) {
    const sortableColumnNotAvailable =
        isNil(paginationConfig.sortableColumns) || paginationConfig.sortableColumns.length === 0

    if (isNil(paginationConfig.defaultSortBy) && sortableColumnNotAvailable) {
        // no sorting allowed or predefined
        return undefined
    }

    const defaultSortMessage = paginationConfig.defaultSortBy
        ? paginationConfig.defaultSortBy.map(([col, order]) => `${col}:${order}`).join(',')
        : 'No default sorting specified, the result order is not guaranteed if not provided'

    const sortBy = paginationConfig.sortableColumns.reduce((prev, curr) => {
        return [...prev, `${curr}:ASC`, `${curr}:DESC`]
    }, [])

    const exampleValue = sortableColumnNotAvailable
        ? 'Allowed sortable columns are not provided, only default sorting will be used'
        : paginationConfig.sortableColumns
              .slice(0, 2)
              .map((col) => `sortBy=${col}:DESC`)
              .join('&')

    return ApiQuery({
        name: 'sortBy',
        isArray: true,
        enum: sortBy,
        description: `Parameter to sort by.
To sort by multiple fields, just provide query param multiple types. The order in url defines an order of sorting
${p('Format', '{fieldName}:{DIRECTION}')}
${p('Example', exampleValue)}
${p('Default Value', defaultSortMessage)}
${li('Available Fields', paginationConfig.sortableColumns)}
`,
        required: false,
        type: 'string',
    })
}

export function Limit(paginationConfig: PaginateConfig<any>) {
    return ApiQuery({
        name: 'limit',
        description: `Number of records per page.

${p('Example', globalConfig.defaultLimit.toString())}

${p(DEFAULT_VALUE_KEY, paginationConfig?.defaultLimit?.toString() || globalConfig.defaultLimit.toString())}

${p('Max Value', paginationConfig.maxLimit?.toString() || globalConfig.defaultMaxLimit.toString())}

If provided value is greater than max value, max value will be applied.
`,
        required: false,
        type: 'number',
    })
}

export function Select(paginationConfig: PaginateConfig<any>) {
    if (!paginationConfig.select) {
        return
    }

    return ApiQuery({
        name: 'select',
        description: `List of fields to select.
${p('Example', paginationConfig.select.slice(0, 5).join(','))}
${p(
    DEFAULT_VALUE_KEY,
    'By default all fields returns. If you want to select only some fields, provide them in query param'
)}
`,
        required: false,
        type: 'string',
    })
}

export function Where(paginationConfig: PaginateConfig<any>) {
    if (!paginationConfig.filterableColumns) return

    const allColumnsDecorators = Object.entries(paginationConfig.filterableColumns)
        .map(([fieldName, filterOperations]) => {
            const operations =
                filterOperations === true || filterOperations === undefined
                    ? [...Object.values(FilterOperator), ...Object.values(FilterSuffix)]
                    : filterOperations.map((fo) => fo.toString())

            const operationsForExample =
                operations
                    .filter((v) => !allFilterSuffixes.includes(v))
                    .sort()
                    .slice(0, 2) || []

            return ApiQuery({
                name: `filter.${fieldName}`,
                description: `Filter by ${fieldName} query param.
${p('Format', `filter.${fieldName}={$not}:OPERATION:VALUE`)}

${p(
    'Example',
    operationsForExample.length === 0
        ? 'No filtering allowed'
        : operationsForExample.map((v) => `filter.${fieldName}=${v}:John Doe`).join('&')
)}
${li('Available Operations', [...operations, ...Object.values(FilterComparator)])}`,
                required: false,
                type: 'string',
                isArray: true,
            })
        })
        .filter((v) => v !== undefined)

    return applyDecorators(...allColumnsDecorators)
}

export function Page() {
    return ApiQuery({
        name: 'page',
        description: `Page number to retrieve. If you provide invalid value the default page number will applied
${p('Example', '1')}
${p(DEFAULT_VALUE_KEY, '1')}
`,
        required: false,
        type: 'number',
    })
}

export function Search(paginateConfig: PaginateConfig<any>) {
    if (!paginateConfig.searchableColumns) return

    return ApiQuery({
        name: 'search',
        description: `Search term to filter result values
${p('Example', 'John')}
${p(DEFAULT_VALUE_KEY, 'No default value')}
`,
        required: false,
        type: 'string',
    })
}

export function SearchBy(paginateConfig: PaginateConfig<any>) {
    if (!paginateConfig.searchableColumns) return

    return ApiQuery({
        name: 'searchBy',
        description: `List of fields to search by term to filter result values
${p(
    'Example',
    paginateConfig.searchableColumns.slice(0, Math.min(5, paginateConfig.searchableColumns.length)).join(',')
)}
${p(DEFAULT_VALUE_KEY, 'By default all fields mentioned below will be used to search by term')}
${li('Available Fields', paginateConfig.searchableColumns)}
`,
        required: false,
        isArray: true,
        type: 'string',
    })
}

export function WithDeleted(paginateConfig: PaginateConfig<any>) {
    if (!paginateConfig.allowWithDeletedInQuery) return

    return ApiQuery({
        name: 'withDeleted',
        description: `Retrieve records including soft deleted ones`,
        required: false,
        type: 'boolean',
    })
}

export const ApiPaginationQuery = (paginationConfig: PaginateConfig<any>) => {
    return applyDecorators(
        ...[
            Page(),
            Limit(paginationConfig),
            Where(paginationConfig),
            SortBy(paginationConfig),
            Search(paginationConfig),
            SearchBy(paginationConfig),
            Select(paginationConfig),
            WithDeleted(paginationConfig),
        ].filter((v): v is MethodDecorator => v !== undefined)
    )
}
