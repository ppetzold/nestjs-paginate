import { applyDecorators } from '@nestjs/common'
import { ApiQuery } from '@nestjs/swagger'
import { FilterComparator } from '../filter'
import { FilterOperator, FilterSuffix, PaginateConfig, PaginationLimit } from '../paginate'

const DEFAULT_VALUE_KEY = 'Default Value'

function p(key: string | 'Format' | 'Example' | 'Default Value' | 'Max Value', value: string) {
    return `<p>
             <b>${key}: </b> ${value}
          </p>`
}

function li(key: string | 'Available Fields', values: string[]) {
    return `<h4>${key}</h4><ul>${values.map((v) => `<li>${v}</li>`).join('\n')}</ul>`
}

export function SortBy(paginationConfig: PaginateConfig<any>) {
    const defaultSortMessage = paginationConfig.defaultSortBy
        ? paginationConfig.defaultSortBy.map(([col, order]) => (order === 'ASC' ? col : `-${col}`)).join(',')
        : 'No default sorting specified, the result order is not guaranteed'

    const sortBy = paginationConfig.sortableColumns.flatMap((col) => [col, `-${col}`])

    return ApiQuery({
        name: 'sort',
        isArray: true,
        enum: sortBy,
        style: 'form',
        explode: false,
        description: `Comma separated list of field names to sort by. Add a minus to use a field name for a descending sort.
      ${p('Format', 'fieldName OR -fieldName')}
      ${p('Example', 'sort=-id,createdAt')}
      ${p('Default Value', defaultSortMessage)}
      ${li('Available Fields', paginationConfig.sortableColumns)}
      `,
        required: false,
        type: 'string',
    })
}

function PageNumber() {
    return ApiQuery({
        name: 'page[number]',
        description: `Page number to retrieve. If you provide an invalid value the default page number will applied.
        ${p('Example', '1')}
        ${p(DEFAULT_VALUE_KEY, '1')}
        `,
        required: false,
        type: 'number',
    })
}

function PageSize(paginationConfig: PaginateConfig<any>) {
    return ApiQuery({
        name: 'page[size]',
        description: `Number of records per page.
      ${p('Example', '20')}
      ${p(DEFAULT_VALUE_KEY, paginationConfig?.defaultLimit?.toString() || PaginationLimit.DEFAULT_LIMIT.toString())}
      ${p('Max Value', paginationConfig.maxLimit?.toString() || PaginationLimit.DEFAULT_MAX_LIMIT.toString())}

      If the provided value is greater than the maximum value, the maximum value will be applied.
      `,
        required: false,
        type: 'number',
    })
}

function Select(paginationConfig: PaginateConfig<any>) {
    if (!paginationConfig.select) {
        return
    }

    return ApiQuery({
        name: 'select',
        description: `List of fields to select.
      ${p('Example', paginationConfig.select.slice(0, Math.min(5, paginationConfig.select.length)).join(','))}
      ${p(
          DEFAULT_VALUE_KEY,
          'By default all fields returns. If you want to select only some fields, provide them in query param'
      )}
      `,
        required: false,
        type: 'string',
    })
}

function Where(paginationConfig: PaginateConfig<any>) {
    if (!paginationConfig.filterableColumns) return

    const allColumnsDecorators = Object.entries(paginationConfig.filterableColumns)
        .map(([fieldName, filterOperations]) => {
            const queryName = `[${fieldName.replace(/\./, '][')}]`
            const operations =
                filterOperations === true || filterOperations === undefined
                    ? [
                          ...Object.values(FilterComparator),
                          ...Object.values(FilterSuffix),
                          ...Object.values(FilterOperator),
                      ]
                    : filterOperations.map((fo) => fo.toString())

            return ApiQuery({
                name: `filter${queryName}`,
                description: `Filter by ${fieldName} query param.
          ${p('Format', `filter${queryName}={$not}:OPERATION:VALUE`)}
          ${p('Example', `filter${queryName}=$not:$like:John Doe&filter${queryName}=like:John`)}
          ${li('Available Operations', operations)}`,
                required: false,
                type: 'string',
                isArray: true,
            })
        })
        .filter((v) => v !== undefined)

    return applyDecorators(...allColumnsDecorators)
}

function SearchQuery(paginateConfig: PaginateConfig<any>) {
    if (!paginateConfig.searchableColumns) return

    return ApiQuery({
        name: '@search[query]',
        description: `Search term to filter result values across all searchable fields.
        ${p('Example', 'John')}
        ${p(DEFAULT_VALUE_KEY, 'No default value')}
        `,
        required: false,
        type: 'string',
    })
}

function SearchFields(paginateConfig: PaginateConfig<any>) {
    if (!paginateConfig.searchableColumns) return

    return ApiQuery({
        name: '@search[fields]',
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
        enum: paginateConfig.searchableColumns,
        explode: false,
        type: 'string',
    })
}

export const ApiPaginationQuery = (paginationConfig: PaginateConfig<any>) => {
    return applyDecorators(
        ...[
            PageNumber(),
            PageSize(paginationConfig),
            Where(paginationConfig),
            SortBy(paginationConfig),
            SearchQuery(paginationConfig),
            SearchFields(paginationConfig),
            Select(paginationConfig),
        ].filter((v): v is MethodDecorator => v !== undefined)
    )
}
