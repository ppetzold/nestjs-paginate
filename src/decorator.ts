import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import type { Request as ExpressRequest } from 'express'
import type { FastifyRequest } from 'fastify'
import { Dictionary, isString, mapKeys, pickBy } from 'lodash'
import { isNil } from './helper'

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
    cursor?: string
    withDeleted?: boolean
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

function parseIntParam(v: unknown): number | undefined {
    if (isNil(v)) {
        return undefined
    }

    const result = Number.parseInt(v.toString(), 10)

    if (Number.isNaN(result)) {
        return undefined
    }
    return result
}

export const Paginate = createParamDecorator((_data: unknown, ctx: ExecutionContext): PaginateQuery => {
    let path: string
    let query: Record<string, unknown>

    switch (ctx.getType()) {
        case 'http':
            const request: ExpressRequest | FastifyRequest = ctx.switchToHttp().getRequest()
            query = request.query as Record<string, unknown>

            // Determine if Express or Fastify to rebuild the original url and reduce down to protocol, host and base url
            let originalUrl: string
            if (isExpressRequest(request)) {
                originalUrl = request.protocol + '://' + request.get('host') + request.originalUrl
            } else {
                originalUrl = request.protocol + '://' + request.hostname + request.url
            }

            const urlParts = new URL(originalUrl)
            path = urlParts.protocol + '//' + urlParts.host + urlParts.pathname
            break
        case 'ws':
            query = ctx.switchToWs().getData()
            path = null
            break
        case 'rpc':
            query = ctx.switchToRpc().getData()
            path = null
            break
    }

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
        page: parseIntParam(query.page),
        limit: parseIntParam(query.limit),
        sortBy,
        search: query.search ? query.search.toString() : undefined,
        searchBy,
        filter: Object.keys(filter).length ? filter : undefined,
        select,
        cursor: query.cursor ? query.cursor.toString() : undefined,
        withDeleted: query.withDeleted === 'true' ? true : query.withDeleted === 'false' ? false : undefined,
        path,
    }
})
