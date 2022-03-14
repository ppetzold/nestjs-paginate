export type Join<K, P> = K extends string ? (P extends string ? `${K}${'' extends P ? '' : '.'}${P}` : never) : never

export type Prev = [never, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, ...0[]]
