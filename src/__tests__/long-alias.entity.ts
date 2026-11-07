import { Column, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, Relation } from 'typeorm'

// Relation names long enough that the path-derived join aliases (`__root_<relation>_rel...`)
// exceed the 63 character identifier limit of Postgres. The two relations share a long common
// prefix, so plain truncation would give both joins the same alias. The join columns get short
// names so the tables can be created on MariaDB, whose column names are limited to 64 characters.

@Entity()
export class LongAliasLeafEntity {
    @PrimaryGeneratedColumn()
    id: number

    @Column()
    label: string
}

@Entity()
export class LongAliasTargetEntity {
    @PrimaryGeneratedColumn()
    id: number

    @Column()
    name: string

    @ManyToOne(() => LongAliasLeafEntity, { nullable: true })
    @JoinColumn()
    leafReachedThroughAnotherVeryLongRelationName?: LongAliasLeafEntity

    @ManyToOne(() => LongAliasOwnerEntity, (owner) => owner.targetsReachedThroughAVeryLongRelationName)
    @JoinColumn()
    owner: Relation<LongAliasOwnerEntity>
}

@Entity()
export class LongAliasOwnerEntity {
    @PrimaryGeneratedColumn()
    id: number

    @Column()
    name: string

    @ManyToOne(() => LongAliasTargetEntity, { nullable: true })
    @JoinColumn({ name: 'firstTargetId' })
    relationWithAnExceptionallyLongNameThatOverflowsTheAliasLimitFirst?: LongAliasTargetEntity

    @ManyToOne(() => LongAliasTargetEntity, { nullable: true })
    @JoinColumn({ name: 'secondTargetId' })
    relationWithAnExceptionallyLongNameThatOverflowsTheAliasLimitSecond?: LongAliasTargetEntity

    @OneToMany(() => LongAliasTargetEntity, (target) => target.owner)
    targetsReachedThroughAVeryLongRelationName: LongAliasTargetEntity[]
}
