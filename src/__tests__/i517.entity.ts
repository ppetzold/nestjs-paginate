import { Entity, Column, JoinTable, ManyToMany } from 'typeorm'

import { PrimaryGeneratedColumn } from 'typeorm'

@Entity('user')
export class UserEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string

    @Column()
    username: string

    @JoinTable()
    @ManyToMany(() => RoleEntity, (roleEntity) => roleEntity.users, {
        cascade: true,
    })
    roles: RoleEntity[]
}

@Entity('role')
export class RoleEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string

    @Column({
        unique: true,
    })
    name: string

    @ManyToMany(() => UserEntity, (user) => user.roles)
    users: UserEntity[]
}
