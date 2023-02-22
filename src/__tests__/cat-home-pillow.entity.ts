import { Column, CreateDateColumn, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm'
import { CatHomeEntity } from './cat-home.entity'

@Entity()
export class CatHomePillowEntity {
    @PrimaryGeneratedColumn()
    id: number

    @ManyToOne(() => CatHomeEntity, (home) => home.pillows)
    home: CatHomeEntity

    @Column()
    color: string

    @CreateDateColumn()
    createdAt: string
}
