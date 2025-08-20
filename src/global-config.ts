export interface NestjsPaginateGlobalConfig {
    defaultOrigin: string | undefined
    defaultLimit: number
    defaultMaxLimit: number
}

const globalConfig: NestjsPaginateGlobalConfig = {
    defaultOrigin: undefined,
    defaultLimit: 20,
    defaultMaxLimit: 100,
}

export const updateGlobalConfig = (newConfig: Partial<NestjsPaginateGlobalConfig>) => {
    Object.assign(globalConfig, newConfig)
}

export default globalConfig
