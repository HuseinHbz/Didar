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
import { prisma } from '../src/client.js';

async function main(): Promise<void> {
  // ---------------------------------------------------------------------
  // identity — permissions, roles, an admin user, a customer-facing user
  // ---------------------------------------------------------------------
  const permissionKeys = ['product.publish', 'order.manage', 'refund.approve', 'user.manage'];
  const permissions = await Promise.all(
    permissionKeys.map((key) =>
      prisma.permission.upsert({
        where: { key },
        update: {},
        create: { key, description: `Permission: ${key}` },
      }),
    ),
  );

  const adminRole = await prisma.role.upsert({
    where: { name: 'admin' },
    update: {},
    create: { name: 'admin', description: 'Full platform access', isSystem: true },
  });
  const customerRole = await prisma.role.upsert({
    where: { name: 'customer' },
    update: {},
    create: { name: 'customer', description: 'Storefront customer', isSystem: true },
  });

  await Promise.all(
    permissions.map((permission) =>
      prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: adminRole.id, permissionId: permission.id } },
        update: {},
        create: { roleId: adminRole.id, permissionId: permission.id },
      }),
    ),
  );

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
    '[seed] done — admin user, demo customer, one product+variant+price+stock, coupon, CMS/notification/system basics.',
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
