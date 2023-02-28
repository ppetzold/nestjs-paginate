import { Column, CreateDateColumn, Entity, OneToMany, OneToOne, PrimaryGeneratedColumn, VirtualColumn } from 'typeorm'
import { CatEntity } from './cat.entity'
import { CatHomePillowEntity } from './cat-home-pillow.entity'

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
        query: (alias) => `SELECT CAST(COUNT(*) AS INT)  FROM "cat" WHERE "cat"."homeId" = ${alias}.id`,
    })
    countCat: number
}
