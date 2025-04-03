import { ColumnOptions } from 'typeorm'

const getDateColumnType = () => {
    switch (process.env.DB) {
        case 'postgres':
        case 'cockroachdb':
            return 'timestamptz'
        case 'mysql':
        case 'mariadb':
            return 'timestamp'
        case 'sqlite':
            return 'datetime'
        default:
            return 'timestamp'
    }
}

export const DateColumnNotNull: ColumnOptions = {
    type: getDateColumnType(),
}

export const DateColumnNullable: ColumnOptions = {
    ...DateColumnNotNull,
    nullable: true,
}
