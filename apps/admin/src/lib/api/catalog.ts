import type { ProductLifecycleStatus } from '@iecp/types';

import { apiRequest } from './client';

export type { ProductLifecycleStatus };

export interface Product {
  id: string;
  productType: string;
  brandId: string;
  categoryId: string;
  name: string;
  slug: string;
  shortDescription: string | null;
  longDescription: string | null;
  tags: readonly string[];
  status: ProductLifecycleStatus;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ListProductsParams {
  status?: ProductLifecycleStatus;
  search?: string;
  cursor?: string;
  limit?: number;
}

/** Mirrors `ProductController` (`admin/catalog/products`) — real,
 * already-RBAC-gated (`catalog` module read, `catalog.products.*`
 * write), CP-005. */
export async function listProducts(params: ListProductsParams): Promise<Page<Product>> {
  return apiRequest<Page<Product>>('/admin/catalog/products', {
    query: params as Record<string, string | number | undefined>,
  });
}

export async function getProduct(id: string): Promise<Product> {
  return apiRequest<Product>(`/admin/catalog/products/${id}`);
}

export interface UpdateProductInput {
  brandId?: string;
  categoryId?: string;
  name?: string;
  shortDescription?: string | null;
  longDescription?: string | null;
  tags?: string[];
}

export async function updateProduct(id: string, input: UpdateProductInput): Promise<Product> {
  return apiRequest<Product>(`/admin/catalog/products/${id}`, { method: 'PATCH', body: input });
}

export type ProductLifecycleAction =
  'submit-for-review' | 'approve' | 'reject' | 'publish' | 'unpublish' | 'archive';

export async function runProductLifecycleAction(
  id: string,
  action: ProductLifecycleAction,
): Promise<Product> {
  return apiRequest<Product>(`/admin/catalog/products/${id}/${action}`, { method: 'POST' });
}

export interface CatalogOption {
  id: string;
  name: string;
}

export async function listBrands(): Promise<Page<CatalogOption>> {
  return apiRequest<Page<CatalogOption>>('/admin/catalog/brands', { query: { limit: 100 } });
}

export async function listCategories(): Promise<Page<CatalogOption>> {
  return apiRequest<Page<CatalogOption>>('/admin/catalog/categories', { query: { limit: 100 } });
}

export interface Variant {
  id: string;
  productId: string;
  label: string | null;
  color: string | null;
  size: string | null;
}

export interface Sku {
  id: string;
  productId: string;
  variantId: string;
  skuCode: string;
  barcode: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'DISCONTINUED';
}

export async function listVariantsByProduct(productId: string): Promise<Variant[]> {
  return apiRequest<Variant[]>(`/admin/catalog/products/${productId}/variants`);
}

export async function listSkusByProduct(productId: string): Promise<Sku[]> {
  return apiRequest<Sku[]>(`/admin/catalog/products/${productId}/skus`);
}
