import type { CouponStatus } from '@iecp/types';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';

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
 * normalization happens on the write path. */
@Injectable()
export class CouponService {
  constructor(@Inject(COUPON_REPOSITORY) private readonly coupons: CouponRepositoryPort) {}

  async create(input: CreateCouponInput): Promise<Coupon> {
    return this.coupons.create({ ...input, code: CouponCode.normalize(input.code) });
  }

  async get(id: string): Promise<Coupon> {
    return this.getOrThrow(id);
  }

  async listByPromotion(promotionId: string): Promise<Coupon[]> {
    return this.coupons.listByPromotion(promotionId);
  }

  async pause(id: string): Promise<Coupon> {
    return this.transition(id, 'PAUSED');
  }

  async activate(id: string): Promise<Coupon> {
    return this.transition(id, 'ACTIVE');
  }

  async disable(id: string): Promise<Coupon> {
    return this.transition(id, 'DISABLED');
  }

  private async transition(id: string, to: CouponStatus): Promise<Coupon> {
    const coupon = await this.getOrThrow(id);
    if (CouponLifecycle.isNoOp(coupon.status, to)) return coupon;
    CouponLifecycle.assertTransition(coupon.status, to);
    return this.coupons.updateStatus(id, to);
  }

  private async getOrThrow(id: string): Promise<Coupon> {
    const coupon = await this.coupons.findById(id);
    if (!coupon) throw new NotFoundException('Coupon not found');
    return coupon;
  }
}
