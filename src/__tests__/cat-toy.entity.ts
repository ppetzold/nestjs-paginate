import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm'
import { CatEntity } from './cat.entity'
import { SizeEmbed } from './size.embed'

@Entity()
export class CatToyEntity {
    @PrimaryGeneratedColumn()
    id: number

    @Column()
    name: string

    @Column(() => SizeEmbed)
    size: SizeEmbed

    @ManyToOne(() => CatEntity, (cat) => cat.toys)
    @JoinColumn()
    cat: CatEntity

    @CreateDateColumn()
    createdAt: string
}
