import { Column, CreateDateColumn, Entity, OneToOne, PrimaryGeneratedColumn } from 'typeorm'
import { DateColumnNotNull } from './column-option'
import { ToyShopEntity } from './toy-shop.entity'

@Entity()
export class ToyShopAddressEntity {
    @PrimaryGeneratedColumn()
    id: number

    @Column()
    address: string

    @OneToOne(() => ToyShopEntity, (shop) => shop.address)
    shop: ToyShopEntity

    @CreateDateColumn(DateColumnNotNull)
    createdAt: string
}
