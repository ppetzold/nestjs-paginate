import { Column } from 'typeorm'

export class SizeEmbed {
    @Column()
    height: number

    @Column()
    width: number

    @Column()
    length: number
}
