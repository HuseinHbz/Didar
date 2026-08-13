import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import { AUDIT_LOG_REPOSITORY } from '../identity/domain/ports/audit-log.repository.port';
import { PrismaAuditLogRepository } from '../identity/infrastructure/repositories/prisma-audit-log.repository';

import { AttributesService } from './application/attributes.service';
import { BrandsService } from './application/brands.service';
import { CatalogQueryService } from './application/catalog-query.service';
import { CategoriesService } from './application/categories.service';
import { CollectionsService } from './application/collections.service';
import { MediaService } from './application/media.service';
import { PricingService } from './application/pricing.service';
import { ProductsService } from './application/products.service';
import { SkusService } from './application/skus.service';
import { VariantsService } from './application/variants.service';
import { ATTRIBUTE_REPOSITORY } from './domain/ports/attribute.repository.port';
import { BRAND_REPOSITORY } from './domain/ports/brand.repository.port';
import { CATEGORY_REPOSITORY } from './domain/ports/category.repository.port';
import { COLLECTION_REPOSITORY } from './domain/ports/collection.repository.port';
import { MEDIA_REPOSITORY } from './domain/ports/media.repository.port';
import { PRICING_REPOSITORY } from './domain/ports/pricing.repository.port';
import { PRODUCT_MEDIA_REPOSITORY } from './domain/ports/product-media.repository.port';
import { PRODUCT_SKU_REPOSITORY } from './domain/ports/product-sku.repository.port';
import { PRODUCT_VARIANT_REPOSITORY } from './domain/ports/product-variant.repository.port';
import { PRODUCT_REPOSITORY } from './domain/ports/product.repository.port';
import { PrismaAttributeRepository } from './infrastructure/repositories/prisma-attribute.repository';
import { PrismaBrandRepository } from './infrastructure/repositories/prisma-brand.repository';
import { PrismaCategoryRepository } from './infrastructure/repositories/prisma-category.repository';
import { PrismaCollectionRepository } from './infrastructure/repositories/prisma-collection.repository';
import { PrismaMediaRepository } from './infrastructure/repositories/prisma-media.repository';
import { PrismaPricingRepository } from './infrastructure/repositories/prisma-pricing.repository';
import { PrismaProductMediaRepository } from './infrastructure/repositories/prisma-product-media.repository';
import { PrismaProductSkuRepository } from './infrastructure/repositories/prisma-product-sku.repository';
import { PrismaProductVariantRepository } from './infrastructure/repositories/prisma-product-variant.repository';
import { PrismaProductRepository } from './infrastructure/repositories/prisma-product.repository';
import { AttributeController } from './presentation/controllers/attribute.controller';
import { BrandController } from './presentation/controllers/brand.controller';
import { CatalogPublicController } from './presentation/controllers/catalog-public.controller';
import { CategoryController } from './presentation/controllers/category.controller';
import { CollectionController } from './presentation/controllers/collection.controller';
import { MediaController } from './presentation/controllers/media.controller';
import { PricingController } from './presentation/controllers/pricing.controller';
import { ProductController } from './presentation/controllers/product.controller';
import { VariantSkuController } from './presentation/controllers/variant-sku.controller';
import { CatalogDomainExceptionFilter } from './presentation/filters/catalog-domain-exception.filter';

/**
 * Composition root for the catalog domain (Phase 005 — see this module's
 * README and docs/adr/ADR-005-catalog-architecture.md). Every port token
 * below is bound to its Prisma implementation here, same convention as
 * `identity.module.ts`; this module registers no new *guards* — the global
 * `JwtAuthGuard`/`AuthorizationGuard` IdentityModule already installs
 * app-wide cover every route here too (`@Public()` opts the storefront
 * controller out, `@RequirePermission`/`@RequireModule` gate the admin
 * ones). It does register one `APP_FILTER` (`CatalogDomainExceptionFilter`)
 * mapping this module's own domain-layer error types to real HTTP status
 * codes — see that file's doc comment. `AUDIT_LOG_REPOSITORY` is re-bound
 * here (not imported from IdentityModule) since the underlying
 * `PrismaAuditLogRepository` is a stateless wrapper over the shared
 * `prisma` singleton — cheap to instantiate per module, and keeps this
 * module's dependency graph self-contained rather than reaching into
 * IdentityModule's internals.
 */
@Module({
  controllers: [
    BrandController,
    CategoryController,
    CollectionController,
    ProductController,
    VariantSkuController,
    MediaController,
    AttributeController,
    PricingController,
    CatalogPublicController,
  ],
  providers: [
    BrandsService,
    CategoriesService,
    CollectionsService,
    ProductsService,
    VariantsService,
    SkusService,
    MediaService,
    AttributesService,
    PricingService,
    CatalogQueryService,
    { provide: BRAND_REPOSITORY, useClass: PrismaBrandRepository },
    { provide: CATEGORY_REPOSITORY, useClass: PrismaCategoryRepository },
    { provide: COLLECTION_REPOSITORY, useClass: PrismaCollectionRepository },
    { provide: PRODUCT_REPOSITORY, useClass: PrismaProductRepository },
    { provide: PRODUCT_VARIANT_REPOSITORY, useClass: PrismaProductVariantRepository },
    { provide: PRODUCT_SKU_REPOSITORY, useClass: PrismaProductSkuRepository },
    { provide: MEDIA_REPOSITORY, useClass: PrismaMediaRepository },
    { provide: PRODUCT_MEDIA_REPOSITORY, useClass: PrismaProductMediaRepository },
    { provide: ATTRIBUTE_REPOSITORY, useClass: PrismaAttributeRepository },
    { provide: PRICING_REPOSITORY, useClass: PrismaPricingRepository },
    { provide: AUDIT_LOG_REPOSITORY, useClass: PrismaAuditLogRepository },
    { provide: APP_FILTER, useClass: CatalogDomainExceptionFilter },
  ],
  // Phase 007 (ADR-007 decision 5) — `ProductsService`/`SkusService`/
  // `PricingService` are exported so `CartCheckoutModule` can import this
  // module and inject them directly (real lifecycle-status/price reads,
  // not re-derived). Additive, behavior-preserving.
  exports: [ProductsService, SkusService, PricingService],
})
export class CatalogModule {}
