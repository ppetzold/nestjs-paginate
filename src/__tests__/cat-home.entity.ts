import { Column, CreateDateColumn, Entity, OneToOne, PrimaryGeneratedColumn } from 'typeorm'
import { CatEntity } from './cat.entity'

@Entity()
export class CatHomeEntity {
    @PrimaryGeneratedColumn()
    id: number

    @Column()
    name: string

    @OneToOne(() => CatEntity, (cat) => cat.home)
    cat: CatEntity

    @CreateDateColumn()
    createdAt: string
}
