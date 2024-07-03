import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import type { Request as ExpressRequest } from 'express'
import type { FastifyRequest } from 'fastify'
import { pickBy, Dictionary, isString, mapKeys } from 'lodash'

function isRecord(data: unknown): data is Record<string, unknown> {
    return data !== null && typeof data === 'object' && !Array.isArray(data)
}

function isExpressRequest(request: unknown): request is ExpressRequest {
    return isRecord(request) && typeof request.get === 'function'
}

export interface PaginateQuery {
    page?: number
    limit?: number
    sortBy?: [string, string][]
    searchBy?: string[]
    search?: string
    filter?: { [column: string]: string | string[] }
    select?: string[]
    path: string
}

const singleSplit = (param: string, res: any[]) => res.push(param)

const multipleSplit = (param: string, res: any[]) => {
    const items = param.split(':')
    if (items.length === 2) {
        res.push(items as [string, string])
    }
}

const multipleAndCommaSplit = (param: string, res: any[]) => {
    const set = new Set<string>(param.split(','))
    set.forEach((item) => res.push(item))
}

function parseParam<T>(queryParam: unknown, parserLogic: (param: string, res: any[]) => void): T[] | undefined {
    const res = []
    if (queryParam) {
        const params = !Array.isArray(queryParam) ? [queryParam] : queryParam
        for (const param of params) {
            if (isString(param)) {
                parserLogic(param, res)
            }
        }
    }
    return res.length ? res : undefined
}

export const Paginate = createParamDecorator((_data: unknown, ctx: ExecutionContext): PaginateQuery => {
    const request: ExpressRequest | FastifyRequest = ctx.switchToHttp().getRequest()
    const query = request.query as Record<string, unknown>

    // Determine if Express or Fastify to rebuild the original url and reduce down to protocol, host and base url
    let originalUrl: string
    if (isExpressRequest(request)) {
        originalUrl = request.protocol + '://' + request.get('host') + request.originalUrl
    } else {
        originalUrl = request.protocol + '://' + request.hostname + request.url
    }
    const urlParts = new URL(originalUrl)
    const path = urlParts.protocol + '//' + urlParts.host + urlParts.pathname

    const searchBy = parseParam<string>(query.searchBy, singleSplit)
    const sortBy = parseParam<[string, string]>(query.sortBy, multipleSplit)
    const select = parseParam<string>(query.select, multipleAndCommaSplit)

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
        sortBy,
        search: query.search ? query.search.toString() : undefined,
        searchBy,
        filter: Object.keys(filter).length ? filter : undefined,
        select,
        path,
    }
})
