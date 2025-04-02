import {
    AfterLoad,
    Column,
    CreateDateColumn,
    DeleteDateColumn,
    Entity,
    JoinColumn,
    JoinTable,
    ManyToMany,
    OneToMany,
    OneToOne,
    PrimaryGeneratedColumn,
} from 'typeorm'
import { CatHomeEntity } from './cat-home.entity'
import { CatToyEntity } from './cat-toy.entity'
import { DateColumnNotNull, DateColumnNullable } from './column-option'
import { SizeEmbed } from './size.embed'

export enum CutenessLevel {
    LOW = 'low',
    MEDIUM = 'medium',
    HIGH = 'high',
}

@Entity({ name: 'cat' })
export class CatEntity {
    @PrimaryGeneratedColumn()
    id: number

    @Column()
    name: string

    @Column()
    color: string

    @Column({ nullable: true })
    age: number | null

    @Column({ type: 'text' }) // We don't use enum type as it makes it easier when testing across different db drivers.
    cutenessLevel: CutenessLevel

    @Column(DateColumnNullable)
    lastVetVisit: Date | null

    @Column(() => SizeEmbed)
    size: SizeEmbed

    @OneToMany(() => CatToyEntity, (catToy) => catToy.cat, {
        eager: true,
    })
    toys: CatToyEntity[]

    @OneToOne(() => CatHomeEntity, (catHome) => catHome.cat, { nullable: true })
    @JoinColumn()
    home: CatHomeEntity

    @CreateDateColumn(DateColumnNotNull)
    createdAt: string

    @DeleteDateColumn(DateColumnNullable)
    deletedAt?: string

    @ManyToMany(() => CatEntity)
    @JoinTable()
    friends: CatEntity[]

    @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
    weightChange: number | null

    @AfterLoad()
    // Fix due to typeorm bug that doesn't set entity to null
    // when the reletated entity have only the virtual column property with a value different from null
    private afterLoad() {
        if (this.home && !this.home?.id) {
            this.home = null
        }

        if (this.weightChange) {
            this.weightChange = Number(this.weightChange) // convert value returned as character to number
        }
    }
}
