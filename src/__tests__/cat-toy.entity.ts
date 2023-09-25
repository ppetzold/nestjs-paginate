import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm'
import { CatEntity } from './cat.entity'
import { SizeEmbed } from './size.embed'
import { ToyShopEntity } from './toy-shop.entity'

@Entity()
export class CatToyEntity {
    @PrimaryGeneratedColumn()
    id: number

    @Column()
    name: string

    @Column(() => SizeEmbed)
    size: SizeEmbed

    @ManyToOne(() => ToyShopEntity, { nullable: true })
    @JoinColumn()
    shop?: ToyShopEntity

    @ManyToOne(() => CatEntity, (cat) => cat.toys)
    @JoinColumn()
    cat: CatEntity

    @CreateDateColumn()
    createdAt: string
}
