import {
    Column,
    CreateDateColumn,
    DeleteDateColumn,
    Entity,
    JoinColumn,
    OneToMany,
    OneToOne,
    PrimaryGeneratedColumn,
} from 'typeorm'
import { CatToyEntity } from './cat-toy.entity'
import { CatHomeEntity } from './cat-home.entity'

@Entity()
export class CatEntity {
    @PrimaryGeneratedColumn()
    id: number

    @Column()
    name: string

    @Column()
    color: string

    @Column({ nullable: true })
    age: number | null

    @OneToMany(() => CatToyEntity, (catToy) => catToy.cat)
    toys: CatToyEntity[]

    @OneToOne(() => CatHomeEntity, (catHome) => catHome.cat, { nullable: true })
    @JoinColumn()
    home: CatHomeEntity

    @CreateDateColumn()
    createdAt: string

    @DeleteDateColumn({ nullable: true })
    deletedAt?: string
}
