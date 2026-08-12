import { asRoleId, type RoleId } from '@iecp/types';

/** blueprint §53 — roles form a tree via `parentId`; see PermissionResolver
 * for how a role's effective (self + inherited) permissions get computed. */
export class Role {
  private constructor(
    public readonly id: RoleId,
    public readonly parentId: RoleId | null,
    public readonly name: string,
    public readonly description: string | null,
    public readonly isSystem: boolean,
    public readonly createdAt: Date,
  ) {}

  static create(props: {
    id: string;
    parentId?: string | null;
    name: string;
    description?: string | null;
    isSystem?: boolean;
    createdAt: Date;
  }): Role {
    return new Role(
      asRoleId(props.id),
      props.parentId ? asRoleId(props.parentId) : null,
      props.name,
      props.description ?? null,
      props.isSystem ?? false,
      props.createdAt,
    );
  }
}
