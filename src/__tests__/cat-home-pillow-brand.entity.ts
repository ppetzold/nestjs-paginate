import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm'

@Entity()
export class CatHomePillowBrandEntity {
    @PrimaryGeneratedColumn()
    id: number

    @Column()
    name: string

    @Column({ nullable: true })
    quality: string
}
