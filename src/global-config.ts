export interface NestjsPaginateGlobalConfig {
    defaultOrigin: string | undefined
    defaultLimit: number
    defaultMaxLimit: number
    /**
     * Default cap on the number of nodes a `filter=` boolean expression may contain, applied
     * when a `PaginateConfig` does not set `filterExpressionMaxComplexity`. Guards against
     * denial-of-service via deeply nested or very wide expressions.
     */
    defaultFilterExpressionMaxComplexity: number
    /**
     * When `true`, per-column filters using the legacy `$and:`/`$or:` comparator syntax are
     * automatically translated into a `filter=` boolean expression before processing.
     * Applied globally when a `PaginateConfig` does not set `translateLegacyFilter`.
     */
    defaultTranslateLegacyFilter: boolean
}

const globalConfig: NestjsPaginateGlobalConfig = {
    defaultOrigin: undefined,
    defaultLimit: 20,
    defaultMaxLimit: 100,
    defaultFilterExpressionMaxComplexity: 100,
    defaultTranslateLegacyFilter: false,
}

export const updateGlobalConfig = (newConfig: Partial<NestjsPaginateGlobalConfig>) => {
    Object.assign(globalConfig, newConfig)
}

export default globalConfig
