import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm'

@Entity()
export class ToyShopAddressEntity {
    @PrimaryGeneratedColumn()
    id: number

    @Column()
    address: string

    @CreateDateColumn()
    createdAt: string
}
