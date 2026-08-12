/**
 * Branded ID types.
 *
 * Every aggregate root in the domain model gets its own nominal ID type instead of a
 * bare `string`, so `orderService.get(customerId)` is a compile error instead of a
 * production incident. All IDs are UUIDs (see docs/product/blueprint.md §58).
 */

declare const brand: unique symbol;

/** Nominal-typing helper: attaches a compile-time-only brand to a base type. */
export type Brand<Base, Name extends string> = Base & { readonly [brand]: Name };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * Builds a branded-ID constructor + type guard pair for one entity.
 *
 * @example
 * const { as: asCustomerId, is: isCustomerId } = brandedId<'CustomerId'>();
 * type CustomerId = ReturnType<typeof asCustomerId>;
 */
export function brandedId<Name extends string>(entityName: Name) {
  return {
    /** Casts a raw UUID string to the branded ID type. Throws on malformed input. */
    as: (value: string): Brand<string, Name> => {
      if (!isUuid(value)) {
        throw new TypeError(`Invalid ${entityName}: "${value}" is not a UUID`);
      }
      return value as Brand<string, Name>;
    },
    is: (value: unknown): value is Brand<string, Name> =>
      typeof value === 'string' && isUuid(value),
  };
}

export type UserId = Brand<string, 'UserId'>;
export type CustomerId = Brand<string, 'CustomerId'>;
export type ProductId = Brand<string, 'ProductId'>;
export type ProductVariantId = Brand<string, 'ProductVariantId'>;
export type OrderId = Brand<string, 'OrderId'>;
export type CartId = Brand<string, 'CartId'>;
export type StoreId = Brand<string, 'StoreId'>;
export type WarehouseId = Brand<string, 'WarehouseId'>;
export type PrescriptionId = Brand<string, 'PrescriptionId'>;
export type RoleId = Brand<string, 'RoleId'>;
export type PermissionId = Brand<string, 'PermissionId'>;
export type SessionId = Brand<string, 'SessionId'>;
export type DeviceId = Brand<string, 'DeviceId'>;
export type ApiKeyId = Brand<string, 'ApiKeyId'>;

export const asUserId = brandedId<'UserId'>('UserId').as;
export const asCustomerId = brandedId<'CustomerId'>('CustomerId').as;
export const asProductId = brandedId<'ProductId'>('ProductId').as;
export const asProductVariantId = brandedId<'ProductVariantId'>('ProductVariantId').as;
export const asOrderId = brandedId<'OrderId'>('OrderId').as;
export const asCartId = brandedId<'CartId'>('CartId').as;
export const asStoreId = brandedId<'StoreId'>('StoreId').as;
export const asWarehouseId = brandedId<'WarehouseId'>('WarehouseId').as;
export const asPrescriptionId = brandedId<'PrescriptionId'>('PrescriptionId').as;
export const asRoleId = brandedId<'RoleId'>('RoleId').as;
export const asPermissionId = brandedId<'PermissionId'>('PermissionId').as;
export const asSessionId = brandedId<'SessionId'>('SessionId').as;
export const asDeviceId = brandedId<'DeviceId'>('DeviceId').as;
export const asApiKeyId = brandedId<'ApiKeyId'>('ApiKeyId').as;
