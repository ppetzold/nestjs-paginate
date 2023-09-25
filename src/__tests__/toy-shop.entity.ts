import { Column, CreateDateColumn, Entity, JoinColumn, OneToOne, PrimaryGeneratedColumn } from 'typeorm'
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

    @CreateDateColumn()
    createdAt: string
}
