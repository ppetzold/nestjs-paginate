import {
    Column,
    CreateDateColumn,
    Entity,
    ManyToOne,
    OneToMany,
    OneToOne,
    PrimaryGeneratedColumn,
    VirtualColumn,
} from 'typeorm'
import { CatHomePillowEntity } from './cat-home-pillow.entity'
import { CatEntity } from './cat.entity'
import { DateColumnNotNull } from './column-option'

@Entity()
export class CatHomeEntity {
    @PrimaryGeneratedColumn()
    id: number

    @Column()
    name: string

    @Column({ nullable: true })
    street: string | null

    @OneToOne(() => CatEntity, (cat) => cat.home)
    cat: CatEntity

    @OneToMany(() => CatHomePillowEntity, (pillow) => pillow.home)
    pillows: CatHomePillowEntity[]

    @ManyToOne(() => CatHomePillowEntity, { nullable: true })
    naptimePillow: CatHomePillowEntity | null

    @CreateDateColumn(DateColumnNotNull)
    createdAt: string

    @VirtualColumn({
        query: (alias) => {
            const tck = process.env.DB === 'mariadb' ? '`' : '"'
            const intType = process.env.DB === 'mariadb' ? 'UNSIGNED' : 'INT'
            return `SELECT CAST(COUNT(*) AS ${intType}) FROM ${tck}cat${tck} WHERE ${tck}cat${tck}.${tck}homeId${tck} = ${alias}.id`
        },
    })
    countCat: number
}
