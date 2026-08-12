import { asPermissionId, type PermissionId } from '@iecp/types';

/** blueprint §53's fine-grained permission model — `key` is `module.action`. */
export class Permission {
  private constructor(
    public readonly id: PermissionId,
    public readonly module: string,
    public readonly action: string,
    public readonly key: string,
    public readonly description: string | null,
  ) {}

  static create(props: {
    id: string;
    module: string;
    action: string;
    key: string;
    description?: string | null;
  }): Permission {
    return new Permission(
      asPermissionId(props.id),
      props.module,
      props.action,
      props.key,
      props.description ?? null,
    );
  }
}
