import { Column, CreateDateColumn, Entity, JoinColumn, OneToOne, PrimaryGeneratedColumn, VirtualColumn } from 'typeorm'
import { DateColumnNotNull } from './column-option'
import { ToyShopAddressEntity } from './toy-shop-address.entity'

@Entity()
export class ToyShopEntity {
    @PrimaryGeneratedColumn()
    id: number

    @Column()
    shopName: string

    @OneToOne(() => ToyShopAddressEntity, (address) => address.shop, { nullable: true })
    @JoinColumn()
    address: ToyShopAddressEntity

    @VirtualColumn({
        query: (alias) => {
            const tck = process.env.DB === 'mariadb' ? '`' : '"'
            return `UPPER(${alias}.${tck}shopName${tck})`
        },
    })
    upperShopName: string

    @CreateDateColumn(DateColumnNotNull)
    createdAt: string
}
