# Nest.js Paginate

[![npm](https://img.shields.io/npm/v/nestjs-paginate.svg)](https://www.npmjs.com/package/nestjs-paginate)
![Main CI](https://github.com/ppetzold/nestjs-paginate/workflows/Main%20CI/badge.svg)
[![codecov](https://codecov.io/gh/ppetzold/nestjs-paginate/branch/master/graph/badge.svg)](https://codecov.io/gh/ppetzold/nestjs-paginate)
[![code style: prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg)](https://github.com/prettier/prettier)
[![semantic-release](https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg)](https://github.com/semantic-release/semantic-release)
![GitHub](https://img.shields.io/github/license/ppetzold/nestjs-paginate)

Pagination and filtering helper method for TypeORM repositories or query builders using [Nest.js](https://nestjs.com/) framework.

- Pagination conforms to [JSON:API](https://jsonapi.org/)
- Sort by multiple columns
- Filter by multiple columns using operators

## Installation

```
npm install nestjs-paginate
```

## Usage

### Example

The following code exposes a route that can be utilized like so:

#### Endpoint

```url
http://localhost:3000/cats?limit=10&page=2&sortBy=createdAt:DESC&sortBy=color:ASC
```

#### Result

```json
{
  "data": [
    {
      "id": 4,
      "name": "George",
      "color": "white"
    },
    {
      "id": 5,
      "name": "Leche",
      "color": "white"
    },
    {
      "id": 2,
      "name": "Garfield",
      "color": "ginger"
    },
    {
      "id": 1,
      "name": "Milo",
      "color": "brown"
    },
    {
      "id": 3,
      "name": "Shadow",
      "color": "black"
    }
  ],
  "meta": {
    "itemsPerPage": 2,
    "totalItems": 5,
    "currentPage": 2,
    "totalPages": 3,
    "sortBy": [["color", "DESC"]]
  },
  "links": {
    "first": "http://localhost:3000/cats?limit=2&page=1&sortBy=color:DESC",
    "previous": "http://localhost:3000/cats?limit=2&page=1&sortBy=color:DESC",
    "next": "http://localhost:3000/cats?limit=2&page=3&sortBy=color:DESC",
    "last": "http://localhost:3000/cats?limit=2&page=3&sortBy=color:DESC"
  }
}
```

#### Code

```ts
import { Controller, Injectable, Get } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository, Entity, PrimaryGeneratedColumn, Column } from 'typeorm'
import { Paginate, PaginateQuery, paginate, Paginated } from 'nestjs-paginate'

@Entity()
export class CatEntity {
  @PrimaryGeneratedColumn()
  id: number

  @Column('text')
  name: string

  @Column('text')
  color: string
}

@Injectable()
export class CatsService {
  constructor(
    @InjectRepository(CatEntity)
    private readonly catsRepository: Repository<CatEntity>
  ) {}

  public findAll(query: PaginateQuery): Promise<Paginated<CatEntity>> {
    return paginate(query, this.catsRepository, {
      sortableColumns: ['name', 'color'],
      defaultOrderby: [['color', 'DESC']],
    })
  }
}

@Controller('cats')
export class CatsController {
  constructor(private readonly catsService: CatsService) {}

  @Get()
  public findAll(@Paginate() query: PaginateQuery): Promise<Paginated<CatEntity>> {
    return this.catsService.findAll(query)
  }
}
```

### Config

```ts
const paginateConfig: PaginateConfig<CatEntity> {
  /**
   * Required: true (must have a minimum of one column)
   * Type: (keyof CatEntity)[]
   * Description: These are the columns that are valid to be sorted by.
   */
  sortableColumns: ['id', 'name', 'color'],

  /**
   * Required: false
   * Type: number
   * Default: 100
   * Description: The maximum amount of entities to return per page.
   */
  maxLimit: 20,

  /**
   * Required: false
   * Type: [keyof CatEntity, 'ASC' | 'DESC'][]
   * Default: [[sortableColumns[0], 'ASC]]
   * Description: The order to display the sorted entities.
   */
  defaultSortBy: [['name', 'DESC']],

  /**
   * Required: false
   * Type: number
   * Default: 20
   */
  defaultLimit: 50,

  /**
   * Required: false
   * Type: TypeORM find options
   * Default: None
   * https://typeorm.io/#/find-optionsfind-options.md
   */
  where: { color: 'ginger' }
}
```
