import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import type { Request as ExpressRequest } from 'express'
import type { FastifyRequest } from 'fastify'
import { pickBy, isString, mapValues, pick } from 'lodash'

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

const parseInteger = (param: unknown): number | null | undefined =>
    param === undefined || param === null ? (param as null | undefined) : parseInt(param as string, 10)
const parseString = (param: unknown): string | null | undefined =>
    param === undefined || param === null ? (param as null | undefined) : String(param)
const parseOneOrManyString = (param: unknown): string[] | string | null | undefined =>
    Array.isArray(param) ? param.map(parseString) : parseString(param)
const parseSort = (params: string[]) => {
    return params.map((param): [string, 'ASC' | 'DESC'] =>
        param.startsWith('-') ? [param.slice(1), 'DESC'] : [param, 'ASC']
    )
}

function parseFamilyParam(family: unknown, key: string): string | null | undefined
function parseFamilyParam<T>(family: unknown, key: string, parser: (value: string) => T): T | null | undefined
function parseFamilyParam<T>(
    family: unknown,
    key: string,
    parser: (value: string) => T = parseString as (value: string) => T
): T | undefined {
    if (!(typeof family === 'object')) {
        return undefined
    } else {
        return parser(family[key])
    }
}

function parseFamilyParams<K extends { [key: string]: any }>(
    family: K,
    members: (keyof K)[] | { [key in keyof K]: (value: unknown) => K[key] }
): K | undefined {
    if (!(typeof family === 'object')) {
        return undefined
    } else if (Array.isArray(members)) {
        return mapValues(pick(family, members), parseString) as K
    } else {
        return mapValues(pick(family, Object.keys(members)), (value, key) => members[key](value)) as K
    }
}

function parseFamily(family: unknown): Record<string, string | null | undefined> | undefined
function parseFamily<T>(family: unknown, parser: (value: string) => T): Record<string, T> | undefined
function parseFamily<T>(
    family: unknown,
    parser: (value: string) => T = parseString as (value: string) => T
): Record<string, T> | undefined {
    if (!(typeof family === 'object')) {
        return undefined
    } else {
        return mapValues(
            pickBy(family, (value, key) => !key.startsWith('@')),
            parser
        ) as Record<string, T>
    }
}

function parseListParam(queryParam: unknown): string[] | undefined
function parseListParam<T>(queryParam: unknown, parserLogic: (param: string[]) => T[]): T[] | undefined
function parseListParam<T>(queryParam: unknown, parserLogic?: (param: string[]) => T[]): T[] | undefined {
    if (isString(queryParam)) {
        const params = queryParam.split(',')
        return parserLogic ? parserLogic(params) : (params as T[])
    } else {
        return undefined
    }
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

    // Parse both `@search=something` and `@search[query]=something&@search[fields]=field1,field2`
    // to {query: string, fields: string[]}
    const searchQuery = parseString(query['@search'])
    const search =
        typeof query['@search'] === 'object'
            ? parseFamilyParams<{ query?: string; fields?: string[] }>(query['@search'], {
                  query: parseString,
                  fields: parseListParam,
              })
            : searchQuery
            ? { query: searchQuery }
            : (searchQuery as null | undefined)

    // Assemble the PaginateQuery
    return {
        page: parseFamilyParam(query.page, 'number', parseInteger),
        limit: parseFamilyParam(query.page, 'size', parseInteger),
        sortBy: parseListParam<[string, 'ASC' | 'DESC']>(query.sort, parseSort),
        search: search?.query,
        searchBy: search?.fields,
        filter: parseFamily(query.filter, parseOneOrManyString),
        select: parseListParam(query.select),
        path,
    }
})
