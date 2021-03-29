import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import { Request } from 'express'

export interface PaginateQuery {
    page?: number
    limit?: number
    sort?: [string, string][]
    search?: string
    path: string
}

export const Paginate = createParamDecorator(
    (_data: unknown, ctx: ExecutionContext): PaginateQuery => {
        const request: Request = ctx.switchToHttp().getRequest()
        const { query } = request
        const path = request.protocol + '://' + request.get('host') + request.baseUrl + request.path

        const sort: [string, string][] = []
        if (query.sort) {
            const params = !Array.isArray(query.sort) ? [query.sort] : query.sort
            for (const param of params as string[]) {
                if (typeof param === 'string') {
                    const items = param.split(':')
                    if (items.length === 2) {
                        sort.push(items as [string, string])
                    }
                }
            }
        }

        return {
            page: query.page ? parseInt(query.page.toString(), 10) : undefined,
            limit: query.limit ? parseInt(query.limit.toString(), 10) : undefined,
            sort: sort.length ? sort : undefined,
            search: query.search ? query.search.toString() : undefined,
            path,
        }
    }
)
