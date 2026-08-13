import type { ShippingMethod } from '../entities/shipping-method.entity';

export const SHIPPING_METHOD_REPOSITORY = Symbol('SHIPPING_METHOD_REPOSITORY');

export interface ShippingMethodRepositoryPort {
  findById(id: string): Promise<ShippingMethod | null>;
  findByCode(code: string): Promise<ShippingMethod | null>;
  listActive(): Promise<ShippingMethod[]>;
}
