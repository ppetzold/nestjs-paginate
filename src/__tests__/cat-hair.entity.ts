import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm'

@Entity()
export class CatHairEntity {
    @PrimaryGeneratedColumn()
    id: number

    @Column()
    name: string

    @Column({ type: 'text', array: true, default: '{}' })
    colors: string[]

    @CreateDateColumn()
    createdAt: string
}
