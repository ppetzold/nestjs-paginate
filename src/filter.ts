import { Brackets, FindOperator, SelectQueryBuilder } from 'typeorm'
import { WherePredicateOperator } from 'typeorm/query-builder/WhereClause'
import { PaginateQuery } from './decorator'
import {
    checkIsEmbedded,
    checkIsRelation,
    extractVirtualProperty,
    fixColumnAlias,
    getPropertiesByColumnName,
} from './helper'
import {
    FilterComparator,
    FilterOperator,
    FilterSuffix,
    isComparator,
    isOperator,
    isSuffix,
    OperatorSymbolToFunction,
} from './operator'
import { PaginateConfig } from './paginate'

type Filter = { comparator: FilterComparator; findOperator: FindOperator<string> }
type ColumnsFilters = { [columnName: string]: Filter[] }

export interface FilterToken {
    comparator: FilterComparator
    suffix?: FilterSuffix
    operator: FilterOperator
    value: string
}

// This function is used to fix the query parameters when using relation, embeded or virtual properties
// It will replace the column name with the alias name and return the new parameters
export function fixQueryParam(
    alias: string,
    column: string,
    filter: Filter,
    condition: WherePredicateOperator,
    parameters: { [key: string]: string }
): { [key: string]: string } {
    const isNotOperator = (condition.operator as string) === 'not'

    const conditionFixer = (
        alias: string,
        column: string,
        filter: Filter,
        operator: WherePredicateOperator['operator'],
        parameters: { [key: string]: string }
    ): { condition_params: any; params: any } => {
        let condition_params: any = undefined
        let params = parameters
        switch (operator) {
            case 'between':
                condition_params = [alias, `:${column}_from`, `:${column}_to`]
                params = {
                    [column + '_from']: filter.findOperator.value[0],
                    [column + '_to']: filter.findOperator.value[1],
                }
                break
            case 'in':
                condition_params = [alias, `:...${column}`]
                break
            default:
                condition_params = [alias, `:${column}`]
                break
        }
        return { condition_params, params }
    }

    const { condition_params, params } = conditionFixer(
        alias,
        column,
        filter,
        isNotOperator ? condition['condition']['operator'] : condition.operator,
        parameters
    )

    if (isNotOperator) {
        condition['condition']['parameters'] = condition_params
    } else {
        condition.parameters = condition_params
    }

    return params
}

export function generatePredicateCondition(
    qb: SelectQueryBuilder<unknown>,
    column: string,
    filter: Filter,
    alias: string,
    isVirtualProperty = false
): WherePredicateOperator {
    return qb['getWherePredicateCondition'](
        isVirtualProperty ? column : alias,
        filter.findOperator
    ) as WherePredicateOperator
}

export function addWhereCondition<T>(qb: SelectQueryBuilder<T>, column: string, filter: ColumnsFilters) {
    const columnProperties = getPropertiesByColumnName(column)
    const { isVirtualProperty, query: virtualQuery } = extractVirtualProperty(qb, columnProperties)
    const isRelation = checkIsRelation(qb, columnProperties.propertyPath)
    const isEmbedded = checkIsEmbedded(qb, columnProperties.propertyPath)
    const alias = fixColumnAlias(columnProperties, qb.alias, isRelation, isVirtualProperty, isEmbedded, virtualQuery)
    filter[column].forEach((columnFilter: Filter, index: number) => {
        const columnNamePerIteration = `${columnProperties.column}${index}`
        const condition = generatePredicateCondition(
            qb,
            columnProperties.column,
            columnFilter,
            alias,
            isVirtualProperty
        )
        const parameters = fixQueryParam(alias, columnNamePerIteration, columnFilter, condition, {
            [columnNamePerIteration]: columnFilter.findOperator.value,
        })
        if (columnFilter.comparator === FilterComparator.OR) {
            qb.orWhere(qb['createWhereConditionExpression'](condition), parameters)
        } else {
            qb.andWhere(qb['createWhereConditionExpression'](condition), parameters)
        }
    })
}

