import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm'
import { DateColumnNotNull } from './column-option'

@Entity()
export class ToyShopAddressEntity {
    @PrimaryGeneratedColumn()
    id: number

    @Column()
    address: string

    @CreateDateColumn(DateColumnNotNull)
    createdAt: string
}
