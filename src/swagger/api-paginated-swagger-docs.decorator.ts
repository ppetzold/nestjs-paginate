import { applyDecorators, Type } from '@nestjs/common'
import { PaginateConfig } from '../paginate'
import { ApiPaginationQuery } from './api-paginated-query.decorator'
import { ApiOkPaginatedResponse } from './api-ok-paginated-response.decorator'

export function PaginatedSwaggerDocs<DTO extends Type<unknown>>(dto: DTO, paginatedConfig: PaginateConfig<any>) {
    return applyDecorators(ApiOkPaginatedResponse(dto, paginatedConfig), ApiPaginationQuery(paginatedConfig))
}
