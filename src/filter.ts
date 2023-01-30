import { FindOperator, SelectQueryBuilder } from 'typeorm'
import { WherePredicateOperator } from 'typeorm/query-builder/WhereClause'
import { checkIsRelation, extractVirtualProperty, fixColumnAlias, getPropertiesByColumnName } from './helper'

export type Filter = { [columnName: string]: FindOperator<string> }

export function generatePredicateCondition(
    qb: SelectQueryBuilder<unknown>,
    column: string,
    filter: Filter,
    alias: string,
    isVirtualProperty = false
): WherePredicateOperator {
    return qb['getWherePredicateCondition'](
        isVirtualProperty ? column : alias,
        filter[column]
    ) as WherePredicateOperator
}

// This function is used to fix the query parameters when using relation, embeded or virtual properties
// It will replace the column name with the alias name and return the new parameters
function fixQueryParam(
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
                    [column + '_from']: filter[column].value[0],
                    [column + '_to']: filter[column].value[1],
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

export function addWhereCondition(qb: SelectQueryBuilder<unknown>, column: string, filter: Filter) {
    const columnProperties = getPropertiesByColumnName(column)
    const { isVirtualProperty, query: virtualQuery } = extractVirtualProperty(qb, columnProperties)
    const isRelation = checkIsRelation(qb, columnProperties.propertyPath)
    const alias = fixColumnAlias(columnProperties, qb.alias, isRelation, isVirtualProperty, virtualQuery)
    const condition = generatePredicateCondition(qb, column, filter, alias, isVirtualProperty)
    const parameters = fixQueryParam(alias, column, filter, condition, {
        [column]: filter[column].value,
    })
    qb.andWhere(qb['createWhereConditionExpression'](condition), parameters)
}
