import { Column, CreateDateColumn, Entity, JoinColumn, OneToOne, PrimaryGeneratedColumn } from 'typeorm'
import { DateColumnNotNull } from './column-option'

@Entity()
export class CatHairEntity {
    @PrimaryGeneratedColumn()
    id: number

    @Column()
    name: string

    @Column({ type: 'text', array: true, default: '{}' })
    colors: string[]

    @CreateDateColumn(DateColumnNotNull)
    createdAt: string

    @Column({ type: 'jsonb', nullable: true })
    metadata: Record<string, any>

    // Plain `json` (not `jsonb`) column. Postgres `json` does not support the `@>`
    // containment operator, so filtering must go through `#>>` text extraction.
    @Column({ type: 'json', nullable: true })
    metadataJson: Record<string, any>

    @OneToOne(() => CatHairEntity, (catFur) => catFur.underCoat, { nullable: true })
    @JoinColumn()
    underCoat: CatHairEntity
}
