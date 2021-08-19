import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import { Request } from 'express'
import { pickBy, Dictionary, isString, mapKeys } from 'lodash'

export interface PaginateQuery {
    page?: number
    limit?: number
    sortBy?: [string, string][]
    search?: string
    filter?: { [column: string]: string | string[] }
    path: string
}

export const Paginate = createParamDecorator((_data: unknown, ctx: ExecutionContext): PaginateQuery => {
    const request: Request = ctx.switchToHttp().getRequest()
    const { query } = request
    const path = request.protocol + '://' + request.get('host') + request.baseUrl + request.path

    const sortBy: [string, string][] = []
    if (query.sortBy) {
        const params = !Array.isArray(query.sortBy) ? [query.sortBy] : query.sortBy
        for (const param of params) {
            if (isString(param)) {
                const items = param.split(':')
                if (items.length === 2) {
                    sortBy.push(items as [string, string])
                }
            }
        }
    }

    const filter = mapKeys(
        pickBy(
            query,
            (param, name) =>
                name.includes('filter.') &&
                (isString(param) || (Array.isArray(param) && (param as any[]).every((p) => isString(p))))
        ) as Dictionary<string | string[]>,
        (_param, name) => name.replace('filter.', '')
    )

    return {
        page: query.page ? parseInt(query.page.toString(), 10) : undefined,
        limit: query.limit ? parseInt(query.limit.toString(), 10) : undefined,
        sortBy: sortBy.length ? sortBy : undefined,
        search: query.search ? query.search.toString() : undefined,
        filter: Object.keys(filter).length ? filter : undefined,
        path,
    }
})
