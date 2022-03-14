import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm'
import { CatEntity } from './cat.entity'

@Entity()
export class CatToyEntity {
    @PrimaryGeneratedColumn()
    id: number

    @Column()
    name: string

    @ManyToOne(() => CatEntity, (cat) => cat.toys)
    @JoinColumn()
    cat: CatEntity

    @CreateDateColumn()
    createdAt: string
}
