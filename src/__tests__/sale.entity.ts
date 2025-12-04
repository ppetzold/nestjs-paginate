import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm'

@Entity({ name: 'sales' })
export class SaleEntity {
    @PrimaryGeneratedColumn()
    id: number

    @Column({ name: 'item_name', nullable: false })
    itemName: string

    @Column({ nullable: false })
    quantity: number

    @Column({ nullable: false, type: 'decimal', precision: 10, scale: 2 })
    unitPrice: number

    @Column({ nullable: false, type: 'decimal', precision: 10, scale: 2 })
    totalPrice: number
}
