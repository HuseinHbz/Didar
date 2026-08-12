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
import { createHash } from 'node:crypto';

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
    description: 'Full identity-module access',
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
  // catalog — brand, category, product, variant, attribute, lens lookups
  // ---------------------------------------------------------------------
  const brand = await prisma.brand.upsert({
    where: { slug: 'ray-ban' },
    update: {},
    create: { name: 'Ray-Ban', slug: 'ray-ban' },
  });

  const category = await prisma.category.upsert({
    where: { slug: 'sunglasses' },
    update: {},
    create: { name: 'عینک آفتابی', slug: 'sunglasses' },
  });

  const product = await prisma.product.upsert({
    where: { sku: 'RB-AVIATOR-001' },
    update: {},
    create: {
      brandId: brand.id,
      categoryId: category.id,
      sku: 'RB-AVIATOR-001',
      name: 'Ray-Ban Aviator Classic',
      slug: 'ray-ban-aviator-classic',
      description: 'The original pilot sunglasses, unchanged since 1937.',
      gender: 'UNISEX',
      status: 'ACTIVE',
    },
  });

  const colorAttribute = await prisma.productAttribute.upsert({
    where: { key: 'frame_color' },
    update: {},
    create: { key: 'frame_color', name: 'رنگ فریم' },
  });
  const goldValue = await prisma.productAttributeValue.upsert({
    where: { attributeId_value: { attributeId: colorAttribute.id, value: 'Gold' } },
    update: {},
    create: { attributeId: colorAttribute.id, value: 'Gold' },
  });

  const variant = await prisma.productVariant.upsert({
    where: { sku: 'RB-AVIATOR-001-GOLD-58' },
    update: {},
    create: {
      productId: product.id,
      sku: 'RB-AVIATOR-001-GOLD-58',
      color: 'Gold',
      size: '58mm',
      isDefault: true,
      status: 'ACTIVE',
    },
  });
  await prisma.productVariantAttributeValue.upsert({
    where: {
      variantId_attributeValueId: { variantId: variant.id, attributeValueId: goldValue.id },
    },
    update: {},
    create: { variantId: variant.id, attributeValueId: goldValue.id },
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

  // ---------------------------------------------------------------------
  // finance — the variant's price (Rial, BigInt — never Float)
  // ---------------------------------------------------------------------
  await prisma.productPrice.upsert({
    where: { productVariantId: variant.id },
    update: {},
    create: {
      productVariantId: variant.id,
      basePrice: 12_500_000n,
      costPrice: 8_000_000n,
      currency: 'IRR',
    },
  });

  // ---------------------------------------------------------------------
  // inventory — a warehouse with stock for the seeded variant
  // ---------------------------------------------------------------------
  const warehouse = await prisma.warehouse.upsert({
    where: { code: 'WH-TEHRAN-01' },
    update: {},
    create: { code: 'WH-TEHRAN-01', name: 'Tehran Main Warehouse', address: 'Tehran, Iran' },
  });

  const inventoryItem = await prisma.inventoryItem.upsert({
    where: {
      warehouseId_productVariantId: { warehouseId: warehouse.id, productVariantId: variant.id },
    },
    update: {},
    create: {
      warehouseId: warehouse.id,
      productVariantId: variant.id,
      quantityOnHand: 50,
      quantityReserved: 0,
      reorderPoint: 10,
    },
  });
  const existingStockTx = await prisma.inventoryTransaction.findFirst({
    where: { inventoryItemId: inventoryItem.id, type: 'PURCHASE', reference: 'SEED-INITIAL-STOCK' },
  });
  if (!existingStockTx) {
    await prisma.inventoryTransaction.create({
      data: {
        inventoryItemId: inventoryItem.id,
        type: 'PURCHASE',
        quantityDelta: 50,
        reference: 'SEED-INITIAL-STOCK',
        note: 'Initial seed stock',
      },
    });
  }

  // ---------------------------------------------------------------------
  // marketing — a welcome coupon
  // ---------------------------------------------------------------------
  await prisma.coupon.upsert({
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
    '[seed] done — RBAC (2 real permissions checked in code, role inheritance, a deny-override), ' +
      'admin/customer/support users, demo customer, one product+variant+price+stock, coupon, ' +
      'CMS/notification/system basics.',
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
