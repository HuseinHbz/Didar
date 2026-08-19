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

/** `ORD-YYYYMMDD-NNNNNN` / `INV-YYYYMMDD-NNNNNN` — same format and same
 * real Postgres sequences (`commerce.order_number_seq`/
 * `finance.invoice_number_seq`, ADR-009 decision 6) services/api's
 * `PrismaOrderRepository`/`PrismaInvoiceRepository` draw from.
 * Reimplemented here, not imported — same standalone-script rationale
 * `sha256Hex` above documents. */
function formatSequenceNumber(prefix: string, seq: bigint, drawnAt: Date): string {
  const y = drawnAt.getUTCFullYear();
  const m = String(drawnAt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(drawnAt.getUTCDate()).padStart(2, '0');
  return `${prefix}-${y}${m}${d}-${seq.toString().padStart(6, '0')}`;
}

async function nextOrderNumber(): Promise<string> {
  const rows = await prisma.$queryRaw<
    { nextval: bigint }[]
  >`SELECT nextval('commerce.order_number_seq') AS nextval`;
  const nextval = rows[0]?.nextval;
  if (nextval === undefined) throw new Error('[seed] order_number_seq.nextval() returned no row');
  return formatSequenceNumber('ORD', nextval, new Date());
}

async function nextInvoiceNumber(): Promise<string> {
  const rows = await prisma.$queryRaw<
    { nextval: bigint }[]
  >`SELECT nextval('finance.invoice_number_seq') AS nextval`;
  const nextval = rows[0]?.nextval;
  if (nextval === undefined) throw new Error('[seed] invoice_number_seq.nextval() returned no row');
  return formatSequenceNumber('INV', nextval, new Date());
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
    // payment (Phase 008) — matching what services/api's payment module
    // actually checks via @RequirePermission (see that module's README
    // and docs/adr/ADR-008-payment-orchestration.md). Intent
    // creation/start/callback/verify are customer/guest-facing
    // (ActorResolverGuard, same as cart-checkout) — no admin permission
    // gates those, only refunds and reconciliation.
    { module: 'payment', action: 'refund.read', description: 'Read a refund and its status' },
    {
      module: 'payment',
      action: 'refund.create',
      description: 'Request a refund against a VERIFIED payment transaction',
    },
    {
      module: 'payment',
      action: 'refund.process',
      description: 'Submit a PENDING refund to the real provider adapter',
    },
    {
      module: 'payment',
      action: 'reconciliation.read',
      description: 'Read reconciliation findings (never auto-corrected — ADR-008 decision 7)',
    },
    {
      module: 'payment',
      action: 'reconciliation.resolve',
      description: 'Record a resolution note on a reconciliation finding',
    },
    // order (Phase 009) — matching what services/api's order module
    // actually checks via @RequirePermission (see that module's README
    // and docs/adr/ADR-009-order-fulfillment.md). Order creation itself
    // is never client-triggered (only OrderConversionService, from a
    // verified payment) — `order.create` gates only the admin manual
    // conversion-retry route, not a generic "create an order" endpoint.
    { module: 'order', action: 'read', description: 'Read any order (admin/support scope)' },
    {
      module: 'order',
      action: 'create',
      description: 'Manually retry checkout->order conversion for a verified payment',
    },
    {
      module: 'order',
      action: 'update',
      description: 'Update a fulfillment record on an order',
    },
    { module: 'order', action: 'cancel', description: 'Cancel an order' },
    { module: 'order', action: 'approve', description: 'Approve an order for processing' },
    { module: 'order', action: 'fulfill', description: 'Create a fulfillment for an order' },
    { module: 'order', action: 'ship', description: 'Create a shipment for a fulfillment' },
    { module: 'order', action: 'complete', description: 'Mark an order COMPLETED' },
    {
      module: 'order',
      action: 'refund',
      description: 'Request a partial refund against a paid order',
    },
    { module: 'order', action: 'invoice.read', description: "Read an order's invoice" },
    {
      module: 'order',
      action: 'invoice.create',
      description: 'Manually (re)issue an invoice for an order',
    },
    { module: 'order', action: 'invoice.void', description: 'Void an issued invoice' },
    {
      module: 'order',
      action: 'shipment.read',
      description: "Read an order's shipments",
    },
    {
      module: 'order',
      action: 'shipment.update',
      description: 'Update a shipment status/tracking event',
    },

    // Phase 010 — promotion/discount/coupon engine (§19, see
    // docs/adr/ADR-010-promotion-engine.md). Deletion is never given to
    // every editor automatically (§19's explicit instruction) — only
    // `promotion_manager` gets `promotion.delete`/`coupon.delete`;
    // `promotion_editor` can author and activate/pause but never
    // permanently remove a promotion/coupon or see analytics.
    { module: 'promotion', action: 'read', description: 'Read any promotion' },
    { module: 'promotion', action: 'create', description: 'Create a promotion' },
    { module: 'promotion', action: 'update', description: 'Update a promotion' },
    { module: 'promotion', action: 'activate', description: 'Activate a promotion' },
    { module: 'promotion', action: 'pause', description: 'Pause an active promotion' },
    { module: 'promotion', action: 'archive', description: 'Archive a promotion (terminal)' },
    { module: 'promotion', action: 'delete', description: 'Permanently delete a promotion' },
    {
      module: 'promotion',
      action: 'analytics.read',
      description: 'Read promotion usage/redemption analytics',
    },
    { module: 'coupon', action: 'read', description: 'Read any coupon' },
    { module: 'coupon', action: 'create', description: 'Create a coupon' },
    { module: 'coupon', action: 'update', description: "Update a coupon's own fields/lifecycle" },
    { module: 'coupon', action: 'disable', description: 'Permanently disable a coupon' },
    { module: 'coupon', action: 'delete', description: 'Permanently delete a coupon' },
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
  // admin gets every catalog.*/inventory.*/payment.*/order.*/promotion.*/
  // coupon.* permission — the module-access gate (@RequireModule) and
  // every @RequirePermission check both pass for admin, same as
  // identity's own endpoints.
  for (const def of permissionDefs) {
    if (
      def.module === 'catalog' ||
      def.module === 'inventory' ||
      def.module === 'payment' ||
      def.module === 'order' ||
      def.module === 'promotion' ||
      def.module === 'coupon'
    ) {
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

  // Two payment roles (Phase 008 — docs/security/payment-security.md has
  // the full matrix): `payment_manager` gets every payment.* permission
  // (a finance department head — can request/process refunds and resolve
  // reconciliation findings); `finance_auditor` is read-only, the same
  // "floor role can't approve its own sensitive action" shape
  // `inventory_auditor` established — real fixture for the e2e suite's
  // permission-bypass case (auditor calling POST .../process must 403).
  const paymentManagerRole = await prisma.role.upsert({
    where: { name: 'payment_manager' },
    update: { description: 'Full payment module access — every payment.* permission' },
    create: {
      name: 'payment_manager',
      description: 'Full payment module access — every payment.* permission',
    },
  });
  for (const def of permissionDefs) {
    if (def.module === 'payment') {
      await grant(paymentManagerRole.id, `payment.${def.action}`);
    }
  }
  const financeAuditorRole = await prisma.role.upsert({
    where: { name: 'finance_auditor' },
    update: { description: 'Read-only — refund and reconciliation visibility, no mutations' },
    create: {
      name: 'finance_auditor',
      description: 'Read-only — refund and reconciliation visibility, no mutations',
    },
  });
  for (const action of ['refund.read', 'reconciliation.read']) {
    await grant(financeAuditorRole.id, `payment.${action}`);
  }

  // Two order roles (Phase 009 — docs/security/order-fulfillment-security.md
  // has the full matrix): `order_manager` gets every order.* permission (a
  // department head — can approve/cancel/refund/complete orders and void
  // invoices); `fulfillment_clerk` is the warehouse-floor role — can read
  // orders, create fulfillments/shipments, and update their status, but
  // cannot approve, cancel, refund, complete an order, or void an invoice
  // — the same "floor role can't approve its own sensitive action" shape
  // `warehouse_operator`/`finance_auditor` already established; real
  // fixture for the e2e suite's permission-bypass case (a fulfillment
  // clerk calling POST .../cancel or .../refund must 403).
  const orderManagerRole = await prisma.role.upsert({
    where: { name: 'order_manager' },
    update: { description: 'Full order module access — every order.* permission' },
    create: {
      name: 'order_manager',
      description: 'Full order module access — every order.* permission',
    },
  });
  for (const def of permissionDefs) {
    if (def.module === 'order') {
      await grant(orderManagerRole.id, `order.${def.action}`);
    }
  }
  const fulfillmentClerkRole = await prisma.role.upsert({
    where: { name: 'fulfillment_clerk' },
    update: {
      description:
        'Warehouse-floor fulfillment — create/update fulfillments and shipments; cannot approve, cancel, refund, or complete an order',
    },
    create: {
      name: 'fulfillment_clerk',
      description:
        'Warehouse-floor fulfillment — create/update fulfillments and shipments; cannot approve, cancel, refund, or complete an order',
    },
  });
  for (const action of ['read', 'update', 'fulfill', 'ship', 'shipment.read', 'shipment.update']) {
    await grant(fulfillmentClerkRole.id, `order.${action}`);
  }

  // Two promotion roles (Phase 010 — docs/security/promotion-security.md
  // has the full matrix): `promotion_manager` gets every promotion.*/
  // coupon.* permission including delete/analytics; `promotion_editor` is
  // the day-to-day marketing role — can author, activate/pause/archive
  // promotions and manage coupons, but can never permanently delete a
  // promotion/coupon or read analytics (§19's explicit "never give
  // deletion automatically to all editors").
  const promotionManagerRole = await prisma.role.upsert({
    where: { name: 'promotion_manager' },
    update: { description: 'Full promotion module access — every promotion.*/coupon.* permission' },
    create: {
      name: 'promotion_manager',
      description: 'Full promotion module access — every promotion.*/coupon.* permission',
    },
  });
  for (const def of permissionDefs) {
    if (def.module === 'promotion' || def.module === 'coupon') {
      await grant(promotionManagerRole.id, `${def.module}.${def.action}`);
    }
  }
  const promotionEditorRole = await prisma.role.upsert({
    where: { name: 'promotion_editor' },
    update: {
      description:
        'Day-to-day marketing role — author/activate/pause/archive promotions, manage coupons; cannot delete or read analytics',
    },
    create: {
      name: 'promotion_editor',
      description:
        'Day-to-day marketing role — author/activate/pause/archive promotions, manage coupons; cannot delete or read analytics',
    },
  });
  for (const action of ['read', 'create', 'update', 'activate', 'pause', 'archive']) {
    await grant(promotionEditorRole.id, `promotion.${action}`);
  }
  for (const action of ['read', 'create', 'update', 'disable']) {
    await grant(promotionEditorRole.id, `coupon.${action}`);
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

  // Ninth-tenth users: one per payment role — real fixtures for the e2e
  // suite's payment permission-bypass cases (finance_auditor calling
  // POST .../process or .../resolve must 403).
  const paymentRoleUsers: [string, string, string][] = [
    ['+989120000009', 'payment-manager@iecp.dev', paymentManagerRole.id],
    ['+989120000010', 'finance-auditor@iecp.dev', financeAuditorRole.id],
  ];
  for (const [phone, email, roleId] of paymentRoleUsers) {
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

  // Eleventh-twelfth users: one per order role — real fixtures for the
  // e2e suite's order permission-bypass cases (fulfillment_clerk calling
  // POST .../cancel or .../refund must 403).
  const orderRoleUsers: [string, string, string][] = [
    ['+989120000011', 'order-manager@iecp.dev', orderManagerRole.id],
    ['+989120000012', 'fulfillment-clerk@iecp.dev', fulfillmentClerkRole.id],
  ];
  for (const [phone, email, roleId] of orderRoleUsers) {
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

  // Thirteenth-fourteenth users: one per promotion role — real fixtures
  // for the e2e suite's promotion permission-bypass cases
  // (promotion_editor calling a `promotion.delete`-gated route, if one
  // existed, or `coupon.delete`, must 403; a plain customer token must
  // 403 every `/admin/promotions`/`/admin/coupons` route).
  const promotionRoleUsers: [string, string, string][] = [
    ['+989120000013', 'promotion-manager@iecp.dev', promotionManagerRole.id],
    ['+989120000014', 'promotion-editor@iecp.dev', promotionEditorRole.id],
  ];
  for (const [phone, email, roleId] of promotionRoleUsers) {
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
  // marketing (Phase 010 — see docs/adr/ADR-010-promotion-engine.md):
  // three promotions (one per stacking archetype) and five coupons —
  // the spec's exact "at least" fixture list. Idempotent (upsert on
  // `code`/a stable `name`), verified stable across two seed runs.
  // ---------------------------------------------------------------------
  const promotionA = await prisma.promotion.upsert({
    where: { id: '00000000-0000-4000-a000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-4000-a000-000000000001',
      name: 'Seed — 20% off sunglasses',
      description: '20% off every sunglasses-category item, coupon-gated',
      status: 'ACTIVE',
      priority: 10,
      stackable: false,
      exclusive: false,
      requiresCoupon: true,
      discountType: 'PERCENTAGE',
      discountValue: 2000n, // 20.00% in basis points
      maximumDiscount: 5_000_000n,
      targets: { create: [{ type: 'CATEGORY', refId: category.id }] },
    },
  });
  const promotionB = await prisma.promotion.upsert({
    where: { id: '00000000-0000-4000-a000-000000000002' },
    update: {},
    create: {
      id: '00000000-0000-4000-a000-000000000002',
      name: 'Seed — fixed amount off',
      description: 'A flat cart-wide discount, coupon-gated',
      status: 'ACTIVE',
      priority: 20,
      stackable: false,
      exclusive: false,
      requiresCoupon: true,
      minimumCartValue: 2_000_000n,
      discountType: 'FIXED_AMOUNT',
      discountValue: 500_000n,
    },
  });
  // No coupon references Promotion C — it's automatic (requiresCoupon:
  // false), so its row is never read again after creation.
  await prisma.promotion.upsert({
    where: { id: '00000000-0000-4000-a000-000000000003' },
    update: {},
    create: {
      id: '00000000-0000-4000-a000-000000000003',
      name: 'Seed — free shipping',
      description: 'Automatic free shipping over a cart minimum, no code needed',
      status: 'ACTIVE',
      priority: 30,
      stackable: true,
      exclusive: false,
      requiresCoupon: false,
      minimumCartValue: 3_000_000n,
      discountType: 'FREE_SHIPPING',
    },
  });

  const didar20Coupon = await prisma.coupon.upsert({
    where: { code: 'DIDAR20' },
    update: {},
    create: {
      promotionId: promotionA.id,
      code: 'DIDAR20',
      status: 'ACTIVE',
      usageLimit: 1000,
      perCustomerLimit: 1,
    },
  });
  await prisma.coupon.upsert({
    where: { code: 'WELCOME500' },
    update: {},
    create: {
      promotionId: promotionB.id,
      code: 'WELCOME500',
      status: 'ACTIVE',
      usageLimit: 1000,
      perCustomerLimit: 1,
    },
  });
  // An already-expired coupon — real fixture for the e2e suite's
  // "expired coupon rejected" case (§21).
  await prisma.coupon.upsert({
    where: { code: 'EXPIREDCODE' },
    update: {},
    create: {
      promotionId: promotionA.id,
      code: 'EXPIREDCODE',
      status: 'ACTIVE',
      expiresAt: new Date('2020-01-01T00:00:00Z'),
    },
  });
  // A not-yet-valid coupon — real fixture for the "future coupon
  // rejected" case.
  await prisma.coupon.upsert({
    where: { code: 'FUTURECODE' },
    update: {},
    create: {
      promotionId: promotionA.id,
      code: 'FUTURECODE',
      status: 'ACTIVE',
      startsAt: new Date('2099-01-01T00:00:00Z'),
    },
  });
  // A single-use coupon — real fixture for the mandatory concurrency
  // suite (usageLimit=1, N concurrent redemption attempts -> exactly
  // one success, ADR-010 decision 8/§30).
  await prisma.coupon.upsert({
    where: { code: 'LIMITEDCODE' },
    update: {},
    create: {
      promotionId: promotionB.id,
      code: 'LIMITEDCODE',
      status: 'ACTIVE',
      usageLimit: 1,
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
      couponId: didar20Coupon.id,
      code: didar20Coupon.code,
      resolvedDiscount: 2_500_000n, // 20% of 12,500,000 — DIDAR20 (Promotion A)
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

  // Phase 009: this fixture backs the order section's own "paid" order
  // below (`successIntent`'s SUCCEEDED/VERIFIED chain, ADR-009 decision 4)
  // — its `status` moves to CONVERTED (what `CheckoutService.markConverted`
  // sets for real once an order is created from it) rather than staying
  // READY_FOR_PAYMENT forever. `update` carries this on a re-run against a
  // database seeded before Phase 009 existed, same convergent-not-merely-
  // additive convention `permission.deleteMany` above already established.
  const checkoutReadySession = await prisma.checkoutSession.upsert({
    where: { idempotencyKey: 'SEED-CHECKOUT-READY-1' },
    update: { status: 'CONVERTED' },
    create: {
      id: '00000000-0000-4000-9000-000000000004',
      cartId: checkoutReadyCart.id,
      customerId: customer.id,
      status: 'CONVERTED',
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
  // payment (Phase 008 — see docs/adr/ADR-008-payment-orchestration.md):
  // one real provider row (ZarinPal, sandbox), and three PaymentIntent
  // chains covering the brief's own "provider/intent/success/failure/
  // refund/reconciliation-mismatch" fixture list — never real
  // credentials, the real merchant id/API key always come from
  // PAYMENT_ZARINPAL_MERCHANT_ID (ADR-008 decision 8).
  // ---------------------------------------------------------------------
  const zarinpalProvider = await prisma.paymentProvider.upsert({
    where: { code: 'zarinpal' },
    update: {},
    create: {
      code: 'zarinpal',
      name: 'ZarinPal',
      isActive: true,
      isSandbox: true,
      config: { callbackPath: '/payments/callback/zarinpal', requestTimeoutMs: 15_000 },
    },
  });

  // Chain 1 — success: tied to the real checkoutReadySession fixture above
  // (READY_FOR_PAYMENT, grandTotal 13,625,000), SUCCEEDED intent, a
  // RETURNED attempt, a VERIFIED transaction, one recorded callback, and
  // a partial COMPLETED refund — real data for RefundValidator's
  // remaining-balance check on a fresh database (13,625,000 - 1,000,000
  // = 12,625,000 still refundable).
  const successIntent = await prisma.paymentIntent.upsert({
    where: { checkoutSessionId: checkoutReadySession.id },
    update: {},
    create: {
      checkoutSessionId: checkoutReadySession.id,
      customerId: customer.id,
      providerId: zarinpalProvider.id,
      status: 'SUCCEEDED',
      amount: 13_625_000n,
      currency: 'IRR',
      idempotencyKey: 'SEED-PAYMENT-SUCCESS-1',
      expiresAt: new Date(Date.now() + 30 * 60_000),
    },
  });
  const successAttempt = await prisma.paymentAttempt.upsert({
    where: {
      paymentIntentId_attemptNumber: { paymentIntentId: successIntent.id, attemptNumber: 1 },
    },
    update: {},
    create: {
      paymentIntentId: successIntent.id,
      attemptNumber: 1,
      providerAuthority: 'SEED-AUTHORITY-SUCCESS-000000000000000000000000',
      redirectUrl:
        'https://sandbox.zarinpal.com/pg/StartPay/SEED-AUTHORITY-SUCCESS-000000000000000000000000',
      status: 'RETURNED',
      returnedAt: new Date(),
    },
  });
  const successTransaction = await prisma.paymentTransaction.upsert({
    where: {
      providerId_providerReference: {
        providerId: zarinpalProvider.id,
        providerReference: 'SEED-REFID-001',
      },
    },
    update: {},
    create: {
      paymentIntentId: successIntent.id,
      paymentAttemptId: successAttempt.id,
      providerId: zarinpalProvider.id,
      providerReference: 'SEED-REFID-001',
      amount: 13_625_000n,
      currency: 'IRR',
      status: 'VERIFIED',
      verifiedAt: new Date(),
      rawVerificationResponse: { code: 100, message: 'Verified', ref_id: 'SEED-REFID-001' },
    },
  });
  await prisma.paymentCallback.upsert({
    where: { dedupeKey: 'zarinpal:SEED-AUTHORITY-SUCCESS-000000000000000000000000:OK' },
    update: {},
    create: {
      paymentIntentId: successIntent.id,
      providerId: zarinpalProvider.id,
      dedupeKey: 'zarinpal:SEED-AUTHORITY-SUCCESS-000000000000000000000000:OK',
      rawPayload: { Authority: successAttempt.providerAuthority, Status: 'OK' },
      signatureValid: true,
      processedAt: new Date(),
    },
  });
  await prisma.refund.upsert({
    where: { idempotencyKey: 'SEED-REFUND-1' },
    update: {},
    create: {
      paymentTransactionId: successTransaction.id,
      amount: 1_000_000n,
      reason: 'Customer requested a partial refund on one lens coating add-on',
      status: 'COMPLETED',
      requestedBy: adminUser.id,
      providerRefundReference: 'SEED-AUTHORITY-SUCCESS-000000000000000000000000',
      idempotencyKey: 'SEED-REFUND-1',
    },
  });

  // Chain 2 — failure: a synthetic checkoutSessionId (PaymentIntent's
  // pointer is deliberately unenforced — ADR-008 decision 1 — so this
  // needs no real Cart/CheckoutSession row). The provider verified
  // *something* but the amount didn't match the intent's own frozen
  // amount — a FAILED PaymentTransaction is still recorded with the
  // provider's real reference (ADR-008 decision 3: a mismatch is FAILED,
  // never silently accepted), intent status FAILED.
  const failedGuestToken = 'seed-guest-payment-failed-000000000000000000';
  const failedIntent = await prisma.paymentIntent.upsert({
    where: { checkoutSessionId: '00000000-0000-4000-9000-000000000007' },
    update: {},
    create: {
      checkoutSessionId: '00000000-0000-4000-9000-000000000007',
      guestToken: failedGuestToken,
      providerId: zarinpalProvider.id,
      status: 'FAILED',
      amount: 5_000_000n,
      currency: 'IRR',
      idempotencyKey: 'SEED-PAYMENT-FAILED-1',
      expiresAt: new Date(Date.now() + 30 * 60_000),
    },
  });
  const failedAttempt = await prisma.paymentAttempt.upsert({
    where: {
      paymentIntentId_attemptNumber: { paymentIntentId: failedIntent.id, attemptNumber: 1 },
    },
    update: {},
    create: {
      paymentIntentId: failedIntent.id,
      attemptNumber: 1,
      providerAuthority: 'SEED-AUTHORITY-FAILED-0000000000000000000000000000',
      redirectUrl:
        'https://sandbox.zarinpal.com/pg/StartPay/SEED-AUTHORITY-FAILED-0000000000000000000000000000',
      status: 'RETURNED',
      returnedAt: new Date(),
    },
  });
  await prisma.paymentTransaction.upsert({
    where: {
      providerId_providerReference: {
        providerId: zarinpalProvider.id,
        providerReference: 'SEED-REFID-002',
      },
    },
    update: {},
    create: {
      paymentIntentId: failedIntent.id,
      paymentAttemptId: failedAttempt.id,
      providerId: zarinpalProvider.id,
      providerReference: 'SEED-REFID-002',
      amount: 4_500_000n,
      currency: 'IRR',
      status: 'FAILED',
      rawVerificationResponse: { code: 100, message: 'Verified', ref_id: 'SEED-REFID-002' },
    },
  });

  // Chain 3 — reconciliation mismatch: a second SUCCEEDED intent with its
  // own VERIFIED transaction, plus a real, unresolved ReconciliationRecord
  // (ADR-008 decision 7 — recorded, never auto-corrected) showing the
  // provider's own report disagreeing on amount. ReconciliationRecord has
  // no natural unique key (schema.prisma: index-only), so this uses the
  // same findFirst-then-create idempotency shape the checkout-validation
  // fixtures above already use.
  const reconIntent = await prisma.paymentIntent.upsert({
    where: { checkoutSessionId: '00000000-0000-4000-9000-000000000008' },
    update: {},
    create: {
      checkoutSessionId: '00000000-0000-4000-9000-000000000008',
      customerId: customer.id,
      providerId: zarinpalProvider.id,
      status: 'SUCCEEDED',
      amount: 7_200_000n,
      currency: 'IRR',
      idempotencyKey: 'SEED-PAYMENT-RECON-1',
      expiresAt: new Date(Date.now() + 30 * 60_000),
    },
  });
  const reconAttempt = await prisma.paymentAttempt.upsert({
    where: { paymentIntentId_attemptNumber: { paymentIntentId: reconIntent.id, attemptNumber: 1 } },
    update: {},
    create: {
      paymentIntentId: reconIntent.id,
      attemptNumber: 1,
      providerAuthority: 'SEED-AUTHORITY-RECON-00000000000000000000000000000',
      redirectUrl:
        'https://sandbox.zarinpal.com/pg/StartPay/SEED-AUTHORITY-RECON-00000000000000000000000000000',
      status: 'RETURNED',
      returnedAt: new Date(),
    },
  });
  const reconTransaction = await prisma.paymentTransaction.upsert({
    where: {
      providerId_providerReference: {
        providerId: zarinpalProvider.id,
        providerReference: 'SEED-REFID-003',
      },
    },
    update: {},
    create: {
      paymentIntentId: reconIntent.id,
      paymentAttemptId: reconAttempt.id,
      providerId: zarinpalProvider.id,
      providerReference: 'SEED-REFID-003',
      amount: 7_200_000n,
      currency: 'IRR',
      status: 'VERIFIED',
      verifiedAt: new Date(),
      rawVerificationResponse: { code: 100, message: 'Verified', ref_id: 'SEED-REFID-003' },
    },
  });
  const existingReconciliation = await prisma.reconciliationRecord.findFirst({
    where: { paymentTransactionId: reconTransaction.id },
  });
  if (!existingReconciliation) {
    await prisma.reconciliationRecord.create({
      data: {
        providerId: zarinpalProvider.id,
        transactionDate: new Date(new Date().toISOString().slice(0, 10)),
        paymentTransactionId: reconTransaction.id,
        providerReference: 'SEED-REFID-003',
        localAmount: 7_200_000n,
        remoteAmount: 7_000_000n,
        status: 'AMOUNT_MISMATCH',
      },
    });
  }

  // ---------------------------------------------------------------------
  // order (Phase 009 — see docs/adr/ADR-009-order-fulfillment.md): four
  // Order fixtures covering the brief's own explicit list (paid, unpaid,
  // cancelled, fulfilled), each with its own real checkout/payment chain
  // — an `Order` always has a real, unique `checkoutSessionId`/
  // `paymentIntentId` (ADR-009 decision 1), never a synthetic one.
  // ---------------------------------------------------------------------

  // --- Order 1 — PAID, not yet fulfilled, PARTIALLY_REFUNDED. Reuses the
  // checkout-ready fixture above (now CONVERTED) and Chain 1's SUCCEEDED
  // intent/VERIFIED transaction from the payment section, so this order's
  // paidTotal/refundedTotal line up exactly with that section's own
  // SEED-REFUND-1 (1,000,000 of the 13,625,000 paid). ---
  const order1ShippingSnapshot = {
    recipientName: 'Sara Ahmadi',
    phone: '+989120000002',
    province: 'Tehran',
    city: 'Tehran',
    addressLine1: 'Valiasr St, No. 100',
    addressLine2: null,
    postalCode: null,
  };
  let order1 = await prisma.order.findUnique({
    where: { checkoutSessionId: checkoutReadySession.id },
  });
  order1 ??= await prisma.order.create({
    data: {
      orderNumber: await nextOrderNumber(),
      checkoutSessionId: checkoutReadySession.id,
      paymentIntentId: successIntent.id,
      customerId: customer.id,
      source: 'STOREFRONT',
      status: 'PAID',
      paymentStatus: 'PARTIALLY_REFUNDED',
      fulfillmentStatus: 'UNFULFILLED',
      currency: 'IRR',
      subtotal: 12_500_000n,
      taxTotal: 1_125_000n,
      grandTotal: 13_625_000n,
      paidTotal: 13_625_000n,
      refundedTotal: 1_000_000n,
      shippingAddressSnapshot: order1ShippingSnapshot,
      items: {
        create: {
          productSkuId: sku.id,
          skuSnapshot: sku.skuCode,
          nameSnapshot: 'Ray-Ban Aviator Classic',
          unitPriceSnapshot: 12_500_000n,
          quantity: 1,
          taxAmount: 1_125_000n,
          lineTotal: 12_500_000n,
        },
      },
      statusHistory: {
        create: [
          {
            fromStatus: null,
            toStatus: 'PENDING_PAYMENT',
            note: 'Order created from a verified payment',
          },
          {
            fromStatus: 'PENDING_PAYMENT',
            toStatus: 'PAID',
            note: 'Payment verified — order marked PAID',
          },
        ],
      },
    },
  });
  await prisma.invoice.upsert({
    where: { orderId: order1.id },
    update: {},
    create: {
      invoiceNumber: await nextInvoiceNumber(),
      orderId: order1.id,
      customerId: customer.id,
      status: 'ISSUED',
      currency: 'IRR',
      subtotal: 12_500_000n,
      taxTotal: 1_125_000n,
      grandTotal: 13_625_000n,
      issuedAt: new Date(),
      items: {
        create: {
          description: 'Ray-Ban Aviator Classic',
          quantity: 1,
          unitPrice: 12_500_000n,
          lineTotal: 12_500_000n,
        },
      },
    },
  });

  // --- Order 2 — genuinely UNPAID/PENDING_PAYMENT: not a normally-
  // reachable customer-facing state (an Order is only ever created from
  // an already-verified payment, ADR-009 decision 4), but a real one —
  // this represents the narrow crash-recovery window where
  // `OrderConversionService.convertFromCheckout()`'s `orders.create()`
  // step succeeded but the process died before the following PAID
  // transition/invoice issuance/`checkout.markConverted()` steps ran.
  // Its own guest checkout stays READY_FOR_PAYMENT (never reached
  // `markConverted()`), even though its payment intent already
  // SUCCEEDED/VERIFIED — a real, if unusual, mid-flight combination.
  //
  // Both `OrderConversionService.convertFromCheckout()` and the
  // `order_conversion` sweep's own second pass now resume cleanly from
  // exactly this state (see that service's own inline comment and
  // `OrderConversionProcessor`'s) — this fixture exists so that resume
  // path has something real to exercise on a freshly-seeded database. If
  // the API is actually running against this database, expect the sweep
  // to resolve it to PAID within `ORDER_STUCK_PENDING_GRACE_MS` of
  // starting up — that's the fix working as intended, not seed data
  // silently rotting; re-run `pnpm seed` for a fresh one on demand. ---
  const order2GuestToken = 'seed-guest-cart-token-unpaid-000000000000000000';
  const order2Cart = await prisma.cart.upsert({
    where: { id: '00000000-0000-4000-9000-000000000009' },
    update: {},
    create: {
      id: '00000000-0000-4000-9000-000000000009',
      guestToken: order2GuestToken,
      status: 'CHECKOUT_STARTED',
      currency: 'IRR',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000),
    },
  });
  await prisma.cartItem.upsert({
    where: {
      cartId_productSkuId_configurationHash: {
        cartId: order2Cart.id,
        productSkuId: clubmasterSku.id,
        configurationHash: '',
      },
    },
    update: {},
    create: {
      cartId: order2Cart.id,
      productSkuId: clubmasterSku.id,
      quantity: 1,
      unitPriceSnapshot: 9_800_000n,
      currency: 'IRR',
    },
  });
  const order2Checkout = await prisma.checkoutSession.upsert({
    where: { idempotencyKey: 'SEED-CHECKOUT-STUCK-ORDER-1' },
    update: {},
    create: {
      id: '00000000-0000-4000-9000-00000000000a',
      cartId: order2Cart.id,
      guestToken: order2GuestToken,
      status: 'READY_FOR_PAYMENT',
      currency: 'IRR',
      subtotal: 9_800_000n,
      taxTotal: 882_000n,
      grandTotal: 10_682_000n,
      idempotencyKey: 'SEED-CHECKOUT-STUCK-ORDER-1',
      expiresAt: new Date(Date.now() + 20 * 60_000),
    },
  });
  const order2Intent = await prisma.paymentIntent.upsert({
    where: { checkoutSessionId: order2Checkout.id },
    update: {},
    create: {
      checkoutSessionId: order2Checkout.id,
      providerId: zarinpalProvider.id,
      status: 'SUCCEEDED',
      amount: 10_682_000n,
      currency: 'IRR',
      idempotencyKey: 'SEED-PAYMENT-STUCK-ORDER-1',
      expiresAt: new Date(Date.now() + 30 * 60_000),
    },
  });
  const order2Attempt = await prisma.paymentAttempt.upsert({
    where: {
      paymentIntentId_attemptNumber: { paymentIntentId: order2Intent.id, attemptNumber: 1 },
    },
    update: {},
    create: {
      paymentIntentId: order2Intent.id,
      attemptNumber: 1,
      providerAuthority: 'SEED-AUTHORITY-STUCK-000000000000000000000000',
      status: 'RETURNED',
      returnedAt: new Date(),
    },
  });
  await prisma.paymentTransaction.upsert({
    where: {
      providerId_providerReference: {
        providerId: zarinpalProvider.id,
        providerReference: 'SEED-REFID-STUCK-1',
      },
    },
    update: {},
    create: {
      paymentIntentId: order2Intent.id,
      paymentAttemptId: order2Attempt.id,
      providerId: zarinpalProvider.id,
      providerReference: 'SEED-REFID-STUCK-1',
      amount: 10_682_000n,
      currency: 'IRR',
      status: 'VERIFIED',
      verifiedAt: new Date(),
      rawVerificationResponse: { code: 100, message: 'Verified', ref_id: 'SEED-REFID-STUCK-1' },
    },
  });
  let order2 = await prisma.order.findUnique({ where: { checkoutSessionId: order2Checkout.id } });
  order2 ??= await prisma.order.create({
    data: {
      orderNumber: await nextOrderNumber(),
      checkoutSessionId: order2Checkout.id,
      paymentIntentId: order2Intent.id,
      guestToken: order2GuestToken,
      source: 'STOREFRONT',
      // status/paymentStatus/fulfillmentStatus/paidTotal/refundedTotal
      // deliberately left at their schema defaults (PENDING_PAYMENT/
      // UNPAID/UNFULFILLED/0/0) — see this fixture's own comment above.
      currency: 'IRR',
      subtotal: 9_800_000n,
      taxTotal: 882_000n,
      grandTotal: 10_682_000n,
      shippingAddressSnapshot: {},
      items: {
        create: {
          productSkuId: clubmasterSku.id,
          skuSnapshot: clubmasterSku.skuCode,
          nameSnapshot: 'Ray-Ban Clubmaster Classic',
          unitPriceSnapshot: 9_800_000n,
          quantity: 1,
          taxAmount: 882_000n,
          lineTotal: 9_800_000n,
        },
      },
      statusHistory: {
        create: {
          fromStatus: null,
          toStatus: 'PENDING_PAYMENT',
          note: 'Order created from a verified payment',
        },
      },
    },
  });

  // --- Order 3 — PAID then CANCELLED. paymentStatus stays PAID (never
  // auto-refunded on cancel — a real, deliberate, documented gap, ADR-009
  // decision 10 and this module's own OrderService.cancel() doc comment;
  // same shape as RefundService's own Phase 008 gap). ---
  const order3Cart = await prisma.cart.upsert({
    where: { id: '00000000-0000-4000-9000-00000000000b' },
    update: {},
    create: {
      id: '00000000-0000-4000-9000-00000000000b',
      customerId: customer.id,
      status: 'CHECKOUT_STARTED',
      currency: 'IRR',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000),
    },
  });
  await prisma.cartItem.upsert({
    where: {
      cartId_productSkuId_configurationHash: {
        cartId: order3Cart.id,
        productSkuId: clubmasterSku.id,
        configurationHash: '',
      },
    },
    update: {},
    create: {
      cartId: order3Cart.id,
      productSkuId: clubmasterSku.id,
      quantity: 2,
      unitPriceSnapshot: 9_800_000n,
      currency: 'IRR',
    },
  });
  const order3Checkout = await prisma.checkoutSession.upsert({
    where: { idempotencyKey: 'SEED-CHECKOUT-CANCELLED-ORDER-1' },
    update: {},
    create: {
      id: '00000000-0000-4000-9000-00000000000c',
      cartId: order3Cart.id,
      customerId: customer.id,
      status: 'CONVERTED',
      currency: 'IRR',
      subtotal: 19_600_000n,
      taxTotal: 1_764_000n,
      grandTotal: 21_364_000n,
      idempotencyKey: 'SEED-CHECKOUT-CANCELLED-ORDER-1',
      expiresAt: new Date(Date.now() + 20 * 60_000),
    },
  });
  const order3Intent = await prisma.paymentIntent.upsert({
    where: { checkoutSessionId: order3Checkout.id },
    update: {},
    create: {
      checkoutSessionId: order3Checkout.id,
      customerId: customer.id,
      providerId: zarinpalProvider.id,
      status: 'SUCCEEDED',
      amount: 21_364_000n,
      currency: 'IRR',
      idempotencyKey: 'SEED-PAYMENT-CANCELLED-ORDER-1',
      expiresAt: new Date(Date.now() + 30 * 60_000),
    },
  });
  const order3Attempt = await prisma.paymentAttempt.upsert({
    where: {
      paymentIntentId_attemptNumber: { paymentIntentId: order3Intent.id, attemptNumber: 1 },
    },
    update: {},
    create: {
      paymentIntentId: order3Intent.id,
      attemptNumber: 1,
      providerAuthority: 'SEED-AUTHORITY-CANCELLED-00000000000000000000',
      status: 'RETURNED',
      returnedAt: new Date(),
    },
  });
  await prisma.paymentTransaction.upsert({
    where: {
      providerId_providerReference: {
        providerId: zarinpalProvider.id,
        providerReference: 'SEED-REFID-CANCELLED-1',
      },
    },
    update: {},
    create: {
      paymentIntentId: order3Intent.id,
      paymentAttemptId: order3Attempt.id,
      providerId: zarinpalProvider.id,
      providerReference: 'SEED-REFID-CANCELLED-1',
      amount: 21_364_000n,
      currency: 'IRR',
      status: 'VERIFIED',
      verifiedAt: new Date(),
      rawVerificationResponse: { code: 100, message: 'Verified', ref_id: 'SEED-REFID-CANCELLED-1' },
    },
  });
  let order3 = await prisma.order.findUnique({ where: { checkoutSessionId: order3Checkout.id } });
  order3 ??= await prisma.order.create({
    data: {
      orderNumber: await nextOrderNumber(),
      checkoutSessionId: order3Checkout.id,
      paymentIntentId: order3Intent.id,
      customerId: customer.id,
      source: 'STOREFRONT',
      status: 'CANCELLED',
      paymentStatus: 'PAID',
      fulfillmentStatus: 'UNFULFILLED',
      currency: 'IRR',
      subtotal: 19_600_000n,
      taxTotal: 1_764_000n,
      grandTotal: 21_364_000n,
      paidTotal: 21_364_000n,
      cancelledAt: new Date(),
      shippingAddressSnapshot: order1ShippingSnapshot,
      items: {
        create: {
          productSkuId: clubmasterSku.id,
          skuSnapshot: clubmasterSku.skuCode,
          nameSnapshot: 'Ray-Ban Clubmaster Classic',
          unitPriceSnapshot: 9_800_000n,
          quantity: 2,
          taxAmount: 1_764_000n,
          lineTotal: 19_600_000n,
        },
      },
      statusHistory: {
        create: [
          {
            fromStatus: null,
            toStatus: 'PENDING_PAYMENT',
            note: 'Order created from a verified payment',
          },
          {
            fromStatus: 'PENDING_PAYMENT',
            toStatus: 'PAID',
            note: 'Payment verified — order marked PAID',
          },
          {
            fromStatus: 'PAID',
            toStatus: 'CANCELLED',
            changedBy: adminUser.id,
            note: 'Cancelled — customer requested cancellation before fulfillment',
          },
        ],
      },
    },
  });
  await prisma.invoice.upsert({
    where: { orderId: order3.id },
    update: {},
    create: {
      invoiceNumber: await nextInvoiceNumber(),
      orderId: order3.id,
      customerId: customer.id,
      status: 'ISSUED',
      currency: 'IRR',
      subtotal: 19_600_000n,
      taxTotal: 1_764_000n,
      grandTotal: 21_364_000n,
      issuedAt: new Date(),
      items: {
        create: {
          description: 'Ray-Ban Clubmaster Classic',
          quantity: 2,
          unitPrice: 9_800_000n,
          lineTotal: 19_600_000n,
        },
      },
    },
  });

  // --- Order 4 — the full happy path: PAID -> PROCESSING ->
  // READY_TO_FULFILL -> FULFILLED, one Fulfillment (DELIVERED) covering
  // both order lines, one Shipment (DELIVERED) with a real tracking
  // history, and an issued Invoice. ---
  const order4Cart = await prisma.cart.upsert({
    where: { id: '00000000-0000-4000-9000-00000000000d' },
    update: {},
    create: {
      id: '00000000-0000-4000-9000-00000000000d',
      customerId: customer.id,
      status: 'CHECKOUT_STARTED',
      currency: 'IRR',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000),
    },
  });
  for (const [productSkuId, quantity, unitPrice] of [
    [sku.id, 1, 12_500_000n],
    [clubmasterSku.id, 1, 9_800_000n],
  ] as const) {
    await prisma.cartItem.upsert({
      where: {
        cartId_productSkuId_configurationHash: {
          cartId: order4Cart.id,
          productSkuId,
          configurationHash: '',
        },
      },
      update: {},
      create: {
        cartId: order4Cart.id,
        productSkuId,
        quantity,
        unitPriceSnapshot: unitPrice,
        currency: 'IRR',
      },
    });
  }
  const order4Checkout = await prisma.checkoutSession.upsert({
    where: { idempotencyKey: 'SEED-CHECKOUT-FULFILLED-ORDER-1' },
    update: {},
    create: {
      id: '00000000-0000-4000-9000-00000000000e',
      cartId: order4Cart.id,
      customerId: customer.id,
      status: 'CONVERTED',
      currency: 'IRR',
      subtotal: 22_300_000n,
      taxTotal: 2_007_000n,
      grandTotal: 24_307_000n,
      idempotencyKey: 'SEED-CHECKOUT-FULFILLED-ORDER-1',
      expiresAt: new Date(Date.now() + 20 * 60_000),
    },
  });
  const order4Intent = await prisma.paymentIntent.upsert({
    where: { checkoutSessionId: order4Checkout.id },
    update: {},
    create: {
      checkoutSessionId: order4Checkout.id,
      customerId: customer.id,
      providerId: zarinpalProvider.id,
      status: 'SUCCEEDED',
      amount: 24_307_000n,
      currency: 'IRR',
      idempotencyKey: 'SEED-PAYMENT-FULFILLED-ORDER-1',
      expiresAt: new Date(Date.now() + 30 * 60_000),
    },
  });
  const order4Attempt = await prisma.paymentAttempt.upsert({
    where: {
      paymentIntentId_attemptNumber: { paymentIntentId: order4Intent.id, attemptNumber: 1 },
    },
    update: {},
    create: {
      paymentIntentId: order4Intent.id,
      attemptNumber: 1,
      providerAuthority: 'SEED-AUTHORITY-FULFILLED-00000000000000000000',
      status: 'RETURNED',
      returnedAt: new Date(),
    },
  });
  await prisma.paymentTransaction.upsert({
    where: {
      providerId_providerReference: {
        providerId: zarinpalProvider.id,
        providerReference: 'SEED-REFID-FULFILLED-1',
      },
    },
    update: {},
    create: {
      paymentIntentId: order4Intent.id,
      paymentAttemptId: order4Attempt.id,
      providerId: zarinpalProvider.id,
      providerReference: 'SEED-REFID-FULFILLED-1',
      amount: 24_307_000n,
      currency: 'IRR',
      status: 'VERIFIED',
      verifiedAt: new Date(),
      rawVerificationResponse: { code: 100, message: 'Verified', ref_id: 'SEED-REFID-FULFILLED-1' },
    },
  });
  let order4 = await prisma.order.findUnique({ where: { checkoutSessionId: order4Checkout.id } });
  order4 ??= await prisma.order.create({
    data: {
      orderNumber: await nextOrderNumber(),
      checkoutSessionId: order4Checkout.id,
      paymentIntentId: order4Intent.id,
      customerId: customer.id,
      source: 'STOREFRONT',
      status: 'FULFILLED',
      paymentStatus: 'PAID',
      fulfillmentStatus: 'FULFILLED',
      currency: 'IRR',
      subtotal: 22_300_000n,
      taxTotal: 2_007_000n,
      grandTotal: 24_307_000n,
      paidTotal: 24_307_000n,
      shippingAddressSnapshot: order1ShippingSnapshot,
      items: {
        create: [
          {
            productSkuId: sku.id,
            skuSnapshot: sku.skuCode,
            nameSnapshot: 'Ray-Ban Aviator Classic',
            unitPriceSnapshot: 12_500_000n,
            quantity: 1,
            taxAmount: 1_125_000n,
            lineTotal: 12_500_000n,
          },
          {
            productSkuId: clubmasterSku.id,
            skuSnapshot: clubmasterSku.skuCode,
            nameSnapshot: 'Ray-Ban Clubmaster Classic',
            unitPriceSnapshot: 9_800_000n,
            quantity: 1,
            taxAmount: 882_000n,
            lineTotal: 9_800_000n,
          },
        ],
      },
      statusHistory: {
        create: [
          {
            fromStatus: null,
            toStatus: 'PENDING_PAYMENT',
            note: 'Order created from a verified payment',
          },
          {
            fromStatus: 'PENDING_PAYMENT',
            toStatus: 'PAID',
            note: 'Payment verified — order marked PAID',
          },
          {
            fromStatus: 'PAID',
            toStatus: 'PROCESSING',
            changedBy: adminUser.id,
            note: 'Approved for processing',
          },
          {
            fromStatus: 'PROCESSING',
            toStatus: 'READY_TO_FULFILL',
            changedBy: adminUser.id,
            note: 'Stock allocated, ready to pack',
          },
          {
            fromStatus: 'READY_TO_FULFILL',
            toStatus: 'FULFILLED',
            changedBy: adminUser.id,
            note: 'All items fulfilled and delivered',
          },
        ],
      },
    },
  });
  const order4Items = await prisma.orderItem.findMany({ where: { orderId: order4.id } });
  const order4AviatorItem = order4Items.find((item) => item.productSkuId === sku.id);
  const order4ClubmasterItem = order4Items.find((item) => item.productSkuId === clubmasterSku.id);
  if (!order4AviatorItem || !order4ClubmasterItem) {
    throw new Error('[seed] order4 fulfillment fixture: expected order items missing');
  }

  let order4Fulfillment = await prisma.fulfillment.findFirst({ where: { orderId: order4.id } });
  order4Fulfillment ??= await prisma.fulfillment.create({
    data: {
      orderId: order4.id,
      status: 'DELIVERED',
      warehouseId: warehouseCentral.id,
      packedAt: new Date(Date.now() - 3 * 24 * 60 * 60_000),
      shippedAt: new Date(Date.now() - 2 * 24 * 60 * 60_000),
      deliveredAt: new Date(Date.now() - 1 * 24 * 60 * 60_000),
      items: {
        create: [
          { orderItemId: order4AviatorItem.id, quantity: 1 },
          { orderItemId: order4ClubmasterItem.id, quantity: 1 },
        ],
      },
    },
  });
  await prisma.shipment.upsert({
    where: { fulfillmentId: order4Fulfillment.id },
    update: {},
    create: {
      fulfillmentId: order4Fulfillment.id,
      carrier: 'Tipax',
      trackingNumber: 'SEED-TRACKING-000000000001',
      status: 'DELIVERED',
      shippedAt: new Date(Date.now() - 2 * 24 * 60 * 60_000),
      deliveredAt: new Date(Date.now() - 1 * 24 * 60 * 60_000),
      events: {
        create: [
          {
            status: 'PENDING',
            source: 'MANUAL_ADMIN',
            occurredAt: new Date(Date.now() - 3 * 24 * 60 * 60_000),
          },
          {
            status: 'IN_TRANSIT',
            location: 'Tehran sorting hub',
            source: 'MANUAL_ADMIN',
            occurredAt: new Date(Date.now() - 2 * 24 * 60 * 60_000),
          },
          {
            status: 'DELIVERED',
            location: 'Valiasr St, No. 100, Tehran',
            source: 'MANUAL_ADMIN',
            occurredAt: new Date(Date.now() - 1 * 24 * 60 * 60_000),
          },
        ],
      },
    },
  });
  await prisma.invoice.upsert({
    where: { orderId: order4.id },
    update: {},
    create: {
      invoiceNumber: await nextInvoiceNumber(),
      orderId: order4.id,
      customerId: customer.id,
      status: 'ISSUED',
      currency: 'IRR',
      subtotal: 22_300_000n,
      taxTotal: 2_007_000n,
      grandTotal: 24_307_000n,
      issuedAt: new Date(),
      items: {
        create: [
          {
            description: 'Ray-Ban Aviator Classic',
            quantity: 1,
            unitPrice: 12_500_000n,
            lineTotal: 12_500_000n,
          },
          {
            description: 'Ray-Ban Clubmaster Classic',
            quantity: 1,
            unitPrice: 9_800_000n,
            lineTotal: 9_800_000n,
          },
        ],
      },
    },
  });

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
    '[seed] done — RBAC (57 real permissions across identity/catalog/inventory/payment/order, ' +
      'role inheritance, a deny-override), admin/customer/support/catalog-editor/inventory-role/' +
      'payment-role/order-role users, demo customer, catalog (3 products — two PUBLISHED with ' +
      'variant+SKU+price+media/collection, one DRAFT), inventory (2 warehouses, 3 locations, ' +
      'stock for all SKUs, 2 reservations, a low-stock example, a transfer), coupon, ' +
      'cart-checkout (2 shipping methods, pricing settings, an active customer cart, a guest ' +
      'cart, a checkout-ready fixture with a real reservation, an expired checkout), payment ' +
      '(ZarinPal provider, a SUCCEEDED intent with a VERIFIED transaction + partial refund, a ' +
      'FAILED intent with a mismatched transaction, an unresolved AMOUNT_MISMATCH reconciliation ' +
      'finding), order (a PAID/PARTIALLY_REFUNDED order + issued invoice, a genuinely UNPAID/' +
      'PENDING_PAYMENT order demonstrating the conversion crash-recovery window, a PAID-then-' +
      'CANCELLED order + issued invoice, a FULFILLED order with a DELIVERED fulfillment/' +
      'shipment/tracking history + issued invoice), CMS/notification/system basics.',
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
