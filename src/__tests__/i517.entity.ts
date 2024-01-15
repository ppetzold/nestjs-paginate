import { Index, Entity, Column, JoinTable, ManyToMany } from 'typeorm'

import { CreateDateColumn, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm'

export enum UserStatusEnum {
    normal = 1,
    disabled,
    notActivated,
}

export class BaseEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string

    @CreateDateColumn({
        type: 'timestamp',
        default: () => 'CURRENT_TIMESTAMP(6)',
    })
    createdAt: Date

    @UpdateDateColumn({
        type: 'timestamp',
        default: () => 'CURRENT_TIMESTAMP(6)',
        onUpdate: 'CURRENT_TIMESTAMP(6)',
    })
    updatedAt: Date
}

@Index(['email', 'phone', 'id'])
@Entity('user')
export class UserEntity extends BaseEntity {
    @Column({
        default: '未命名用户',
    })
    username: string

    @Column({
        nullable: true,
    })
    realName?: string

    @Column()
    password: string

    @Column({
        nullable: true,
        unique: true,
    })
    email?: string

    @Column({
        unique: true,
    })
    phone: string

    @Column({
        nullable: true,
    })
    weChatId?: string

    @Column({
        nullable: true,
    })
    avatar?: string

    @Column({
        type: 'enum',
        default: UserStatusEnum.notActivated,
        enum: UserStatusEnum,
    })
    status: UserStatusEnum

    @Column({
        default: false,
    })
    phoneValidated: boolean

    @Column({
        default: false,
    })
    emailValidated: boolean

    @JoinTable()
    @ManyToMany(() => RoleEntity, (roleEntity) => roleEntity.users, {
        cascade: true,
    })
    roles: RoleEntity[]
}

@Entity('permission')
export class PermissionEntity extends BaseEntity {
    @Column()
    path: string

    @Column()
    method: string

    @Column({
        default: false,
    })
    isPublic: boolean

    @ManyToMany(() => RoleEntity, (role) => role.permissions)
    roles: RoleEntity[]
}

@Entity('role')
@Index(['id'])
export class RoleEntity extends BaseEntity {
    @Column({
        unique: true,
    })
    name: string

    @Column({
        nullable: true,
    })
    description?: string

    @Column({
        default: true,
    })
    editable: boolean

    @ManyToMany(() => UserEntity, (user) => user.roles)
    users: UserEntity[]

    @JoinTable()
    @ManyToMany(() => PermissionEntity, (permission) => permission.roles)
    permissions: PermissionEntity[]
}
