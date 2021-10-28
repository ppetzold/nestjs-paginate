import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import { Request } from 'express'
import { pickBy, Dictionary, isString, mapKeys } from 'lodash'

export interface PaginateQuery {
    page?: number
    limit?: number
    sortBy?: [string, string][]
    searchBy?: string[]
    search?: string
    filter?: { [column: string]: string | string[] }
    path: string
}

export const Paginate = createParamDecorator((_data: unknown, ctx: ExecutionContext): PaginateQuery => {
    const request: Request = ctx.switchToHttp().getRequest()
    const { query } = request

    // Determine if Express or Fastify to rebuild the original url and reduce down to protocol, host and base url
    let originalUrl;
    if (request.originalUrl) {
        originalUrl = request.protocol + '://' + request.get('host') + request.originalUrl;
    } else {
        originalUrl = request.protocol + '://' + request.hostname + request.url;
    }
    const urlParts = new URL(originalUrl);
    const path = urlParts.protocol + '//' + urlParts.host + urlParts.pathname;

    const sortBy: [string, string][] = []
    const searchBy: string[] = []

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

    if (query.searchBy) {
        const params = !Array.isArray(query.searchBy) ? [query.searchBy] : query.searchBy
        for (const param of params) {
            if (isString(param)) {
                searchBy.push(param)
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
        searchBy: searchBy.length ? searchBy : undefined,
        filter: Object.keys(filter).length ? filter : undefined,
        path,
    }
})
