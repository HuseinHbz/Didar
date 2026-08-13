/**
 * Development seed script (blueprint §107): admin user, demo customer, brand/
 * category/product/variant, warehouse stock, a coupon, CMS basics, and system
 * settings — one small, coherent slice through every one of the 11 domain
 * schemas rather than exhaustive fixtures for each.
 *
 * Idempotent by design (`upsert` throughout, keyed on each model's real
 * unique constraint) — safe to run against a freshly-migrated database or a
 * database that already has this seed data; re-running never duplicates rows
 * or throws on a unique-constraint violation.
 *
 * Run with: `pnpm --filter @iecp/database seed`
 */
import { createHash, randomUUID } from 'node:crypto';

import { prisma } from '../src/client.js';

/** SHA-256 — mirrors services/api's identity module hash convention for
 * high-entropy random secrets (see that module's infrastructure/crypto/hash.util.ts
 * for the full rationale). Reimplemented here, not imported: seed.ts is a
 * standalone script against `packages/database`, and importing from
 * `services/api` would invert the monorepo's dependency direction
 * (services depend on packages, never the other way around). */
function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function main(): Promise<void> {
  // ---------------------------------------------------------------------
  // identity — the real permission registry (matching what
  // services/api's identity module actually checks via @RequirePermission/
  // @RequireModule/@FieldPermissions — see that module's README), a role
  // hierarchy demonstrating inheritance, and a per-user override
  // demonstrating blueprint §53's "Product.Publish = NO" pattern.
  // ---------------------------------------------------------------------
  const permissionDefs = [
    {
      module: 'identity',
      action: 'roles.manage',
      description: 'Create/edit roles, assign/unassign them to users',
    },
    {
      module: 'identity',
      action: 'permissions.manage',
      description: 'Set/clear per-user permission overrides',
    },
    { module: 'identity', action: 'audit_logs.view', description: 'Read the system audit log' },
    {
      module: 'identity',
      action: 'users.view_contact',
      description: "See a user's phone/email on GET /users/:id (field-level permission demo)",
    },
    // catalog (Phase 005) — matching what services/api's catalog module
    // actually checks via @RequirePermission (see that module's README).
    { module: 'catalog', action: 'brands.create', description: 'Create a brand' },
    { module: 'catalog', action: 'brands.update', description: 'Edit a brand' },
    { module: 'catalog', action: 'brands.delete', description: 'Delete a brand (must be unused)' },
    { module: 'catalog', action: 'categories.create', description: 'Create a category' },
    {
      module: 'catalog',
      action: 'categories.update',
      description: 'Edit a category, including publish/unpublish',
    },
    {
      module: 'catalog',
      action: 'categories.delete',
      description: 'Delete a category (must be a leaf, unused)',
    },
    { module: 'catalog', action: 'collections.create', description: 'Create a collection' },
    {
      module: 'catalog',
      action: 'collections.update',
      description: 'Edit a collection or its MANUAL membership',
    },
    { module: 'catalog', action: 'collections.delete', description: 'Delete a collection' },
    { module: 'catalog', action: 'products.create', description: 'Create a product' },
    { module: 'catalog', action: 'products.update', description: 'Edit a product’s content' },
    {
      module: 'catalog',
      action: 'products.delete',
      description: 'Delete a DRAFT/ARCHIVED product',
    },
    {
      module: 'catalog',
      action: 'products.approve',
      description: 'Submit for review / approve / reject a product (lifecycle)',
    },
    {
      module: 'catalog',
      action: 'products.publish',
      description: 'Publish/unpublish a product',
    },
    { module: 'catalog', action: 'products.archive', description: 'Archive a product' },
    {
      module: 'catalog',
      action: 'products.bulk',
      description: 'Bulk publish/archive up to 200 products in one request',
    },
    {
      module: 'catalog',
      action: 'variants.manage',
      description: 'Create/edit/delete product variants',
    },
    { module: 'catalog', action: 'skus.manage', description: 'Create/edit/delete product SKUs' },
    {
      module: 'catalog',
      action: 'media.manage',
      description: 'Register media assets and attach/detach/reorder them on products',
    },
    {
      module: 'catalog',
      action: 'attributes.manage',
      description: 'Create attributes/values and assign them to variants',
    },
    {
      module: 'catalog',
      action: 'pricing.manage',
      description: "Set a SKU's price (writes finance.PriceHistory + an audit log row)",
    },
    // inventory (Phase 006) — matching what services/api's inventory module
    // actually checks via @RequirePermission/@RequireModule (see that
    // module's README and docs/security/inventory-security.md).
    {
      module: 'inventory',
      action: 'read',
      description: 'Read stock, locations, and inventory items',
    },
    {
      module: 'inventory',
      action: 'create',
      description: 'Create locations and other inventory records',
    },
    {
      module: 'inventory',
      action: 'update',
      description: 'Update inventory records, incl. low-stock thresholds',
    },
    {
      module: 'inventory',
      action: 'adjust',
      description: 'Create a manual stock adjustment (permission-controlled + audited)',
    },
    {
      module: 'inventory',
      action: 'transfer.create',
      description: 'Create a warehouse stock transfer',
    },
    {
      module: 'inventory',
      action: 'transfer.approve',
      description: 'Approve a requested stock transfer',
    },
    {
      module: 'inventory',
      action: 'transfer.dispatch',
      description: 'Dispatch an approved stock transfer',
    },
    {
      module: 'inventory',
      action: 'transfer.receive',
      description: 'Receive a dispatched stock transfer',
    },
    { module: 'inventory', action: 'count.create', description: 'Create and submit a stock count' },
    {
      module: 'inventory',
      action: 'count.approve',
      description: 'Approve a submitted stock count (reconciles variance into the ledger)',
    },
    {
      module: 'inventory',
      action: 'ledger.read',
      description: 'Read the append-only inventory ledger',
    },
    {
      module: 'inventory',
      action: 'warehouse.manage',
      description: 'Create/edit warehouses and locations',
    },
    { module: 'inventory', action: 'low_stock.read', description: 'Read the low-stock report' },
  ];
  const permissions = await Promise.all(
    permissionDefs.map((def) =>
      prisma.permission.upsert({
        where: { key: `${def.module}.${def.action}` },
        update: { description: def.description },
        create: { ...def, key: `${def.module}.${def.action}` },
      }),
    ),
  );
  const permissionByKey = new Map(permissions.map((permission) => [permission.key, permission]));

  // Convergent, not just additive: any permission NOT in `permissionDefs`
  // above gets deleted — including Phase 001/003's placeholder
  // `product.publish`/`order.manage`/`refund.approve`/`user.manage`, which
  // predate this module and were never checked by any real guard. Deleting
  // them cascades (schema.prisma: onDelete: Cascade) to remove any
  // RolePermission/UserPermissionOverride rows referencing them too — a
  // stale grant to a permission nothing enforces is worse than no grant.
  await prisma.permission.deleteMany({
    where: { key: { notIn: permissions.map((permission) => permission.key) } },
  });
  const grant = (roleId: string, permissionKey: string) => {
    const permission = permissionByKey.get(permissionKey);
    if (!permission) {
      throw new Error(`[seed] unknown permission key: ${permissionKey}`);
    }
    return prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId, permissionId: permission.id } },
      update: {},
      create: { roleId, permissionId: permission.id },
    });
  };

  // Role tree: admin -> support_agent (admin inherits support_agent's
  // grant, plus its own three — PermissionResolver.resolve walks this via
  // RoleRepositoryPort.getEffectiveRoleIds). customer stays a separate,
  // unrelated root — storefront customers have no identity-module access.
  const supportAgentRole = await prisma.role.upsert({
    where: { name: 'support_agent' },
    update: { description: 'Front-line support — can see customer contact info' },
    create: {
      name: 'support_agent',
      description: 'Front-line support — can see customer contact info',
    },
  });
  const adminRoleDefaults = {
    description: 'Full identity + catalog + inventory module access',
    isSystem: true,
    parentId: supportAgentRole.id,
  };
  const adminRole = await prisma.role.upsert({
    where: { name: 'admin' },
    // A role created by an OLDER version of this seed script (e.g. Phase
    // 001/003, before `parentId` existed) would otherwise keep its
    // pre-hierarchy state forever — `upsert` only applies `create` on
    // first insert. Every field this script cares about goes in `update`
    // too, so re-running always converges an existing row to the current
    // desired shape, not just the shape it happened to have when created.
    update: adminRoleDefaults,
    create: { name: 'admin', ...adminRoleDefaults },
  });
  const customerRole = await prisma.role.upsert({
    where: { name: 'customer' },
    update: { description: 'Storefront customer' },
    create: { name: 'customer', description: 'Storefront customer', isSystem: true },
  });

  await grant(supportAgentRole.id, 'identity.users.view_contact');
  await grant(adminRole.id, 'identity.roles.manage');
  await grant(adminRole.id, 'identity.permissions.manage');
  await grant(adminRole.id, 'identity.audit_logs.view');
  // admin gets every catalog.*/inventory.* permission — the module-access
  // gate (@RequireModule) and every @RequirePermission check both pass for
  // admin, same as identity's own endpoints.
  for (const def of permissionDefs) {
    if (def.module === 'catalog' || def.module === 'inventory') {
      await grant(adminRole.id, `${def.module}.${def.action}`);
    }
  }

  // A second, non-inheriting role — a content editor who can create/edit
  // catalog entities but can't delete, approve/publish, or touch pricing.
  // This is what makes the e2e suite's "permission bypass" tests for
  // catalog real: logging in as this user and calling POST .../publish
  // must 403, not merely "not be tested."
  const catalogEditorRole = await prisma.role.upsert({
    where: { name: 'catalog_editor' },
    update: { description: 'Can author catalog content; cannot publish, delete, or set prices' },
    create: {
      name: 'catalog_editor',
      description: 'Can author catalog content; cannot publish, delete, or set prices',
    },
  });
  for (const action of [
    'brands.create',
    'brands.update',
    'categories.create',
    'categories.update',
    'products.create',
    'products.update',
    'variants.manage',
    'skus.manage',
    'media.manage',
    'attributes.manage',
  ]) {
    await grant(catalogEditorRole.id, `catalog.${action}`);
  }

  // Four inventory roles (Phase 006 — docs/security/inventory-security.md
  // has the full matrix). Each is a real least-privilege boundary, not a
  // label: `inventory_manager` gets every inventory.* permission (a
  // department head); `warehouse_operator`/`store_manager` get the
  // day-to-day floor actions but neither gets `adjust`/`transfer.approve`/
  // `count.approve` — the brief's own rule that "warehouse operators
  // cannot approve their own sensitive adjustments" is enforced by simply
  // never granting that permission to the floor-level role, not by an
  // extra runtime check; `inventory_auditor` is read-only.
  const inventoryManagerRole = await prisma.role.upsert({
    where: { name: 'inventory_manager' },
    update: { description: 'Full inventory module access — every inventory.* permission' },
    create: {
      name: 'inventory_manager',
      description: 'Full inventory module access — every inventory.* permission',
    },
  });
  for (const def of permissionDefs) {
    if (def.module === 'inventory') {
      await grant(inventoryManagerRole.id, `inventory.${def.action}`);
    }
  }

  const warehouseOperatorRole = await prisma.role.upsert({
    where: { name: 'warehouse_operator' },
    update: {
      description:
        'Warehouse floor operations — dispatch/receive transfers, submit counts; cannot adjust stock or approve anything',
    },
    create: {
      name: 'warehouse_operator',
      description:
        'Warehouse floor operations — dispatch/receive transfers, submit counts; cannot adjust stock or approve anything',
    },
  });
  for (const action of [
    'read',
    'create',
    'transfer.dispatch',
    'transfer.receive',
    'count.create',
    'low_stock.read',
  ]) {
    await grant(warehouseOperatorRole.id, `inventory.${action}`);
  }

  const storeManagerRole = await prisma.role.upsert({
    where: { name: 'store_manager' },
    update: {
      description:
        'Store-level inventory — can adjust and reconcile counts for their own store; cannot approve transfers',
    },
    create: {
      name: 'store_manager',
      description:
        'Store-level inventory — can adjust and reconcile counts for their own store; cannot approve transfers',
    },
  });
  for (const action of [
    'read',
    'adjust',
    'transfer.receive',
    'count.create',
    'count.approve',
    'low_stock.read',
  ]) {
    await grant(storeManagerRole.id, `inventory.${action}`);
  }

  const inventoryAuditorRole = await prisma.role.upsert({
    where: { name: 'inventory_auditor' },
    update: { description: 'Read-only — stock, ledger, and low-stock visibility, no mutations' },
    create: {
      name: 'inventory_auditor',
      description: 'Read-only — stock, ledger, and low-stock visibility, no mutations',
    },
  });
  for (const action of ['read', 'ledger.read', 'low_stock.read']) {
    await grant(inventoryAuditorRole.id, `inventory.${action}`);
  }

  const adminUser = await prisma.user.upsert({
    where: { phone: '+989120000001' },
    update: {},
    create: {
      phone: '+989120000001',
      email: 'admin@iecp.dev',
      isActive: true,
      phoneVerifiedAt: new Date(),
    },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: adminUser.id, roleId: adminRole.id } },
    update: {},
    create: { userId: adminUser.id, roleId: adminRole.id },
  });

  const customerUser = await prisma.user.upsert({
    where: { phone: '+989120000002' },
    update: {},
    create: {
      phone: '+989120000002',
      email: 'customer@iecp.dev',
      isActive: true,
      phoneVerifiedAt: new Date(),
    },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: customerUser.id, roleId: customerRole.id } },
    update: {},
    create: { userId: customerUser.id, roleId: customerRole.id },
  });

  // Third user: support_agent role (grants identity.users.view_contact via
  // the role) but with an explicit per-user DENY override on that exact
  // permission — the blueprint §53 exception pattern. Effective permissions
  // for this user should resolve to the EMPTY set, proving deny-wins over
  // a role-derived grant (see PermissionResolver.resolve and its unit test).
  const supportUser = await prisma.user.upsert({
    where: { phone: '+989120000003' },
    update: {},
    create: {
      phone: '+989120000003',
      email: 'support@iecp.dev',
      isActive: true,
      phoneVerifiedAt: new Date(),
    },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: supportUser.id, roleId: supportAgentRole.id } },
    update: {},
    create: { userId: supportUser.id, roleId: supportAgentRole.id },
  });
  const viewContactPermission = permissionByKey.get('identity.users.view_contact');
  if (!viewContactPermission) {
    throw new Error('[seed] identity.users.view_contact permission missing after upsert');
  }
  await prisma.userPermissionOverride.upsert({
    where: {
      userId_permissionId: { userId: supportUser.id, permissionId: viewContactPermission.id },
    },
    update: {},
    create: {
      userId: supportUser.id,
      permissionId: viewContactPermission.id,
      effect: 'DENY',
      reason:
        'Under investigation for a contact-data-handling incident — access suspended pending review.',
      createdBy: adminUser.id,
    },
  });

  // Fourth user: catalog_editor role only — real fixture for the e2e
  // suite's catalog permission-bypass case (can create a product, cannot
  // publish/delete/set a price).
  const catalogEditorUser = await prisma.user.upsert({
    where: { phone: '+989120000004' },
    update: {},
    create: {
      phone: '+989120000004',
      email: 'catalog-editor@iecp.dev',
      isActive: true,
      phoneVerifiedAt: new Date(),
    },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: catalogEditorUser.id, roleId: catalogEditorRole.id } },
    update: {},
    create: { userId: catalogEditorUser.id, roleId: catalogEditorRole.id },
  });

  // Fifth-eighth users: one per inventory role — real fixtures for the
  // e2e suite's inventory permission-bypass cases (e.g. warehouse_operator
  // calling POST .../adjustments or .../approve must 403).
  const inventoryRoleUsers: [string, string, string][] = [
    ['+989120000005', 'inventory-manager@iecp.dev', inventoryManagerRole.id],
    ['+989120000006', 'warehouse-operator@iecp.dev', warehouseOperatorRole.id],
    ['+989120000007', 'store-manager@iecp.dev', storeManagerRole.id],
    ['+989120000008', 'inventory-auditor@iecp.dev', inventoryAuditorRole.id],
  ];
  for (const [phone, email, roleId] of inventoryRoleUsers) {
    const user = await prisma.user.upsert({
      where: { phone },
      update: {},
      create: { phone, email, isActive: true, phoneVerifiedAt: new Date() },
    });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId } },
      update: {},
      create: { userId: user.id, roleId },
    });
  }

  // A trusted device + an active-looking session for the admin user (blueprint
  // §56 "Device Trust") — session data itself is normally created by a real
  // login (services/api's CompleteLoginService), not seeded, but one example
  // row here lets `GET /me/devices`/`GET /me/sessions` show something on a
  // freshly-seeded database before anyone has actually logged in.
  const adminDevice = await prisma.userDevice.upsert({
    where: { userId_fingerprint: { userId: adminUser.id, fingerprint: 'seed-admin-macbook' } },
    update: {},
    create: {
      userId: adminUser.id,
      fingerprint: 'seed-admin-macbook',
      label: "Admin's MacBook",
      platform: 'web',
      trustedAt: new Date(),
    },
  });

  // A revoked demo API key — `keyHash` is the sha256 of a fixed, published
  // dev-only value ("iecp_dev_seed_demo_key"); it's pre-revoked specifically
  // so this seed can never accidentally hand out a working credential.
  await prisma.apiKey.upsert({
    where: { keyHash: sha256Hex('iecp_dev_seed_demo_key') },
    update: {},
    create: {
      name: 'Seed demo key (revoked)',
      keyHash: sha256Hex('iecp_dev_seed_demo_key'),
      ownerId: adminUser.id,
      scopes: ['read:catalog'],
      revokedAt: new Date(),
    },
  });

  // A couple of append-only identity.security_events and one system.audit_logs
  // row — both are normally written by real use cases (SecurityEventRepositoryPort,
  // AuditLogRepositoryPort), seeded here only so the two read endpoints
  // (GET /audit-log, and any future security-events endpoint) have example
  // rows on a fresh database.
  const existingLoginEvent = await prisma.securityEvent.findFirst({
    where: { userId: adminUser.id, type: 'LOGIN_SUCCESS' },
  });
  if (!existingLoginEvent) {
    await prisma.securityEvent.create({
      data: {
        userId: adminUser.id,
        type: 'LOGIN_SUCCESS',
        ipAddress: '127.0.0.1',
        userAgent: 'seed-script',
      },
    });
  }
  const existingAuditEntry = await prisma.auditLog.findFirst({
    where: { entityType: 'Role', entityId: adminRole.id, action: 'ROLE_PERMISSION_GRANTED' },
  });
  if (!existingAuditEntry) {
    await prisma.auditLog.create({
      data: {
        actorId: adminUser.id,
        actorDevice: adminDevice.id,
        action: 'ROLE_PERMISSION_GRANTED',
        entityType: 'Role',
        entityId: adminRole.id,
        oldValue: { permissions: [] },
        newValue: {
          permissions: [
            'identity.roles.manage',
            'identity.permissions.manage',
            'identity.audit_logs.view',
          ],
        },
      },
    });
  }

  // ---------------------------------------------------------------------
  // customer — profile, address, loyalty + wallet accounts
  // ---------------------------------------------------------------------
  const customer = await prisma.customer.upsert({
    where: { userId: customerUser.id },
    update: {},
    create: {
      userId: customerUser.id,
      firstName: 'Sara',
      lastName: 'Ahmadi',
      gender: 'FEMALE',
    },
  });

  await prisma.customerAddress.upsert({
    where: { id: '00000000-0000-4000-8000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-4000-8000-000000000001',
      customerId: customer.id,
      label: 'خانه',
      recipientName: 'Sara Ahmadi',
      phone: '+989120000002',
      province: 'Tehran',
      city: 'Tehran',
      addressLine1: 'Valiasr St, No. 100',
      isDefault: true,
    },
  });

  await prisma.loyaltyAccount.upsert({
    where: { customerId: customer.id },
    update: {},
    create: { customerId: customer.id, pointsBalance: 0, tier: 'BRONZE' },
  });
  await prisma.walletAccount.upsert({
    where: { customerId: customer.id },
    update: {},
    create: { customerId: customer.id, balance: 0n, currency: 'IRR' },
  });

  // ---------------------------------------------------------------------
  // catalog (Phase 005 — see docs/adr/ADR-005-catalog-architecture.md):
  // brand, category, a PUBLISHED product (variant + SKU + price + media +
  // a MANUAL collection) and a DRAFT product (proves the storefront never
  // shows what isn't published), attribute, lens lookups.
  // ---------------------------------------------------------------------
  const brand = await prisma.brand.upsert({
    where: { slug: 'ray-ban' },
    update: { name: 'Ray-Ban', status: 'ACTIVE' },
    create: {
      name: 'Ray-Ban',
      slug: 'ray-ban',
      localizedName: { fa: 'ری‌بن', en: 'Ray-Ban' },
      status: 'ACTIVE',
    },
  });

  const category = await prisma.category.upsert({
    where: { slug: 'sunglasses' },
    update: { name: 'عینک آفتابی', status: 'ACTIVE', publishedAt: new Date() },
    create: {
      name: 'عینک آفتابی',
      slug: 'sunglasses',
      localizedName: { fa: 'عینک آفتابی', en: 'Sunglasses' },
      status: 'ACTIVE',
      publishedAt: new Date(),
    },
  });

  const colorAttribute = await prisma.productAttribute.upsert({
    where: { key: 'frame_color' },
    update: {},
    create: {
      key: 'frame_color',
      name: 'رنگ فریم',
      localizedName: { fa: 'رنگ فریم', en: 'Frame color' },
    },
  });
  const goldValue = await prisma.productAttributeValue.upsert({
    where: { attributeId_value: { attributeId: colorAttribute.id, value: 'Gold' } },
    update: {},
    create: { attributeId: colorAttribute.id, value: 'Gold' },
  });

  // --- Product 1: PUBLISHED, full variant/SKU/price/media/collection chain ---
  const product = await prisma.product.upsert({
    where: { slug: 'ray-ban-aviator-classic' },
    update: {
      status: 'PUBLISHED',
      publishedAt: new Date(),
      approvedBy: adminUser.id,
      approvedAt: new Date(),
    },
    create: {
      brandId: brand.id,
      categoryId: category.id,
      productType: 'SUNGLASSES',
      name: 'Ray-Ban Aviator Classic',
      slug: 'ray-ban-aviator-classic',
      longDescription: 'The original pilot sunglasses, unchanged since 1937.',
      tags: ['classic', 'metal-frame'],
      status: 'PUBLISHED',
      publishedAt: new Date(),
      approvedBy: adminUser.id,
      approvedAt: new Date(),
    },
  });

  // ProductVariant has no business-unique key of its own (color+size isn't
  // declared unique — two colorways could share a size), so a fixed seed id
  // isn't safe to upsert by: a database that already has a default variant
  // for this product under a *different* id (e.g. one created by an older
  // version of this script, or by hand through the admin API) would end up
  // with two "default" variants instead of one converged row. Find the
  // product's actual current default variant, if any, and update that.
  const variantDefaults = {
    color: 'Gold',
    size: '58mm',
    gender: 'UNISEX' as const,
    frameShape: 'Aviator',
    frameMaterial: 'Metal',
    isDefault: true,
    status: 'ACTIVE' as const,
  };
  const existingVariant = await prisma.productVariant.findFirst({
    where: { productId: product.id, isDefault: true },
  });
  const variant = existingVariant
    ? await prisma.productVariant.update({
        where: { id: existingVariant.id },
        data: variantDefaults,
      })
    : await prisma.productVariant.create({ data: { productId: product.id, ...variantDefaults } });
  await prisma.productVariantAttributeValue.upsert({
    where: {
      variantId_attributeValueId: { variantId: variant.id, attributeValueId: goldValue.id },
    },
    update: {},
    create: { variantId: variant.id, attributeValueId: goldValue.id },
  });

  const sku = await prisma.productSku.upsert({
    where: { skuCode: 'RB-AVIATOR-001-GOLD-58' },
    update: {},
    create: {
      productId: product.id,
      variantId: variant.id,
      skuCode: 'RB-AVIATOR-001-GOLD-58',
      weightGrams: 31,
      taxRateBasisPoints: 900,
    },
  });

  await prisma.lensType.upsert({
    where: { name: 'Single Vision' },
    update: {},
    create: { name: 'Single Vision', description: 'Standard single-focus lens' },
  });
  await prisma.lensCoating.upsert({
    where: { name: 'Anti-Reflective' },
    update: {},
    create: { name: 'Anti-Reflective', description: 'Reduces glare and reflections' },
  });

  // --- Product 2: DRAFT — never returned by the storefront (CatalogQueryService
  // always filters status = PUBLISHED); proves that filter is real, not just
  // documented. ---
  const draftProduct = await prisma.product.upsert({
    where: { slug: 'ray-ban-wayfarer-classic' },
    update: {},
    create: {
      brandId: brand.id,
      categoryId: category.id,
      productType: 'SUNGLASSES',
      name: 'Ray-Ban Wayfarer Classic',
      slug: 'ray-ban-wayfarer-classic',
      longDescription: 'Still being reviewed before going live.',
      tags: ['classic', 'acetate-frame'],
      status: 'DRAFT',
    },
  });
  const draftVariantDefaults = {
    color: 'Black',
    size: '50mm',
    gender: 'UNISEX' as const,
    frameMaterial: 'Acetate',
    isDefault: true,
    status: 'ACTIVE' as const,
  };
  const existingDraftVariant = await prisma.productVariant.findFirst({
    where: { productId: draftProduct.id, isDefault: true },
  });
  const draftVariant = existingDraftVariant
    ? await prisma.productVariant.update({
        where: { id: existingDraftVariant.id },
        data: draftVariantDefaults,
      })
    : await prisma.productVariant.create({
        data: { productId: draftProduct.id, ...draftVariantDefaults },
      });
  const draftSku = await prisma.productSku.upsert({
    where: { skuCode: 'RB-WAYFARER-001-BLACK-50' },
    update: {},
    create: {
      productId: draftProduct.id,
      variantId: draftVariant.id,
      skuCode: 'RB-WAYFARER-001-BLACK-50',
      weightGrams: 45,
    },
  });

  // --- media — a product image, PRIMARY on the published product ---
  const productMedia = await prisma.media.upsert({
    where: { storageKey: 'seed/ray-ban-aviator-classic/primary.jpg' },
    update: {},
    create: {
      provider: 'LOCAL',
      storageKey: 'seed/ray-ban-aviator-classic/primary.jpg',
      url: 'https://cdn.example.com/seed/ray-ban-aviator-classic/primary.jpg',
      kind: 'IMAGE',
      mimeType: 'image/jpeg',
      width: 1200,
      height: 1200,
      altText: { fa: 'عینک آفتابی ری‌بن آویاتور کلاسیک', en: 'Ray-Ban Aviator Classic sunglasses' },
    },
  });
  const existingProductMedia = await prisma.productMedia.findFirst({
    where: { productId: product.id, mediaId: productMedia.id },
  });
  if (!existingProductMedia) {
    await prisma.productMedia.create({
      data: { productId: product.id, mediaId: productMedia.id, role: 'PRIMARY', sortOrder: 0 },
    });
  }

  // --- a MANUAL "featured" collection containing the published product ---
  const featuredCollection = await prisma.collection.upsert({
    where: { slug: 'featured' },
    update: { status: 'ACTIVE', publishedAt: new Date() },
    create: {
      name: 'Featured',
      slug: 'featured',
      localizedName: { fa: 'ویژه', en: 'Featured' },
      type: 'MANUAL',
      status: 'ACTIVE',
      publishedAt: new Date(),
    },
  });
  await prisma.collectionProduct.upsert({
    where: {
      collectionId_productId: { collectionId: featuredCollection.id, productId: product.id },
    },
    update: {},
    create: { collectionId: featuredCollection.id, productId: product.id, sortOrder: 0 },
  });

  // ---------------------------------------------------------------------
  // finance — the SKU's price (Rial, BigInt — never Float; Phase 005
  // keys ProductPrice off productSkuId, not productVariantId — ADR-005).
  // ---------------------------------------------------------------------
  await prisma.productPrice.upsert({
    where: { productSkuId: sku.id },
    update: {},
    create: {
      productSkuId: sku.id,
      basePrice: 12_500_000n,
      costPrice: 8_000_000n,
      currency: 'IRR',
    },
  });

  // ---------------------------------------------------------------------
  // inventory (Phase 006 — see docs/adr/ADR-006-inventory-architecture.md):
  // two warehouses (one CENTRAL, one STORE), three locations, stock for
  // both seeded SKUs, a reserved-stock example, a low-stock example (via
  // InventoryThreshold), a REQUESTED stock transfer, and the
  // InventoryLedger history that explains every one of those quantities —
  // the brief's own "at least" list for this phase's seed data.
  // ---------------------------------------------------------------------
  const warehouseCentral = await prisma.warehouse.upsert({
    where: { code: 'WH-TEHRAN-01' },
    update: { type: 'CENTRAL', status: 'ACTIVE' },
    create: {
      code: 'WH-TEHRAN-01',
      name: 'Tehran Main Warehouse',
      type: 'CENTRAL',
      status: 'ACTIVE',
      address: 'Tehran, Iran',
    },
  });
  const warehouseStore = await prisma.warehouse.upsert({
    where: { code: 'WH-TEHRAN-STORE-01' },
    update: { type: 'STORE', status: 'ACTIVE' },
    create: {
      code: 'WH-TEHRAN-STORE-01',
      name: 'Tehran Flagship Store',
      type: 'STORE',
      status: 'ACTIVE',
      address: 'Vali Asr St, Tehran, Iran',
    },
  });

  const locMain = await prisma.warehouseLocation.upsert({
    where: { warehouseId_code: { warehouseId: warehouseCentral.id, code: 'MAIN' } },
    update: {},
    create: {
      warehouseId: warehouseCentral.id,
      code: 'MAIN',
      name: 'Main Storage',
      type: 'STORAGE',
    },
  });
  // RECV exists to satisfy "at least three locations" and to give a
  // receiving-dock example; nothing is stocked there in this fixture.
  await prisma.warehouseLocation.upsert({
    where: { warehouseId_code: { warehouseId: warehouseCentral.id, code: 'RECV' } },
    update: {},
    create: {
      warehouseId: warehouseCentral.id,
      code: 'RECV',
      name: 'Receiving Dock',
      type: 'RECEIVING',
    },
  });
  const locFloor = await prisma.warehouseLocation.upsert({
    where: { warehouseId_code: { warehouseId: warehouseStore.id, code: 'FLOOR' } },
    update: {},
    create: { warehouseId: warehouseStore.id, code: 'FLOOR', name: 'Sales Floor', type: 'STORAGE' },
  });

  /** Upserts one InventoryItem to an exact quantity state and, only on
   * first creation, an InventoryLedger PURCHASE_RECEIPT row explaining it
   * — same idempotency shape the old Phase 003 inventoryTransaction
   * fixture used (a reference-keyed existence check), generalized to the
   * new ledger table. `referenceId` is `@db.Uuid`, so the item's own id
   * (deterministic given the upsert above) is the natural idempotency key
   * — not a human-readable string. */
  const seedStock = async (
    productSkuId: string,
    warehouseId: string,
    locationId: string,
    onHandQuantity: number,
    reservedQuantity: number,
  ) => {
    const item = await prisma.inventoryItem.upsert({
      where: { productSkuId_warehouseId_locationId: { productSkuId, warehouseId, locationId } },
      update: {
        onHandQuantity,
        reservedQuantity,
        availableQuantity: onHandQuantity - reservedQuantity,
      },
      create: {
        id: randomUUID(),
        productSkuId,
        warehouseId,
        locationId,
        onHandQuantity,
        reservedQuantity,
        availableQuantity: onHandQuantity - reservedQuantity,
      },
    });
    const existingReceipt = await prisma.inventoryLedger.findFirst({
      where: { referenceType: 'SEED_INITIAL_STOCK', referenceId: item.id },
    });
    if (!existingReceipt) {
      await prisma.inventoryLedger.create({
        data: {
          id: randomUUID(),
          inventoryItemId: item.id,
          productSkuId,
          warehouseId,
          locationId,
          movementType: 'PURCHASE_RECEIPT',
          quantity: onHandQuantity,
          beforeOnHand: 0,
          afterOnHand: onHandQuantity,
          beforeReserved: 0,
          afterReserved: 0,
          referenceType: 'SEED_INITIAL_STOCK',
          referenceId: item.id,
          reason: 'Initial seed stock',
          correlationId: randomUUID(),
        },
      });
    }
    return item;
  };

  // Aviator (PUBLISHED product's SKU): 50 on hand at the central warehouse,
  // 5 already reserved (see the InventoryReservation fixture below) — well
  // above its 15-unit reorder floor, so it does NOT show up as low stock.
  const aviatorAtMain = await seedStock(sku.id, warehouseCentral.id, locMain.id, 50, 5);
  // Wayfarer (DRAFT product's SKU): only 8 on hand — below its 15-unit
  // reorder floor, so this IS the low-stock example.
  await seedStock(draftSku.id, warehouseCentral.id, locMain.id, 8, 0);
  // Aviator also has a small store-floor stock — multi-warehouse stock,
  // and the source stock the transfer example below dispatches from is
  // NOT this row (the transfer moves stock INTO the store from central).
  // Captured (not discarded): the cart-checkout section below reserves 1
  // unit from it for the checkout-ready fixture.
  const aviatorAtStore = await seedStock(sku.id, warehouseStore.id, locFloor.id, 5, 0);

  await prisma.inventoryThreshold.upsert({
    where: { productSkuId_warehouseId: { productSkuId: sku.id, warehouseId: warehouseCentral.id } },
    update: { reorderPoint: 10, safetyStock: 5 },
    create: {
      productSkuId: sku.id,
      warehouseId: warehouseCentral.id,
      reorderPoint: 10,
      safetyStock: 5,
    },
  });
  await prisma.inventoryThreshold.upsert({
    where: {
      productSkuId_warehouseId: { productSkuId: draftSku.id, warehouseId: warehouseCentral.id },
    },
    update: { reorderPoint: 10, safetyStock: 5 },
    create: {
      productSkuId: draftSku.id,
      warehouseId: warehouseCentral.id,
      reorderPoint: 10,
      safetyStock: 5,
    },
  });

  // --- a reserved-stock example (the 5 units already subtracted from
  // aviatorAtMain's availableQuantity above) ---
  const seedReservation = await prisma.inventoryReservation.upsert({
    where: { idempotencyKey: 'SEED-RESERVATION-1' },
    update: {},
    create: {
      id: randomUUID(),
      productSkuId: sku.id,
      warehouseId: warehouseCentral.id,
      locationId: locMain.id,
      inventoryItemId: aviatorAtMain.id,
      quantity: 5,
      status: 'ACTIVE',
      sourceType: 'MANUAL',
      sourceId: randomUUID(),
      idempotencyKey: 'SEED-RESERVATION-1',
    },
  });
  const existingReservationLedger = await prisma.inventoryLedger.findFirst({
    where: { referenceType: 'INVENTORY_RESERVATION', referenceId: seedReservation.id },
  });
  if (!existingReservationLedger) {
    await prisma.inventoryLedger.create({
      data: {
        id: randomUUID(),
        inventoryItemId: aviatorAtMain.id,
        productSkuId: sku.id,
        warehouseId: warehouseCentral.id,
        locationId: locMain.id,
        movementType: 'RESERVATION',
        quantity: 5,
        beforeOnHand: 50,
        afterOnHand: 50,
        beforeReserved: 0,
        afterReserved: 5,
        referenceType: 'INVENTORY_RESERVATION',
        referenceId: seedReservation.id,
        reason: 'Seed reservation example',
        correlationId: randomUUID(),
      },
    });
  }

  // --- a REQUESTED stock transfer example (central -> store, aviator) ---
  const seedTransfer = await prisma.stockTransfer.upsert({
    where: { referenceNumber: 'SEED-TRANSFER-1' },
    update: {},
    create: {
      id: randomUUID(),
      referenceNumber: 'SEED-TRANSFER-1',
      sourceWarehouseId: warehouseCentral.id,
      destinationWarehouseId: warehouseStore.id,
      status: 'REQUESTED',
      requestedBy: adminUser.id,
    },
  });
  const existingTransferItem = await prisma.stockTransferItem.findFirst({
    where: { transferId: seedTransfer.id, productSkuId: sku.id },
  });
  if (!existingTransferItem) {
    await prisma.stockTransferItem.create({
      data: {
        id: randomUUID(),
        transferId: seedTransfer.id,
        productSkuId: sku.id,
        requestedQuantity: 10,
      },
    });
  }

  // ---------------------------------------------------------------------
  // marketing — a welcome coupon
  // ---------------------------------------------------------------------
  const welcomeCoupon = await prisma.coupon.upsert({
    where: { code: 'WELCOME10' },
    update: {},
    create: {
      code: 'WELCOME10',
      type: 'PERCENTAGE',
      value: 1000n, // 10.00% in basis points
      minOrderAmount: 1_000_000n,
      usageLimit: 1000,
      perUserLimit: 1,
      isActive: true,
    },
  });

  // ---------------------------------------------------------------------
  // cart-checkout (Phase 007 — see docs/adr/ADR-007-cart-checkout.md): a
  // second PUBLISHED, discounted SKU (multiple sellable SKUs + a
  // catalog-level discount example), two ShippingMethod fixtures, the
  // pricing/quantity `system.Setting` overrides `CartPricingService`
  // reads, an active customer cart (with a coupon + shipping selected), a
  // guest cart, a checkout-ready fixture (VALIDATING -> READY_FOR_PAYMENT
  // with a real reservation), and an expired checkout fixture — the
  // brief's exact "at least" list for this phase's seed data.
  // ---------------------------------------------------------------------
  const clubmasterProduct = await prisma.product.upsert({
    where: { slug: 'ray-ban-clubmaster-classic' },
    update: {
      status: 'PUBLISHED',
      publishedAt: new Date(),
      approvedBy: adminUser.id,
      approvedAt: new Date(),
    },
    create: {
      brandId: brand.id,
      categoryId: category.id,
      productType: 'SUNGLASSES',
      name: 'Ray-Ban Clubmaster Classic',
      slug: 'ray-ban-clubmaster-classic',
      longDescription: 'Half-frame browline style, on sale this season.',
      tags: ['classic', 'acetate-metal-frame'],
      status: 'PUBLISHED',
      publishedAt: new Date(),
      approvedBy: adminUser.id,
      approvedAt: new Date(),
    },
  });
  const clubmasterVariantDefaults = {
    color: 'Black',
    size: '51mm',
    gender: 'UNISEX' as const,
    frameShape: 'Clubmaster',
    frameMaterial: 'Acetate/Metal',
    isDefault: true,
    status: 'ACTIVE' as const,
  };
  const existingClubmasterVariant = await prisma.productVariant.findFirst({
    where: { productId: clubmasterProduct.id, isDefault: true },
  });
  const clubmasterVariant = existingClubmasterVariant
    ? await prisma.productVariant.update({
        where: { id: existingClubmasterVariant.id },
        data: clubmasterVariantDefaults,
      })
    : await prisma.productVariant.create({
        data: { productId: clubmasterProduct.id, ...clubmasterVariantDefaults },
      });
  const clubmasterSku = await prisma.productSku.upsert({
    where: { skuCode: 'RB-CLUBMASTER-001-BLACK-51' },
    update: {},
    create: {
      productId: clubmasterProduct.id,
      variantId: clubmasterVariant.id,
      skuCode: 'RB-CLUBMASTER-001-BLACK-51',
      weightGrams: 28,
      taxRateBasisPoints: 900,
    },
  });
  // compareAtPrice > basePrice — "a discounted SKU" (catalog-level list
  // price vs. current selling price; cart-checkout's own discount engine
  // this phase only applies coupons, see ADR-007 decision 8, but the
  // catalog-level discount is a real, honest fixture in its own right).
  await prisma.productPrice.upsert({
    where: { productSkuId: clubmasterSku.id },
    update: {},
    create: {
      productSkuId: clubmasterSku.id,
      basePrice: 9_800_000n,
      compareAtPrice: 11_500_000n,
      costPrice: 6_500_000n,
      currency: 'IRR',
    },
  });
  await seedStock(clubmasterSku.id, warehouseCentral.id, locMain.id, 30, 0);

  const homeDeliveryMethod = await prisma.shippingMethod.upsert({
    where: { code: 'STANDARD-HOME' },
    update: {},
    create: {
      code: 'STANDARD-HOME',
      name: 'ارسال استاندارد',
      type: 'HOME_DELIVERY',
      baseCost: 500_000n,
      freeAboveAmount: 20_000_000n,
      isActive: true,
      sortOrder: 0,
    },
  });
  const storePickupMethod = await prisma.shippingMethod.upsert({
    where: { code: 'STORE-PICKUP-TEHRAN' },
    update: {},
    create: {
      code: 'STORE-PICKUP-TEHRAN',
      name: 'تحویل حضوری از فروشگاه ولیعصر',
      type: 'STORE_PICKUP',
      baseCost: 0n,
      warehouseId: warehouseStore.id,
      isActive: true,
      sortOrder: 1,
    },
  });

  // `CartPricingService`'s two configurable inputs — real `system.Setting`
  // rows, not hardcoded fallbacks (ADR-007 decision 6). Values here are
  // deliberately different from the code's own fallback constants
  // (FALLBACK_DEFAULT_TAX_RATE_BASIS_POINTS = 0, FALLBACK_MAX_QUANTITY_
  // PER_LINE = 20) so a seeded database visibly demonstrates the
  // config-driven path, not the fallback path.
  await prisma.setting.upsert({
    where: { key: 'pricing.default_tax_rate_basis_points' },
    update: {},
    create: {
      key: 'pricing.default_tax_rate_basis_points',
      value: 900,
      description: 'Default tax rate (basis points) applied when a SKU has no explicit rate',
    },
  });
  await prisma.setting.upsert({
    where: { key: 'cart.max_quantity_per_line' },
    update: {},
    create: {
      key: 'cart.max_quantity_per_line',
      value: 10,
      description: 'Maximum quantity allowed on a single cart line',
    },
  });

  /** Money-as-string breakdown line, matching `breakdownToJson`'s exact
   * shape (services/api's `cart.mapper.ts`) so a seeded `breakdown` Json
   * column round-trips through `breakdownFromJson` exactly like a real
   * one computed by `PricingResolver`. */
  const breakdownLine = (props: {
    productSkuId: string;
    quantity: number;
    basePrice: bigint;
    resolvedUnitPrice: bigint;
    lineDiscount: bigint;
    lineTax: bigint;
    lineSubtotal: bigint;
    taxRateBasisPoints: number;
  }) => ({
    productSkuId: props.productSkuId,
    quantity: props.quantity,
    basePrice: props.basePrice.toString(),
    resolvedUnitPrice: props.resolvedUnitPrice.toString(),
    lineDiscount: props.lineDiscount.toString(),
    lineTax: props.lineTax.toString(),
    lineSubtotal: props.lineSubtotal.toString(),
    taxRateBasisPoints: props.taxRateBasisPoints,
  });

  // --- active customer cart (Sara): aviator x1 + WELCOME10 + home delivery ---
  // subtotal 12,500,000 - discount 1,250,000 (10%) = 11,250,000 taxable;
  // tax 9% of 11,250,000 = 1,012,500; shipping 500,000 (below the
  // 20,000,000 free-shipping floor); grandTotal = 12,762,500.
  const customerCart = await prisma.cart.upsert({
    where: { id: '00000000-0000-4000-9000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-4000-9000-000000000001',
      customerId: customer.id,
      status: 'ACTIVE',
      currency: 'IRR',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000),
    },
  });
  await prisma.cartItem.upsert({
    where: {
      cartId_productSkuId_configurationHash: {
        cartId: customerCart.id,
        productSkuId: sku.id,
        configurationHash: '',
      },
    },
    update: {},
    create: {
      cartId: customerCart.id,
      productSkuId: sku.id,
      quantity: 1,
      unitPriceSnapshot: 12_500_000n,
      currency: 'IRR',
    },
  });
  await prisma.cartCoupon.upsert({
    where: { cartId: customerCart.id },
    update: {},
    create: {
      cartId: customerCart.id,
      couponId: welcomeCoupon.id,
      code: welcomeCoupon.code,
      resolvedDiscount: 1_250_000n,
    },
  });
  await prisma.cartShippingSelection.upsert({
    where: { cartId: customerCart.id },
    update: {},
    create: {
      cartId: customerCart.id,
      shippingMethodId: homeDeliveryMethod.id,
      estimatedCost: 500_000n,
    },
  });
  const existingCustomerCartSnapshot = await prisma.cartPriceSnapshot.findFirst({
    where: { cartId: customerCart.id },
  });
  if (!existingCustomerCartSnapshot) {
    await prisma.cartPriceSnapshot.create({
      data: {
        cartId: customerCart.id,
        currency: 'IRR',
        subtotal: 12_500_000n,
        discountTotal: 1_250_000n,
        taxTotal: 1_012_500n,
        shippingTotal: 500_000n,
        grandTotal: 12_762_500n,
        breakdown: [
          breakdownLine({
            productSkuId: sku.id,
            quantity: 1,
            basePrice: 12_500_000n,
            resolvedUnitPrice: 11_250_000n,
            lineDiscount: 1_250_000n,
            lineTax: 1_012_500n,
            lineSubtotal: 12_500_000n,
            taxRateBasisPoints: 900,
          }),
        ],
      },
    });
  }

  // --- guest cart: clubmaster (discounted) SKU x2, no coupon/shipping yet ---
  const guestCartToken = 'seed-guest-cart-token-0000000000000000000000000000';
  const guestCart = await prisma.cart.upsert({
    where: { guestToken: guestCartToken },
    update: {},
    create: {
      id: '00000000-0000-4000-9000-000000000002',
      guestToken: guestCartToken,
      status: 'ACTIVE',
      currency: 'IRR',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000),
    },
  });
  await prisma.cartItem.upsert({
    where: {
      cartId_productSkuId_configurationHash: {
        cartId: guestCart.id,
        productSkuId: clubmasterSku.id,
        configurationHash: '',
      },
    },
    update: {},
    create: {
      cartId: guestCart.id,
      productSkuId: clubmasterSku.id,
      quantity: 2,
      unitPriceSnapshot: 9_800_000n,
      currency: 'IRR',
    },
  });

  // --- checkout-ready fixture: its own cart (aviator x1, no coupon),
  // reserved from the store's aviator stock, validated PASSED, and frozen
  // at READY_FOR_PAYMENT — subtotal 12,500,000, tax 9% = 1,125,000, store
  // pickup shipping 0, grandTotal 13,625,000. ---
  const checkoutReadyCart = await prisma.cart.upsert({
    where: { id: '00000000-0000-4000-9000-000000000003' },
    update: {},
    create: {
      id: '00000000-0000-4000-9000-000000000003',
      customerId: customer.id,
      status: 'CHECKOUT_STARTED',
      currency: 'IRR',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000),
    },
  });
  await prisma.cartItem.upsert({
    where: {
      cartId_productSkuId_configurationHash: {
        cartId: checkoutReadyCart.id,
        productSkuId: sku.id,
        configurationHash: '',
      },
    },
    update: {},
    create: {
      cartId: checkoutReadyCart.id,
      productSkuId: sku.id,
      quantity: 1,
      unitPriceSnapshot: 12_500_000n,
      currency: 'IRR',
    },
  });

  const checkoutReadySession = await prisma.checkoutSession.upsert({
    where: { idempotencyKey: 'SEED-CHECKOUT-READY-1' },
    update: {},
    create: {
      id: '00000000-0000-4000-9000-000000000004',
      cartId: checkoutReadyCart.id,
      customerId: customer.id,
      status: 'READY_FOR_PAYMENT',
      currency: 'IRR',
      subtotal: 12_500_000n,
      discountTotal: 0n,
      taxTotal: 1_125_000n,
      shippingTotal: 0n,
      grandTotal: 13_625_000n,
      pricingSnapshot: {
        currency: 'IRR',
        subtotal: '12500000',
        discountTotal: '0',
        taxTotal: '1125000',
        shippingTotal: '0',
        grandTotal: '13625000',
      },
      shippingSnapshot: { shippingMethodId: storePickupMethod.id, estimatedCost: '0' },
      addressSnapshot: {
        recipientName: 'Sara Ahmadi',
        phone: '+989120000002',
        province: 'Tehran',
        city: 'Tehran',
        addressLine1: 'Valiasr St, No. 100',
        addressLine2: null,
        postalCode: null,
      },
      idempotencyKey: 'SEED-CHECKOUT-READY-1',
      expiresAt: new Date(Date.now() + 20 * 60_000),
    },
  });
  await prisma.checkoutAddress.upsert({
    where: { checkoutSessionId: checkoutReadySession.id },
    update: {},
    create: {
      checkoutSessionId: checkoutReadySession.id,
      customerAddressId: '00000000-0000-4000-8000-000000000001',
      recipientName: 'Sara Ahmadi',
      phone: '+989120000002',
      province: 'Tehran',
      city: 'Tehran',
      addressLine1: 'Valiasr St, No. 100',
    },
  });
  const existingCheckoutReadyValidation = await prisma.checkoutValidationResult.findFirst({
    where: { checkoutSessionId: checkoutReadySession.id },
  });
  if (!existingCheckoutReadyValidation) {
    await prisma.checkoutValidationResult.create({
      data: { checkoutSessionId: checkoutReadySession.id, outcome: 'PASSED', issues: [] },
    });
  }
  const existingCheckoutReadyTotals = await prisma.checkoutTotals.findFirst({
    where: { checkoutSessionId: checkoutReadySession.id },
  });
  if (!existingCheckoutReadyTotals) {
    await prisma.checkoutTotals.create({
      data: {
        checkoutSessionId: checkoutReadySession.id,
        currency: 'IRR',
        subtotal: 12_500_000n,
        discountTotal: 0n,
        taxTotal: 1_125_000n,
        shippingTotal: 0n,
        grandTotal: 13_625_000n,
        breakdown: [
          breakdownLine({
            productSkuId: sku.id,
            quantity: 1,
            basePrice: 12_500_000n,
            resolvedUnitPrice: 12_500_000n,
            lineDiscount: 0n,
            lineTax: 1_125_000n,
            lineSubtotal: 12_500_000n,
            taxRateBasisPoints: 900,
          }),
        ],
      },
    });
  }
  // Reserves 1 unit from the store's aviator stock (5 on hand, 0 reserved
  // — seeded above) — kept separate from `aviatorAtMain`'s own
  // SEED-RESERVATION-1 fixture so neither example has to account for the
  // other's math.
  const checkoutReadyReservation = await prisma.inventoryReservation.upsert({
    where: {
      idempotencyKey: `checkout__${checkoutReadySession.id}__${sku.id}`,
    },
    update: {},
    create: {
      id: randomUUID(),
      productSkuId: sku.id,
      warehouseId: warehouseStore.id,
      locationId: locFloor.id,
      inventoryItemId: aviatorAtStore.id,
      quantity: 1,
      status: 'ACTIVE',
      sourceType: 'CHECKOUT',
      sourceId: checkoutReadySession.id,
      idempotencyKey: `checkout__${checkoutReadySession.id}__${sku.id}`,
    },
  });
  await prisma.inventoryItem.update({
    where: { id: aviatorAtStore.id },
    data: { reservedQuantity: 1, availableQuantity: 4 },
  });
  await prisma.checkoutReservation.upsert({
    where: {
      checkoutSessionId_productSkuId: {
        checkoutSessionId: checkoutReadySession.id,
        productSkuId: sku.id,
      },
    },
    update: {},
    create: {
      checkoutSessionId: checkoutReadySession.id,
      productSkuId: sku.id,
      warehouseId: warehouseStore.id,
      inventoryReservationId: checkoutReadyReservation.id,
      quantity: 1,
    },
  });

  // --- expired checkout fixture: a guest checkout that never reached an
  // address/reservation before its 20-minute window ran out. ---
  const expiredGuestToken = 'seed-guest-cart-token-expired-000000000000000000';
  const expiredCart = await prisma.cart.upsert({
    where: { guestToken: expiredGuestToken },
    update: {},
    create: {
      id: '00000000-0000-4000-9000-000000000005',
      guestToken: expiredGuestToken,
      status: 'EXPIRED',
      currency: 'IRR',
      expiresAt: new Date(Date.now() - 24 * 60 * 60_000),
    },
  });
  await prisma.cartItem.upsert({
    where: {
      cartId_productSkuId_configurationHash: {
        cartId: expiredCart.id,
        productSkuId: clubmasterSku.id,
        configurationHash: '',
      },
    },
    update: {},
    create: {
      cartId: expiredCart.id,
      productSkuId: clubmasterSku.id,
      quantity: 1,
      unitPriceSnapshot: 9_800_000n,
      currency: 'IRR',
    },
  });
  const expiredCheckoutSession = await prisma.checkoutSession.upsert({
    where: { idempotencyKey: 'SEED-CHECKOUT-EXPIRED-1' },
    update: {},
    create: {
      id: '00000000-0000-4000-9000-000000000006',
      cartId: expiredCart.id,
      guestToken: expiredGuestToken,
      status: 'EXPIRED',
      currency: 'IRR',
      subtotal: 9_800_000n,
      discountTotal: 0n,
      taxTotal: 882_000n,
      shippingTotal: 0n,
      grandTotal: 10_682_000n,
      idempotencyKey: 'SEED-CHECKOUT-EXPIRED-1',
      expiresAt: new Date(Date.now() - 24 * 60 * 60_000 + 20 * 60_000),
    },
  });
  const existingExpiredValidation = await prisma.checkoutValidationResult.findFirst({
    where: { checkoutSessionId: expiredCheckoutSession.id },
  });
  if (!existingExpiredValidation) {
    await prisma.checkoutValidationResult.create({
      data: {
        checkoutSessionId: expiredCheckoutSession.id,
        outcome: 'FAILED',
        issues: [
          { code: 'ADDRESS_INVALID', message: 'No shipping/billing address set on this checkout' },
        ],
      },
    });
  }

  // ---------------------------------------------------------------------
  // cms — a home page, a menu, an FAQ entry
  // ---------------------------------------------------------------------
  const homePage = await prisma.page.upsert({
    where: { slug: 'home' },
    update: {},
    create: { slug: 'home', title: 'خانه', status: 'PUBLISHED', publishedAt: new Date() },
  });
  const existingSection = await prisma.pageSection.findFirst({
    where: { pageId: homePage.id, type: 'Hero' },
  });
  if (!existingSection) {
    await prisma.pageSection.create({
      data: {
        pageId: homePage.id,
        type: 'Hero',
        sortOrder: 0,
        config: { headline: 'عینک آفتابی اورجینال، ارسال به سراسر ایران' },
      },
    });
  }

  const headerMenu = await prisma.menu.upsert({
    where: { key: 'header' },
    update: {},
    create: { key: 'header', name: 'Header Navigation' },
  });
  const existingMenuItem = await prisma.menuItem.findFirst({
    where: { menuId: headerMenu.id, url: '/c/sunglasses' },
  });
  if (!existingMenuItem) {
    await prisma.menuItem.create({
      data: { menuId: headerMenu.id, label: 'عینک آفتابی', url: '/c/sunglasses', sortOrder: 0 },
    });
  }

  const existingFaq = await prisma.faq.findFirst({
    where: { question: 'زمان ارسال سفارش چقدر است؟' },
  });
  if (!existingFaq) {
    await prisma.faq.create({
      data: {
        question: 'زمان ارسال سفارش چقدر است؟',
        answer: 'سفارش‌ها ظرف ۲ تا ۴ روز کاری ارسال می‌شوند.',
        category: 'shipping',
      },
    });
  }

  // ---------------------------------------------------------------------
  // notification — a couple of templates, and the demo customer's prefs
  // ---------------------------------------------------------------------
  await prisma.notificationTemplate.upsert({
    where: { key: 'OTP' },
    update: {},
    create: {
      key: 'OTP',
      channel: 'SMS',
      body: 'کد ورود شما: {{code}}',
    },
  });
  await prisma.notificationTemplate.upsert({
    where: { key: 'ORDER_CREATED' },
    update: {},
    create: {
      key: 'ORDER_CREATED',
      channel: 'SMS',
      subject: null,
      body: 'سفارش شما با شماره {{orderNumber}} ثبت شد.',
    },
  });
  await prisma.notificationPreference.upsert({
    where: { customerId: customer.id },
    update: {},
    create: { customerId: customer.id },
  });

  // ---------------------------------------------------------------------
  // system — a feature flag and a business setting
  // ---------------------------------------------------------------------
  await prisma.featureFlag.upsert({
    where: { key: 'checkout.guest_enabled' },
    update: {},
    create: {
      key: 'checkout.guest_enabled',
      name: 'Guest checkout',
      description: 'Allow checkout without an account (blueprint §115)',
      isEnabled: true,
    },
  });
  await prisma.setting.upsert({
    where: { key: 'company.info' },
    update: {},
    create: {
      key: 'company.info',
      value: { name: 'IECP', supportPhone: '+982100000000' },
      description: 'Basic company info shown in the storefront footer',
    },
  });

  console.log(
    '[seed] done — RBAC (38 real permissions across identity/catalog/inventory, role ' +
      'inheritance, a deny-override), admin/customer/support/catalog-editor/inventory-role ' +
      'users, demo customer, catalog (3 products — two PUBLISHED with variant+SKU+price+' +
      'media/collection, one DRAFT), inventory (2 warehouses, 3 locations, stock for all ' +
      'SKUs, 2 reservations, a low-stock example, a transfer), coupon, cart-checkout (2 ' +
      'shipping methods, pricing settings, an active customer cart, a guest cart, a ' +
      'checkout-ready fixture with a real reservation, an expired checkout), CMS/' +
      'notification/system basics.',
  );
}

main()
  .catch((error: unknown) => {
    console.error('[seed] failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
