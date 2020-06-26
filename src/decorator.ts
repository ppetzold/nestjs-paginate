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

        function readParamAsArray(param: unknown): string[] {
            const result = typeof param === 'string' ? [param] : param
            if (Array.isArray(result) && result.every((value) => typeof value === 'string')) {
                return result
            }
            return []
        }

        let sortBy: [string, string][] | undefined = undefined
        if (query.sortBy) {
            const params = readParamAsArray(query.sortBy)
            for (const param of params) {
                const items = param.split(':')
                if (items.length === 2) {
                    if (!sortBy) sortBy = []
                    sortBy.push(items as [string, string])
                }
            }
        }

        return {
            page: query.page ? parseInt(query.page.toString(), 10) : undefined,
            limit: query.limit ? parseInt(query.limit.toString(), 10) : undefined,
            sortBy,
            path,
        }
    }
)
