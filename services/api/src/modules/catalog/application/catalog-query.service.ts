import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import { Brand } from '../domain/entities/brand.entity';
import { Category } from '../domain/entities/category.entity';
import { Collection } from '../domain/entities/collection.entity';
import { Media } from '../domain/entities/media.entity';
import { ProductPrice } from '../domain/entities/product-price.entity';
import { ProductSku } from '../domain/entities/product-sku.entity';
import { ProductVariant } from '../domain/entities/product-variant.entity';
import { Product } from '../domain/entities/product.entity';
import { BRAND_REPOSITORY, type BrandRepositoryPort } from '../domain/ports/brand.repository.port';
import {
  CATEGORY_REPOSITORY,
  type CategoryRepositoryPort,
} from '../domain/ports/category.repository.port';
import {
  COLLECTION_REPOSITORY,
  type CollectionRepositoryPort,
} from '../domain/ports/collection.repository.port';
import { MEDIA_REPOSITORY, type MediaRepositoryPort } from '../domain/ports/media.repository.port';
import {
  PRICING_REPOSITORY,
  type PricingRepositoryPort,
} from '../domain/ports/pricing.repository.port';
import {
  PRODUCT_MEDIA_REPOSITORY,
  type ProductMediaRepositoryPort,
} from '../domain/ports/product-media.repository.port';
import {
  PRODUCT_SKU_REPOSITORY,
  type ProductSkuRepositoryPort,
} from '../domain/ports/product-sku.repository.port';
import {
  PRODUCT_VARIANT_REPOSITORY,
  type ProductVariantRepositoryPort,
} from '../domain/ports/product-variant.repository.port';
import {
  PRODUCT_REPOSITORY,
  type ListProductsFilter,
  type ProductRepositoryPort,
} from '../domain/ports/product.repository.port';

export interface VariantWithCommerce {
  variant: ProductVariant;
  sku: ProductSku | null;
  price: ProductPrice | null;
}

export interface ProductDetail {
  product: Product;
  brand: Brand | null;
  category: Category | null;
  variants: VariantWithCommerce[];
  media: Media[];
}

/**
 * Storefront read surface (Phase 005 `api_requirements.storefront`) — every
 * method here forces the "only what's actually publicly visible" filter
 * (published status, active status, non-deleted) itself, rather than
 * trusting callers to remember to pass it; the admin services above are
 * the ones that see everything. See `docs/api/catalog.md`.
 */
@Injectable()
export class CatalogQueryService {
  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepositoryPort,
    @Inject(PRODUCT_VARIANT_REPOSITORY) private readonly variants: ProductVariantRepositoryPort,
    @Inject(PRODUCT_SKU_REPOSITORY) private readonly skus: ProductSkuRepositoryPort,
    @Inject(PRICING_REPOSITORY) private readonly pricing: PricingRepositoryPort,
    @Inject(PRODUCT_MEDIA_REPOSITORY) private readonly productMedia: ProductMediaRepositoryPort,
    @Inject(MEDIA_REPOSITORY) private readonly media: MediaRepositoryPort,
    @Inject(CATEGORY_REPOSITORY) private readonly categories: CategoryRepositoryPort,
    @Inject(BRAND_REPOSITORY) private readonly brands: BrandRepositoryPort,
    @Inject(COLLECTION_REPOSITORY) private readonly collections: CollectionRepositoryPort,
  ) {}

  listProducts(
    filter: Omit<ListProductsFilter, 'status'>,
  ): Promise<{ items: Product[]; nextCursor: string | null }> {
    return this.products.list({ ...filter, status: 'PUBLISHED' });
  }

  async getProductDetail(slug: string): Promise<ProductDetail> {
    const product = await this.products.findBySlug(slug);
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    if (product.status !== 'PUBLISHED' || product.deletedAt) {
      throw new NotFoundException('Product not found');
    }

    const [brand, category, variants, productMediaRows] = await Promise.all([
      this.brands.findById(product.brandId),
      this.categories.findById(product.categoryId),
      this.variants.listByProduct(product.id),
      this.productMedia.listByProduct(product.id),
    ]);

    const skus = await Promise.all(variants.map((v) => this.skus.findByVariantId(v.id)));
    const skuIds = skus.filter((s): s is ProductSku => s !== null).map((s) => s.id);
    const prices = await this.pricing.findManyBySkuIds(skuIds);
    const priceBySkuId = new Map(prices.map((p) => [p.productSkuId, p]));

    const variantsWithCommerce: VariantWithCommerce[] = variants.map((variant, index) => {
      const sku = skus[index] ?? null;
      return { variant, sku, price: sku ? (priceBySkuId.get(sku.id) ?? null) : null };
    });

    const mediaIds = [...new Set(productMediaRows.map((pm) => pm.mediaId))];
    const mediaAssets = await this.media.findManyByIds(mediaIds);

    return { product, brand, category, variants: variantsWithCommerce, media: mediaAssets };
  }

  async listCategories(parentId?: string | null): Promise<Category[]> {
    const { items } = await this.categories.list({ parentId, status: 'ACTIVE', limit: 200 });
    return items.filter((c) => c.isPublished);
  }

  async getCategoryBySlug(slug: string): Promise<Category> {
    const category = await this.categories.findBySlug(slug);
    if (!category || !category.isPublished || category.status !== 'ACTIVE') {
      throw new NotFoundException('Category not found');
    }
    return category;
  }

  async listBrands(): Promise<Brand[]> {
    const { items } = await this.brands.list({ status: 'ACTIVE', limit: 200 });
    return items;
  }

  async getBrandBySlug(slug: string): Promise<Brand> {
    const brand = await this.brands.findBySlug(slug);
    if (!brand) {
      throw new NotFoundException('Brand not found');
    }
    if (brand.status !== 'ACTIVE') {
      throw new NotFoundException('Brand not found');
    }
    return brand;
  }

  async listCollections(): Promise<Collection[]> {
    const { items } = await this.collections.list({ status: 'ACTIVE', limit: 200 });
    return items.filter((c) => c.isWithinWindow(new Date()));
  }

  async getCollectionBySlug(slug: string): Promise<Collection> {
    const collection = await this.collections.findBySlug(slug);
    if (!collection) {
      throw new NotFoundException('Collection not found');
    }
    if (collection.status !== 'ACTIVE' || !collection.isWithinWindow(new Date())) {
      throw new NotFoundException('Collection not found');
    }
    return collection;
  }

  async listCollectionMembers(
    slug: string,
    pagination: { cursor?: string; limit: number },
  ): Promise<{ items: string[]; nextCursor: string | null }> {
    const collection = await this.getCollectionBySlug(slug);
    if (collection.type === 'MANUAL') {
      const items = await this.collections.listProductIds(collection.id);
      return { items, nextCursor: null };
    }
    if (!collection.rules) return { items: [], nextCursor: null };
    return this.collections.listDynamicMemberProductIds(collection.rules, pagination);
  }
}
