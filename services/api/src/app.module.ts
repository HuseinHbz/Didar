import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { loadEnv } from './config/env';
import { CartCheckoutModule } from './modules/cart-checkout/cart-checkout.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { CustomerModule } from './modules/customer/customer.module';
import { HealthModule } from './modules/health/health.module';
import { IdentityModule } from './modules/identity/identity.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { OrderModule } from './modules/order/order.module';
import { PaymentModule } from './modules/payment/payment.module';
import { ReturnModule } from './modules/return/return.module';

/**
 * Root module. Deliberately thin: every domain gets its own module under
 * src/modules/<domain>/ (blueprint §2/§3) and is wired in here — nothing else.
 *
 * `health`, `identity`, `catalog`, `inventory`, `cart-checkout`, `payment`,
 * and `order` exist so far — each a real clean-architecture module
 * (domain/application/infrastructure/presentation). `identity` is the
 * original template (see its README); `catalog` (Phase 005), `inventory`
 * (Phase 006), `cart-checkout` (Phase 007), `payment` (Phase 008), and
 * `order` (Phase 009) follow the same layering with a deliberately coarser
 * application-layer granularity (application services, not one use-case
 * class per action) — see each module's own README. `inventory` is also
 * the first module registering its own BullMQ queues in-process (see
 * `modules/inventory/infrastructure/queues` and
 * `docs/adr/ADR-006-inventory-architecture.md` decision 8). `cart-checkout`
 * is the first module composed entirely from other modules' exported
 * services rather than owning its own catalog/inventory logic — see
 * `docs/adr/ADR-007-cart-checkout.md` decisions 4 and 5. `payment` follows
 * the same composed-from-another-module's-service shape, importing
 * `CartCheckoutModule` for its exported `CheckoutService`
 * (`docs/adr/ADR-008-payment-orchestration.md` decision 10). `order` is
 * composed from four prior modules at once (`cart-checkout`, `catalog`,
 * `inventory`, `payment` — `docs/adr/ADR-009-order-fulfillment.md`
 * decision 9), the deepest composition chain in this codebase so far.
 * `return` (Phase 012) composes from `order`, `payment`, and `inventory`
 * at once (`docs/adr/ADR-012-returns-refunds-credit-notes.md` decision
 * 2/6) — never a second refund pathway, only the existing `RefundService`
 * extended additively. `customer` (CP-019,
 * `docs/adr/ADR-019-customer-domain-prescription.md`) is self-contained
 * (no cross-module imports) — it only re-binds `AUDIT_LOG_REPOSITORY`
 * locally, same as every other module here.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: loadEnv }),
    HealthModule,
    IdentityModule,
    CatalogModule,
    InventoryModule,
    CartCheckoutModule,
    PaymentModule,
    OrderModule,
    ReturnModule,
    CustomerModule,
  ],
})
export class AppModule {}
