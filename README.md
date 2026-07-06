# Nest.js Paginate

![Main CI](https://github.com/ppetzold/nestjs-paginate/workflows/Main%20CI/badge.svg)
[![npm](https://img.shields.io/npm/v/nestjs-paginate.svg)](https://www.npmjs.com/package/nestjs-paginate)
[![downloads](https://img.shields.io/npm/dt/nestjs-paginate.svg)](https://www.npmjs.com/package/nestjs-paginate)
[![codecov](https://codecov.io/gh/ppetzold/nestjs-paginate/branch/master/graph/badge.svg)](https://codecov.io/gh/ppetzold/nestjs-paginate)
[![code style: prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg)](https://github.com/prettier/prettier)
[![semantic-release](https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg)](https://github.com/semantic-release/semantic-release)
![GitHub](https://img.shields.io/github/license/ppetzold/nestjs-paginate)

Pagination and filtering helper method for TypeORM repositories or query builders using [Nest.js](https://nestjs.com/) framework.

- Pagination conforms to [JSON:API](https://jsonapi.org/)
- Sort by multiple columns
- Search across columns
- Select columns
- Filter using operators (`$eq`, `$not`, `$null`, `$in`, `$gt`, `$gte`, `$lt`, `$lte`, `$btw`, `$ilike`, `$sw`, `$contains`)
- Include relations and nested relations
- Virtual column support
- Cursor-based pagination

## Installation

```
npm install nestjs-paginate
```

## Usage

### Global configurations

You can configure the global settings for all paginated routes by updating the default global configuration
using below method. Ideally, you need to do it as soon as possible in your application main bootstrap method,
as it affects all paginated routes, and swagger generation logic.

```typescript
import { updateGlobalConfig } from 'nestjs-paginate'

updateGlobalConfig({
  // this is default configuration
  defaultOrigin: undefined,
  defaultLimit: 20,
  defaultMaxLimit: 100,
})
```

### Example

The following code exposes a route that can be utilized like so:

#### Endpoint

```url
http://localhost:3000/cats?limit=5&page=2&sortBy=color:DESC&search=i&filter.age=$gte:3&select=id,name,color,age&withDeleted=true
```

#### Result

```json
{
  "data": [
    {
      "id": 4,
      "name": "George",
      "color": "white",
      "age": 3
    },
    {
      "id": 5,
      "name": "Leche",
      "color": "white",
      "age": 6
    },
    {
      "id": 2,
      "name": "Garfield",
      "color": "ginger",
      "age": 4
    },
    {
      "id": 1,
      "name": "Milo",
      "color": "brown",
      "age": 5
    },
    {
      "id": 3,
      "name": "Kitty",
      "color": "black",
      "age": 3
    }
  ],
  "meta": {
    "itemsPerPage": 5,
    "totalItems": 12,
    "currentPage": 2,
    "totalPages": 3,
    "sortBy": [["color", "DESC"]],
    "search": "i",
    "filter": {
      "age": "$gte:3"
    }
  },
  "links": {
    "first": "http://localhost:3000/cats?limit=5&page=1&sortBy=color:DESC&search=i&filter.age=$gte:3",
    "previous": "http://localhost:3000/cats?limit=5&page=1&sortBy=color:DESC&search=i&filter.age=$gte:3",
    "current": "http://localhost:3000/cats?limit=5&page=2&sortBy=color:DESC&search=i&filter.age=$gte:3",
    "next": "http://localhost:3000/cats?limit=5&page=3&sortBy=color:DESC&search=i&filter.age=$gte:3",
    "last": "http://localhost:3000/cats?limit=5&page=3&sortBy=color:DESC&search=i&filter.age=$gte:3"
  }
}
```

### Example (Cursor-based Pagination)

The following code exposes a route using cursor-based pagination:

#### Endpoint

```url
http://localhost:3000/cats?limit=5&sortBy=lastVetVisit:ASC&cursor=V998328469600000
```

#### Result

```json
{
  "data": [
    {
      "id": 3,
      "name": "Shadow",
      "lastVetVisit": "2022-12-21T10:00:00.000Z"
    },
    {
      "id": 4,
      "name": "Luna",
      "lastVetVisit": "2022-12-22T10:00:00.000Z"
    },
    {
      "id": 5,
      "name": "Pepper",
      "lastVetVisit": "2022-12-23T10:00:00.000Z"
    },
    {
      "id": 6,
      "name": "Simba",
      "lastVetVisit": "2022-12-24T10:00:00.000Z"
    },
    {
      "id": 7,
      "name": "Tiger",
      "lastVetVisit": "2022-12-25T10:00:00.000Z"
    }
  ],
  "meta": {
    "itemsPerPage": 5,
    "cursor": "V998328469600000"
  },
  "links": {
    "previous": "http://localhost:3000/cats?limit=5&sortBy=lastVetVisit:DESC&cursor=V001671616800000",
    "current": "http://localhost:3000/cats?limit=5&sortBy=lastVetVisit:ASC&cursor=V998328469600000",
    "next": "http://localhost:3000/cats?limit=5&sortBy=lastVetVisit:ASC&cursor=V998328037600000"
  }
}
```

#### Code

```ts
import { Controller, Injectable, Get } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { FilterOperator, FilterSuffix, Paginate, PaginateQuery, paginate, Paginated } from 'nestjs-paginate'
import { Repository, Entity, PrimaryGeneratedColumn, Column } from 'typeorm'

@Entity()
export class CatEntity {
  @PrimaryGeneratedColumn()
  id: number

  @Column('text')
  name: string

  @Column('text')
  color: string

  @Column('int')
  age: number

  @Column({ nullable: true })
  lastVetVisit: Date | null

  @CreateDateColumn()
  createdAt: string
}

@Injectable()
export class CatsService {
  constructor(
    @InjectRepository(CatEntity)
    private readonly catsRepository: Repository<CatEntity>
  ) {}

  public findAll(query: PaginateQuery): Promise<Paginated<CatEntity>> {
    return paginate(query, this.catsRepository, {
      sortableColumns: ['id', 'name', 'color', 'age'],
      nullSort: 'last',
      defaultSortBy: [['id', 'DESC']],
      searchableColumns: ['name', 'color', 'age'],
      select: ['id', 'name', 'color', 'age', 'lastVetVisit'],
      filterableColumns: {
        name: [FilterOperator.EQ, FilterSuffix.NOT],
        age: true,
      },
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

````ts
const paginateConfig: PaginateConfig<CatEntity> {
  /**
   * Required: true (must have a minimum of one column)
   * Type: (keyof CatEntity)[]
   * Description: These are the columns that are valid to be sorted by.
   */
  sortableColumns: ['id', 'name', 'color'],

  /**
   * Required: false
   * Type: 'first' | 'last'
   * Description: Define whether to put null values at the beginning
   * or end of the result set.
   */
  nullSort: 'last',

  /**
   * Required: false
   * Type: [keyof CatEntity, 'ASC' | 'DESC'][]
   * Default: [[sortableColumns[0], 'ASC]]
   * Description: The order to display the sorted entities.
   */
  defaultSortBy: [['name', 'DESC']],

  /**
   * Required: false
   * Type: (keyof CatEntity)[]
   * Description: These columns will be searched through when using the search query
   * param. Limit search scope further by using `searchBy` query param.
   */
  searchableColumns: ['name', 'color'],

  /**
   * Required: false
   * Type: (keyof CatEntity)[]
   * Default: None
   * Description: TypeORM partial selection. Limit selection further by using `select` query param.
   * https://typeorm.io/select-query-builder#partial-selection
   * Note: if you do not contain the primary key in the select array, primary key will be added automatically.
   *
   * Wildcard support:
   * - Use '*' to select all columns from the main entity.
   * - Use 'relation.*' to select all columns from a relation.
   * - Use 'relation.subrelation.*' to select all columns from nested relations.
   *
   * Examples:
   * select: ['*'] - Selects all columns from main entity
   * select: ['id', 'name', 'toys.*'] - Selects id, name from main entity and all columns from toys relation
   * select: ['*', 'toys.*'] - Selects all columns from both main entity and toys relation
   */
  select: ['id', 'name', 'color'],

  /**
   * Required: false
   * Type: number
   * Default: 100
   * Description: The maximum amount of entities to return per page.
   * Set it to -1, in conjunction with limit=-1 on query param, to disable pagination.
   */
  maxLimit: 20,

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
  where: { color: 'ginger' },

  /**
   * Required: false
   * Type: { [key in CatEntity]?: FilterOperator[] } - Operators based on TypeORM find operators
   * Default: None
   * https://typeorm.io/#/find-options/advanced-options
   */
  filterableColumns: { age: [FilterOperator.EQ, FilterOperator.IN] },

  /**
   * Required: false
   * Type: number
   * Default: None
   * Description: Bulk-allow any filtered column (including relation, embedded and
   * nested paths) whose dot-path depth is at most this value, without listing each
   * one in `filterableColumns`. Depth is the number of dot-separated segments, so
   * `allowDepth: 5` permits `a.b.c.d.e` but rejects `a.b.c.d.e.f`. Only columns the
   * request actually references are considered. An explicit `filterableColumns` entry
   * always wins, so its per-column operator restrictions still apply within the depth.
   */
  allowDepth: 5,

  /**
   * Required: false
   * Type: boolean
   * Default: false
   * Description: Throw a 400 error when a request uses an unknown filter column
   * or a non-whitelisted filter operator/suffix. When disabled, invalid filters
   * are silently ignored.
   */
  throwOnInvalidFilter: false,

  /**
   * Required: false
   * Type: RelationColumn<CatEntity>
   * Description: Indicates what relations of entity should be loaded.
   */
  relations: {},

  /**
   * Required: false
   * Type: boolean
   * Default: false
   * Description: Load eager relations using TypeORM's eager property.
   * Only works if `relations` is not defined.
   */
  loadEagerRelations: true,

  /**
   * Required: false
   * Type: boolean
   * Description: Disables the global condition of "non-deleted" for the entity with delete date columns.
   * https://typeorm.io/select-query-builder#querying-deleted-rows
   */
  withDeleted: false,

  /**
   * Required: false
   * Type: boolean
   * Description: Allows to specify withDeleted in query params to retrieve soft deleted records, convinient when you have archive functionality and some toggle to show or hide them. If not enabled explicitly the withDeleted query param will be ignored.
   */
  allowWithDeletedInQuery: false,

  /**
   * Required: false
   * Type: string
   * Description: Allow user to choose between limit/offset and take/skip, or cursor-based pagination.
   * Default: PaginationType.TAKE_AND_SKIP
   * Options: PaginationType.LIMIT_AND_OFFSET, PaginationType.TAKE_AND_SKIP, PaginationType.CURSOR
   *
   * However, using limit/offset can cause problems with relations.
   */
  paginationType: PaginationType.LIMIT_AND_OFFSET,

  /**
   * Required: false
   * Type: boolean
   * Default: false
   * Description: Generate relative paths in the resource links.
   */
  relativePath: true,

  /**
   * Required: false
   * Type: string
   * Description: Overrides the origin of absolute resource links if set.
   */
  origin: 'http://cats.example',

  /**
   * Required: false
   * Type: boolean
   * Default: false
   * Description: Prevent `searchBy` query param from limiting search scope further. Search will depend upon `searchableColumns` config option only
   */
  ignoreSearchByInQueryParam: true,

  /**
   * Required: false
   * Type: boolean
   * Default: false
   * Description: Prevent `select` query param from limiting selection further. Partial selection will depend upon `select` config option only
   */
  ignoreSelectInQueryParam: true,

  /**
   * Required: false
   * Type: 'leftJoinAndSelect' | 'innerJoinAndSelect'
   * Default: 'leftJoinAndSelect'
   * Description: Relationships will be joined with either LEFT JOIN or INNER JOIN, and their columns selected. Can be specified per column with `joinMethods` configuration.
   */
  defaultJoinMethod: 'leftJoinAndSelect',

  /**
   * Required: false
   * Type: MappedColumns<T, JoinMethod>
   * Default: false
   * Description: Overrides the join method per relationship.
   */
  joinMethods: {age: 'innerJoinAndSelect', size: 'leftJoinAndSelect'},

  /**
   * Required: false
   * Type: boolean
   * Default: false
   * Description: Enable multi-word search behavior. When true, each word in the search query
   * will be treated as a separate search term, allowing for more flexible matching.
   */
  multiWordSearch: false,

  /**
   * Required: false
   * Type: (qb: SelectQueryBuilder<T>) => SelectQueryBuilder<any>
   * Default: undefined
   * Description: Callback that lets you override the COUNT query executed by
   * paginate(). The function receives a **clone** of the original QueryBuilder,
   * so it already contains every WHERE clause and parameter parsed by
   * nestjs-paginate.
   *
   * Typical use-case: remove expensive LEFT JOINs or build a lighter DISTINCT
   * count when getManyAndCount() becomes a bottleneck.
   *
   * Example:
   * ```ts
   * buildCountQuery: qb => {
   *   qb.expressionMap.joinAttributes = [];   // drop all joins
   *   qb.select('p.id').distinct(true);       // keep DISTINCT on primary key
   *   return qb;                              // paginate() will call .getCount()
   * }
   * ```
   */
  buildCountQuery: (qb: SelectQueryBuilder<T>) => SelectQueryBuilder<any>,

  /**
   * Required: false
   * Type: boolean
   * Default: false
   * Description: Build the COUNT query from a pruned clone of the main query
   * instead of counting over the fully-joined statement. LEFT JOINs that the
   * WHERE clause does not reference are removed before counting (INNER JOINs
   * and the parent chains of referenced joins are kept), so configs that join
   * many relations purely for hydration no longer pay for them in the count.
   *
   * The page data query is unaffected. Ignored when buildCountQuery is set;
   * the pruning helper is exported as `buildOptimizedCountQuery` so it can be
   * composed inside a custom buildCountQuery as well.
   */
  optimizedCount: true,
}
````

## Usage with Query Builder

You can paginate custom queries by passing on the query builder:

### Example

```typescript
const queryBuilder = repo
  .createQueryBuilder('cats')
  .leftJoinAndSelect('cats.owner', 'owner')
  .where('cats.owner = :ownerId', { ownerId })

const result = await paginate<CatEntity>(query, queryBuilder, config)
```

## Usage with Relations

Similar as with repositories, you can utilize `relations` as a simplified left-join form:

### Example

#### Endpoint

```url
http://localhost:3000/cats?filter.toys.name=$in:Mouse,String
```

#### Code

```typescript
const config: PaginateConfig<CatEntity> = {
  relations: { toys: true },
  sortableColumns: ['id', 'name', 'toys.name'],
  filterableColumns: {
    'toys.name': [FilterOperator.IN],
  },
}

const result = await paginate<CatEntity>(query, catRepo, config)
```

**Note:** Embedded columns on relations have to be wrapped with brackets:

```typescript
const config: PaginateConfig<CatEntity> = {
  sortableColumns: ['id', 'name', 'toys.(size.height)', 'toys.(size.width)'],
  searchableColumns: ['name'],
  relations: { toys: true },
}
```

## Usage with Nested Relations

Similar as with relations, you can specify nested relations for sorting, filtering and searching:

### Example

#### Endpoint

```url
http://localhost:3000/cats?filter.home.pillows.color=pink
```

#### Code

```typescript
const config: PaginateConfig<CatEntity> = {
  relations: { home: { pillows: true } },
  sortableColumns: ['id', 'name', 'home.pillows.color'],
  searchableColumns: ['name', 'home.pillows.color'],
  filterableColumns: {
    'home.pillows.color': [FilterOperator.EQ],
  },
}

const result = await paginate<CatEntity>(query, catRepo, config)
```

## Usage with to-many relationships

You can filter parents by conditions on their to-many relations (one-to-many or many-to-many) using quantifiers.
Quantifiers define how many related rows must satisfy the condition:

- `$any` (default): at least one related row matches the condition
- `$all`: all related rows match the condition
- `$none`: no related rows match the condition

### Examples

Assume `CatEntity` has a one‑to‑many relation `toys: CatToyEntity[]` where `CatToyEntity` has a string column `name`.

- At least one toy named exactly "Ball":

  ```url
  GET /cats?filter.toys.name=$any:$eq:Ball
  ```

- At least one toy whose name contains "red" (case-insensitive):

  ```url
  GET /cats?filter.toys.name=$any:$ilike:red
  ```

- All toys must have names that start with "Chew":

  ```url
  GET /cats?filter.toys.name=$all:$sw:Chew
  ```

- No toys named "Squeaky", including cats without any toys:

  ```url
  GET /cats?filter.toys.name=$none:$eq:Squeaky
  ```

- One or more toys not named "Squeaky":

  ```url
  GET /cats?filter.toys.name=$any:$not:$eq:Squeaky
  ```

### Requiring ALL of several related values

To require that a parent has **all** of several related values, use a [`filter=` expression](#filter-expressions-filter)
with one term per value. Each relation term is an independent `EXISTS`, so ANDing them means
"has a toy named Ball **and** has a toy named Mouse":

```url
GET /cats?filter=toys.name=$eq:Ball AND toys.name=$eq:Mouse
```

This also composes across independent relation paths, e.g. has a Ball toy and is friends with Garfield:

```url
GET /cats?filter=toys.name=$eq:Ball AND friends.name=$eq:Garfield
```

## Usage with Eager Loading

Eager loading should work with TypeORM's eager property out of the box:

### Example

#### Code

```typescript
@Entity()
export class CatEntity {
  // ...

  @OneToMany(() => CatToyEntity, (catToy) => catToy.cat, {
    eager: true,
  })
  toys: CatToyEntity[]
}

const config: PaginateConfig<CatEntity> = {
  loadEagerRelations: true,
  sortableColumns: ['id', 'name', 'toys.name'],
  filterableColumns: {
    'toys.name': [FilterOperator.IN],
  },
}

const result = await paginate<CatEntity>(query, catRepo, config)
```

## Polymorphic sorting

Sometimes the value you want to sort on can come from one of several columns — for
example a record that links to one of two relations and you want to order by
whichever one is set. Join columns into a single sort term with `~` and the rows
are ordered by the `COALESCE` of those columns (the first non-`null` value per row).

### Endpoint

```
http://localhost:3000/cats?sortBy=bestFriend.age~nemesis.age:DESC
```

This orders by `COALESCE(bestFriend.age, nemesis.age)` — a cat's best friend's age,
or its nemesis's age when it has no best friend.

### Code

```typescript
const config: PaginateConfig<CatEntity> = {
  // Every column used in a group must be listed in sortableColumns.
  sortableColumns: ['id', 'bestFriend.age', 'nemesis.age'],
  relations: { bestFriend: true, nemesis: true },
}
```

Notes and limitations:

- The grouped columns must be **type-compatible** (e.g. all numbers, or all dates).
  Mixing incompatible types lets the database raise its own error; types are not
  coerced for you.
- A group is only applied when **every** column in it is listed in `sortableColumns`;
  otherwise the term is ignored.
- Only **plain** and **relation** columns are supported in a group. Embedded, virtual,
  and JSONB-path columns are rejected.
- Polymorphic groups are **not supported with cursor pagination** (the COALESCE value
  cannot be encoded into a cursor) and will throw.

## Filters

Filter operators must be whitelisted per column in `PaginateConfig`.
By default, unknown filter columns and invalid filter operators are ignored. Set
`throwOnInvalidFilter: true` to return `400 Bad Request` instead.

### Examples

#### Code

```typescript
const config: PaginateConfig<CatEntity> = {
  // ...
  filterableColumns: {
    // Enable individual operators on a column
    id: [FilterOperator.EQ, FilterSuffix.NOT],

    // Enable all operators on a column
    age: true,
  },
}
```

`?filter.name=$eq:Milo` is equivalent with `?filter.name=Milo`

`?filter.age=$btw:4,6` where column `age` is between `4` and `6`

`?filter.id=$not:$in:2,5,7` where column `id` is **not** `2`, `5` or `7`

`?filter.summary=$not:$ilike:term` where column `summary` does **not** contain `term`

`?filter.summary=$sw:term` where column `summary` starts with `term`

`?filter.seenAt=$null` where column `seenAt` is `NULL`

`?filter.seenAt=$not:$null` where column `seenAt` is **not** `NULL`

`?filter.createdAt=$btw:2022-02-02,2022-02-10` where column `createdAt` is between the dates `2022-02-02` and `2022-02-10`

`?filter.createdAt=$lt:2022-12-20T10:00:00.000Z` where column `createdAt` is before iso date `2022-12-20T10:00:00.000Z`

`?filter.roles=$contains:moderator` where column `roles` is an array and contains the value `moderator`

`?filter.roles=$contains:moderator,admin` where column `roles` is an array and contains the values `moderator` and `admin`

### Filter expressions (`filter=`)

The per-column `filter.<column>=` parameters above are always combined with `AND`. For
arbitrary boolean logic, pass a single `filter=` expression instead. It uses the same
column and `$op:value` syntax, combined with `AND`, `OR`, `NOT` (case-insensitive,
precedence `NOT` > `AND` > `OR`) and parentheses:

```
?filter=color=$eq:black AND age=$gte:3
?filter=(color=$eq:black OR color=$eq:white) AND NOT name=$eq:Leche
?filter=home.name=$eq:House AND toys.name=$eq:String
```

- The columns and operators are validated against `filterableColumns`, exactly like the
  per-column form. An unknown column or disallowed operator always returns `400 Bad Request`.
- Relation columns are matched with correlated `EXISTS` subqueries, so they compose under
  `OR`/`NOT` and never join the relation into the result set. `NOT toys.name=$eq:Ball` means
  "no matching toy exists".
- Root, embedded, [JSONB key-path](#jsonb-support), and [polymorphic (`~`)](#polymorphic-columns-)
  columns are all valid leaves and apply as direct conditions. Every operator, suffix and
  quantifier from the per-column form works unchanged (e.g. `age=$btw:3,5`, `age=$not:$null`,
  `toys.name=$none:$eq:Ball`); JSONB filtering keeps its PostgreSQL/CockroachDB-only limitation.
- A value containing whitespace or parentheses must be quoted with `"` or `'`:
  `?filter=home.name=$eq:"Cat Mansion"`.

Inside a quoted value, a backslash escapes a following quote or backslash (`\"`, `\'`, `\\`),
so a value can contain either quote character:

```
?filter=name=$eq:"Milo \"the cat\""   # value: Milo "the cat"
?filter=name=$eq:'it\'s mine'         # value: it's mine
?filter=name=$eq:"a\"b\'c\\d"         # value: a"b'c\d
```

Any other backslash is kept literal, so Windows paths and regexes need no doubling
(`?filter=path=$eq:"C:\Users"` → `C:\Users`). You can also switch quote styles instead of
escaping — `?filter=name=$eq:'O'"'"'Malley'`-style concatenation still works — but the
backslash form is usually clearer. Doubling a quote does **not** escape it
(`"say ""hi"""` yields `say hi`). Remember to URL-encode the `filter=` value; the examples
above are shown decoded for readability.

The value-level `$not` suffix (negating a single comparison, e.g. `color=$not:$eq:white`) is
distinct from the boolean `NOT` (negating a whole term or group).

Because the expression is parsed recursively, an unbounded expression is a denial-of-service
vector: a deeply nested or very wide payload can exhaust the call stack or blow up the
generated SQL. Every leaf, `AND`/`OR`/`NOT` operator, and parenthesised group counts as one
node, and the total is capped at **100** by default. Override the cap per endpoint with
`filterExpressionMaxComplexity` in the config, or globally via `updateGlobalConfig({ defaultFilterExpressionMaxComplexity })`.
An expression over the limit returns `400 Bad Request`.

```typescript
const config: PaginateConfig<CatEntity> = {
  sortableColumns: ['id'],
  filterableColumns: { color: true, name: true },
  filterExpressionMaxComplexity: 50, // reject filter= expressions with more than 50 nodes
}
```

### Polymorphic columns (`~`)

A filter column may group several columns with `~` to filter on their `COALESCE` — the first
non-null value per row (the same `~` syntax as polymorphic sorting). This works in both the
`filter=` expression and the per-column form:

```url
?filter=bestFriend.age~nemesis.age=$eq:4
?filter.bestFriend.age~nemesis.age=$gte:5
```

Each part must be a plain or **to-one** relation column (not embedded, virtual, JSONB, or to-many).
Relation parts are left-joined automatically and are not added to the result set. Parts may be
**nested** (`a.b.c.leaf`) as long as every segment before the leaf is a to-one relation; each hop is
joined step by step, and a prefix shared across parts (e.g. two parts both starting `a.b`) reuses the
same join rather than colliding:

```url
?filter=bestFriend.home.street~home.street=$eq:Downtown
```

## JSONB Support

You can sort, search, and filter on JSONB columns using dot notation to access nested fields.

### Database support matrix

| Feature                                   | PostgreSQL / CockroachDB | MySQL / MariaDB                         | SQLite               |
| ----------------------------------------- | ------------------------ | --------------------------------------- | -------------------- |
| **Sorting** (`sortableColumns`)           | Yes (`#>>`)              | Yes (`JSON_UNQUOTE(JSON_EXTRACT(...))`) | Yes (`json_extract`) |
| **Searching** (`searchableColumns`)       | Yes                      | Yes                                     | Yes                  |
| **Filtering** (`$eq`, `$in`, `$contains`) | Yes (`@>` containment)   | No                                      | No                   |

> **Note:** Sorting and searching on JSONB paths is supported across all database engines — the library automatically uses the correct JSON extraction function for your DB. Filtering via `$eq`, `$in`, and `$contains` uses PostgreSQL's `@>` containment operator (via TypeORM's `JsonContains`) and is only supported on **PostgreSQL** and **CockroachDB**.

### Filtering operators (PostgreSQL / CockroachDB only)

| Operator    | Description                                              |
| ----------- | -------------------------------------------------------- |
| `$eq`       | Exact match via containment (`col @> '{"key":"value"}'`) |
| `$in`       | Match any of a comma-separated list of values            |
| `$contains` | Match if a JSON array contains the value                 |

### Direct JSONB column

```
?filter.metadata.enabled=$eq:true
```

where `metadata` is a JSONB column and the filter matches rows whose `metadata` object contains `{ "enabled": true }`.

### JSONB column through a relation

Use the same dot notation to traverse relations before accessing the JSONB field:

```
?filter.settings.theme=$eq:dark
```

where `settings` is a relation whose JSONB column `theme` is filtered.

```typescript
const config: PaginateConfig<UserEntity> = {
  relations: { settings: true },
  filterableColumns: {
    'settings.theme': [FilterOperator.EQ, FilterOperator.IN],
  },
}
```

### Deeply nested JSONB paths

Paths inside the JSON value itself can be arbitrarily deep:

```
?filter.settings.ui.sidebar.color=$eq:blue
```

Regardless of nesting depth, the library walks TypeORM entity metadata to determine where the relation chain ends and the JSON key path begins, then builds the correct `@>` containment expression automatically.

### `$in` operator on JSONB

```
?filter.metadata.status=$in:active,pending
?filter.settings.theme=$in:dark,light
```

Each value is expanded into its own `@>` condition joined with `OR`:

```sql
(col @> '{"status":"active"}' OR col @> '{"status":"pending"}')
```

`$not:$in` is also supported and produces `NOT` conditions joined with `AND`:

```
?filter.metadata.status=$not:$in:banned,suspended
```

## Combining filters on one column

Repeating a `filter.<column>=` parameter applies all of its conditions with **AND**, e.g. a range:

`?filter.createdAt=$gt:2022-02-02&filter.createdAt=$lt:2022-02-10` — `createdAt` after `2022-02-02` **and** before `2022-02-10`

For **OR** (within a column or across columns) and arbitrary boolean logic, use a
[`filter=` expression](#filter-expressions-filter):

`?filter=id=$eq:5 OR id=$eq:7` — `id` equal to `5` **or** `7`

## Cursor-based Pagination

- `paginationType: PaginationType.CURSOR`
- Cursor format:
  - Numbers: `[prefix1][integer:11 digits][prefix2][decimal:4 digits]` (e.g., `Y00000000001V2500` for -1.25 in ASC).
  - Dates: `[prefix][value:15 digits]` (e.g., `V001671444000000` for a timestamp in DESC).
- Prefixes:
  - `null`: `A` (lowest priority, last in results).
  - ASC:
    - positive-int: `V` (greater than or equal to 1), `X` (less than 1)
    - positive-decimal: `V` (not zero), `X` (zero)
    - zero-int: `X`
    - zero-decimal: `X`
    - negative-int: `Y`
    - negative-decimal: `V`
  - DESC:
    - positive-int: `V`
    - positive-decimal: `V`
    - zero-int: `N`
    - zero-decimal: `X`
    - negative-int: `M` (less than or equal to -1), `N` (greater than -1)
    - negative-decimal: `V` (not zero), `X` (zero)
- Logic:
  - Numbers: Split into integer (11 digits) and decimal (4 digits) parts, with separate prefixes. Supports negative values, with sorting adjusted per direction.
  - Dates: Single prefix with 15-digit timestamp padded with zeros.
  - ASC: Negative → Zero → Positive → Null.
  - DESC: Positive → Zero → Negative → Null.
- Notes:
  - Multiple columns: `sortBy` can include multiple columns to create and sort by the cursor (e.g., `sortBy=age:ASC&sortBy=createdAt:DESC`), but at least one column must be unique to ensure consistent ordering.
  - Supported columns: Cursor sorting is available for numeric and date-related columns (string columns are not supported).
  - Decimal support: Numeric columns can include decimals, limited to 11 digits for the integer part and 4 digits for the decimal part.

## Swagger

You can use two default decorators @ApiOkResponsePaginated and @ApiPagination to generate swagger documentation for your endpoints

`@ApiOkPaginatedResponse` is for response body, return http[](https://) status is 200

`@ApiPaginationQuery` is for query params

```typescript
  @Get()
  @ApiOkPaginatedResponse(
    UserDto,
    USER_PAGINATION_CONFIG,
  )
  @ApiPaginationQuery(USER_PAGINATION_CONFIG)
  async findAll(
    @Paginate()
    query: PaginateQuery,
  ): Promise<Paginated<UserEntity>> {

  }
```

There is also some syntax sugar for this, and you can use only one decorator `@PaginatedSwaggerDocs` for both response body and query params

```typescript
  @Get()
  @PaginatedSwaggerDocs(UserDto, USER_PAGINATION_CONFIG)
  async findAll(
    @Paginate()
    query: PaginateQuery,
  ): Promise<Paginated<UserEntity>> {

  }
```

It is also possible to customize a swagger UI completely or partially, by following the default implementation and creating your own version of PaginatedSwaggerDocs decorator

Let's say you want some custom appearance for SortBy, you need to create a decorator for it

```typescript
export function CustomSortBy(paginationConfig: PaginateConfig<any>) {
  return ApiQuery({
    name: 'sortBy',
    isArray: true,
    description: `My custom sort by description`,
    required: false,
    type: 'string',
  })
}
```

Now you can create your version of the whole docs decorator and use it

```typescript
const CustomApiPaginationQuery = (paginationConfig: PaginateConfig<any>) => {
  return applyDecorators(
    ...[
      Page(),
      Limit(paginationConfig),
      Where(paginationConfig),
      CustomSortBy(paginationConfig),
      Search(paginationConfig),
      SearchBy(paginationConfig),
      Select(paginationConfig),
    ].filter((v): v is MethodDecorator => v !== undefined)
  )
}

function CustomPaginatedSwaggerDocs<DTO extends Type<unknown>>(dto: DTO, paginatedConfig: PaginateConfig<any>) {
  return applyDecorators(ApiOkPaginatedResponse(dto, paginatedConfig), CustomApiPaginationQuery(paginatedConfig))
}
```

You can use CustomPaginatedSwaggerDocs instead of default PaginatedSwaggerDocs

## Troubleshooting

The package does not report error reasons in the response bodies. They are instead
reported as `debug` level [logging](https://docs.nestjs.com/techniques/logger#logger).

Common errors include missing `sortableColumns` or `filterableColumns` (the latter only affects filtering).
