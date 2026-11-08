import { getJoinAlias } from './helper'

describe('getJoinAlias', () => {
    const driver = (maxAliasLength?: number) => ({ connection: { driver: { maxAliasLength } } }) as any

    it('keeps aliases that fit within the driver limit unchanged', () => {
        expect(getJoinAlias(driver(63), '__root_toys_rel')).toBe('__root_toys_rel')
        expect(getJoinAlias(driver(undefined), 'x'.repeat(200))).toBe('x'.repeat(200))
    })

    it('shortens long aliases deterministically and keeps them distinct', () => {
        const prefix = '__root_' + 'a'.repeat(60)
        const first = getJoinAlias(driver(63), `${prefix}_first_rel`)
        const second = getJoinAlias(driver(63), `${prefix}_second_rel`)

        expect(first.length).toBeLessThanOrEqual(63)
        expect(second.length).toBeLessThanOrEqual(63)
        expect(first).not.toBe(second)
        expect(getJoinAlias(driver(63), `${prefix}_first_rel`)).toBe(first)
    })
})
