import type { CouponStatus } from '@iecp/types';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import {
  AUDIT_LOG_REPOSITORY,
  type AuditLogRepositoryPort,
} from '../../identity/domain/ports/audit-log.repository.port';
import type { Coupon } from '../domain/entities/coupon.entity';
import {
  COUPON_REPOSITORY,
  type CouponRepositoryPort,
  type CreateCouponInput,
} from '../domain/ports/coupon.repository.port';
import { CouponLifecycle } from '../domain/services/coupon-lifecycle';
import { CouponCode } from '../domain/value-objects/coupon-code';

/** Admin CRUD + lifecycle for `Coupon` (§17). Every code is normalized
 * before write/lookup (ADR-010 decision 2) — the one place that
 * normalization happens on the write path. Every mutation is
 * audit-logged (§20), same reused `AUDIT_LOG_REPOSITORY` port
 * `PromotionService`/`catalog`/`order` already write through. */
@Injectable()
export class CouponService {
  constructor(
    @Inject(COUPON_REPOSITORY) private readonly coupons: CouponRepositoryPort,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLog: AuditLogRepositoryPort,
  ) {}

  async create(input: CreateCouponInput, actorId: string): Promise<Coupon> {
    const coupon = await this.coupons.create({ ...input, code: CouponCode.normalize(input.code) });
    await this.auditLog.record({
      actorId,
      action: 'COUPON_CREATED',
      entityType: 'Coupon',
      entityId: coupon.id,
      newValue: { code: coupon.code, promotionId: coupon.promotionId },
    });
    return coupon;
  }

  async get(id: string): Promise<Coupon> {
    return this.getOrThrow(id);
  }

  async listByPromotion(promotionId: string): Promise<Coupon[]> {
    return this.coupons.listByPromotion(promotionId);
  }

  async pause(id: string, actorId: string): Promise<Coupon> {
    return this.transition(id, 'PAUSED', actorId);
  }

  async activate(id: string, actorId: string): Promise<Coupon> {
    return this.transition(id, 'ACTIVE', actorId);
  }

  async disable(id: string, actorId: string): Promise<Coupon> {
    return this.transition(id, 'DISABLED', actorId);
  }

  private async transition(id: string, to: CouponStatus, actorId: string): Promise<Coupon> {
    const coupon = await this.getOrThrow(id);
    if (CouponLifecycle.isNoOp(coupon.status, to)) return coupon;
    CouponLifecycle.assertTransition(coupon.status, to);
    const updated = await this.coupons.updateStatus(id, to);
    await this.auditLog.record({
      actorId,
      action: 'COUPON_STATUS_CHANGED',
      entityType: 'Coupon',
      entityId: id,
      oldValue: { status: coupon.status },
      newValue: { status: to },
    });
    return updated;
  }

  private async getOrThrow(id: string): Promise<Coupon> {
    const coupon = await this.coupons.findById(id);
    if (!coupon) throw new NotFoundException('Coupon not found');
    return coupon;
  }
}
