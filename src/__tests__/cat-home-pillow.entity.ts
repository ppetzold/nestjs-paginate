import { Column, CreateDateColumn, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm'
import { CatHomePillowBrandEntity } from './cat-home-pillow-brand.entity'
import { CatHomeEntity } from './cat-home.entity'
import { DateColumnNotNull } from './column-option'

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

    @CreateDateColumn(DateColumnNotNull)
    createdAt: string
}
