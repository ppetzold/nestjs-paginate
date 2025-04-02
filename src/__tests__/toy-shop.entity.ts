import { Column, CreateDateColumn, Entity, JoinColumn, OneToOne, PrimaryGeneratedColumn } from 'typeorm'
import { DateColumnNotNull } from './column-option'
import { ToyShopAddressEntity } from './toy-shop-address.entity'

@Entity()
export class ToyShopEntity {
    @PrimaryGeneratedColumn()
    id: number

    @Column()
    shopName: string

    @OneToOne(() => ToyShopAddressEntity, { nullable: true })
    @JoinColumn()
    address: ToyShopAddressEntity

    @CreateDateColumn(DateColumnNotNull)
    createdAt: string
}
