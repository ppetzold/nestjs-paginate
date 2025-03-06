import { Column, CreateDateColumn, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm'
import { CatHomeEntity } from './cat-home.entity'
import { CatHomePillowBrandEntity } from './cat-home-pillow-brand.entity'

@Entity()
export class CatHomePillowEntity {
    @PrimaryGeneratedColumn()
    id: number

    @ManyToOne(() => CatHomeEntity, (home) => home.pillows)
    home: CatHomeEntity

    @Column()
    color: string

    @ManyToOne(() => CatHomePillowBrandEntity)
    brand: CatHomePillowBrandEntity

    @CreateDateColumn()
    createdAt: string
}