export function getFilterTokens(raw?: string): FilterToken | null {
    if (raw === undefined || raw === null) {
        return null
    }

    const token: FilterToken = {
        comparator: FilterComparator.AND,
        suffix: undefined,
        operator: FilterOperator.EQ,
        value: raw,
    }

    const MAX_OPERTATOR = 4 // max 4 operator es: $and:$not:$eq:$null
    const OPERAND_SEPARATOR = ':'

    const matches = raw.split(OPERAND_SEPARATOR)
    const maxOperandCount = matches.length > MAX_OPERTATOR ? MAX_OPERTATOR : matches.length
    const notValue: (FilterOperator | FilterSuffix | FilterComparator)[] = []

    for (let i = 0; i < maxOperandCount; i++) {
        const match = matches[i]
        if (isComparator(match)) {
            token.comparator = match
        } else if (isSuffix(match)) {
            token.suffix = match
        } else if (isOperator(match)) {
            token.operator = match
        } else {
            break
        }
        notValue.push(match)
    }

    if (notValue.length) {
        token.value =
            token.operator === FilterOperator.NULL
                ? undefined
                : raw.replace(`${notValue.join(OPERAND_SEPARATOR)}${OPERAND_SEPARATOR}`, '')
    }

    return token
}

export function parseFilter<T>(
    query: PaginateQuery,
    filterableColumns?: PaginateConfig<T>['filterableColumns']
): ColumnsFilters {
    const filter: ColumnsFilters = {}
    if (!filterableColumns || !query.filter) {
        return {}
    }
    for (const column of Object.keys(query.filter)) {
        if (!(column in filterableColumns)) {
            continue
        }
        const allowedOperators = filterableColumns[column]
        const input = query.filter[column]
        const statements = !Array.isArray(input) ? [input] : input
        for (const raw of statements) {
            const token = getFilterTokens(raw)
            if (
                !token ||
                !(
                    allowedOperators.includes(token.operator) ||
                    (token.suffix === FilterSuffix.NOT &&
                        allowedOperators.includes(token.suffix) &&
                        token.operator === FilterOperator.EQ) ||
                    (token.suffix &&
                        allowedOperators.includes(token.suffix) &&
                        allowedOperators.includes(token.operator))
                )
            ) {
                continue
            }

            const params: (typeof filter)[0][0] = {
                comparator: token.comparator,
                findOperator: undefined,
            }

            switch (token.operator) {
                case FilterOperator.BTW:
                    params.findOperator = OperatorSymbolToFunction.get(token.operator)(...token.value.split(','))
                    break
                case FilterOperator.IN:
                    params.findOperator = OperatorSymbolToFunction.get(token.operator)(token.value.split(','))
                    break
                case FilterOperator.ILIKE:
                    params.findOperator = OperatorSymbolToFunction.get(token.operator)(`%${token.value}%`)
                    break
                case FilterOperator.SW:
                    params.findOperator = OperatorSymbolToFunction.get(token.operator)(`${token.value}%`)
                    break
                default:
                    params.findOperator = OperatorSymbolToFunction.get(token.operator)(token.value)
            }

            filter[column] = [...(filter[column] || []), params]

            if (token.suffix) {
                const lastFilterElement = filter[column].length - 1
                filter[column][lastFilterElement].findOperator = OperatorSymbolToFunction.get(token.suffix)(
                    filter[column][lastFilterElement].findOperator
                )
            }
        }
    }

    return filter
}

export function addFilter<T>(
    qb: SelectQueryBuilder<T>,
    query: PaginateQuery,
    filterableColumns?: PaginateConfig<T>['filterableColumns']
): SelectQueryBuilder<T> {
    const filter = parseFilter(query, filterableColumns)
    return qb.andWhere(
        new Brackets((qb: SelectQueryBuilder<T>) => {
            for (const column in filter) {
                addWhereCondition(qb, column, filter)
            }
        })
    )
}
