import { Column, CreateDateColumn, Entity, OneToMany, OneToOne, PrimaryGeneratedColumn, VirtualColumn } from 'typeorm'
import { CatHomePillowEntity } from './cat-home-pillow.entity'
import { CatEntity } from './cat.entity'

@Entity()
export class CatHomeEntity {
    @PrimaryGeneratedColumn()
    id: number

    @Column()
    name: string

    @OneToOne(() => CatEntity, (cat) => cat.home)
    cat: CatEntity

    @OneToMany(() => CatHomePillowEntity, (pillow) => pillow.home)
    pillows: CatHomePillowEntity[]

    @CreateDateColumn()
    createdAt: string

    @VirtualColumn({
        query: (alias) => {
            const tck = process.env.DB === 'mariadb' ? '`' : '"'
            return `SELECT CAST(COUNT(*) AS INT) FROM ${tck}cat${tck} WHERE ${tck}cat${tck}.${tck}homeId${tck} = ${alias}.id`
        },
    })
    countCat: number
}
