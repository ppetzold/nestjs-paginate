import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import { Request } from 'express'

export interface PaginateQuery {
    page?: number
    limit?: number
    sortBy?: [string, string][]
    path: string
}

export const Paginate = createParamDecorator(
    (_data: unknown, ctx: ExecutionContext): PaginateQuery => {
        const request: Request = ctx.switchToHttp().getRequest()
        const { query } = request
        const path = request.protocol + '://' + request.get('host') + request.baseUrl + request.path

        let sortBy: [string, string][] = []
        if (query.sortBy) {
            const params = !Array.isArray(query.sortBy) ? [query.sortBy] : query.sortBy
            if (params.some((param) => typeof param === 'string')) {
                for (const param of params as string[]) {
                    const items = param.split(':')
                    if (items.length === 2) {
                        sortBy.push([items[0], items[1]])
                    }
                }
            }
        }

        return {
            page: query.page ? parseInt(query.page.toString(), 10) : undefined,
            limit: query.limit ? parseInt(query.limit.toString(), 10) : undefined,
            sortBy: sortBy.length > 0 ? sortBy : undefined,
            path,
        }
    }
)
