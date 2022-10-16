import { applyDecorators, createParamDecorator, ExecutionContext } from '@nestjs/common'
import { ApiQuery } from '@nestjs/swagger'
import { Request } from 'express'
import { pickBy, Dictionary, isString, mapKeys } from 'lodash'
import { getMetadataArgsStorage, EntityTarget } from 'typeorm'
import { RelationMetadataArgs } from 'typeorm/metadata-args/RelationMetadataArgs'

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
    let originalUrl
    if (request.originalUrl) {
        originalUrl = request.protocol + '://' + request.get('host') + request.originalUrl
    } else {
        originalUrl = request.protocol + '://' + request.hostname + request.url
    }
    const urlParts = new URL(originalUrl)
    const path = urlParts.protocol + '//' + urlParts.host + urlParts.pathname

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

/* istanbul ignore next */
function getEntityTree(entity: EntityTarget<any>, tree: Record<string, ''>, parent?: RelationMetadataArgs) {
    const metadataStorage = getMetadataArgsStorage()
    const relations = metadataStorage.relations.filter((x) => x.target === entity)

    metadataStorage.columns
        .filter((x) => x.target === entity)
        .forEach((column) => {
            tree[(parent ? `${parent.propertyName}.` : '') + column.propertyName] = ''
        })

    relations.forEach((relation) => {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        const relationEntity = relation.type()

        if (!parent || parent.target !== relationEntity) {
            getEntityTree(relationEntity, tree, relation)
        }
    })
}

/* istanbul ignore next */
export const PaginateDocs = (entity: EntityTarget<any>) => {
    const tree: { [name: string]: any } = {}

    getEntityTree(entity, tree)

    const filterQueries = Object.keys(tree).map((key) => {
        return ApiQuery({
            name: `filter.${key}`,
            required: false,
            type: 'string',
            description: 'operator($eq, $not, $null, $in, $gt, $gte, $lt, $lte, $btw)',
            example: '$operator:value',
            schema: { default: '' },
        })
    })
    return applyDecorators(
        ApiQuery({
            name: 'page',
            required: false,
            schema: { default: 1, type: 'integer' },
        }),
        ApiQuery({
            name: 'limit',
            required: false,
            schema: { default: 20, type: 'integer' },
        }),
        ApiQuery({
            name: 'sortBy',
            required: false,
            example: 'field:DESC',
            schema: { default: [], type: 'array' },
        }),
        ApiQuery({
            name: 'searchBy',
            required: false,
            example: 'field',
            schema: { examples: ['id'], type: 'array' },
        }),
        ApiQuery({
            name: 'search',
            type: 'string',
            required: false,
        }),
        ...filterQueries
    )
}
