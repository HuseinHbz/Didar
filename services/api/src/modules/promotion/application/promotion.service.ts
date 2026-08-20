import type { PromotionStatus } from '@iecp/types';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import {
  AUDIT_LOG_REPOSITORY,
  type AuditLogRepositoryPort,
} from '../../identity/domain/ports/audit-log.repository.port';
import type { Promotion } from '../domain/entities/promotion.entity';
import {
  PROMOTION_REPOSITORY,
  type CreatePromotionInput,
  type PromotionRepositoryPort,
  type UpdatePromotionInput,
} from '../domain/ports/promotion.repository.port';
import { PromotionLifecycle } from '../domain/services/promotion-lifecycle';

/** Admin CRUD + lifecycle for `Promotion` (§17). No discount calculation
 * or eligibility logic here — that's `PromotionResolutionService`'s job;
 * this service only manages the aggregate's own data and status machine.
 * Every mutation is audit-logged (§20) via `AUDIT_LOG_REPOSITORY`, the
 * same reused port `catalog`/`order` already write through. */
@Injectable()
export class PromotionService {
  constructor(
    @Inject(PROMOTION_REPOSITORY) private readonly promotions: PromotionRepositoryPort,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLog: AuditLogRepositoryPort,
  ) {}

  async create(input: CreatePromotionInput, actorId: string): Promise<Promotion> {
    const promotion = await this.promotions.create(input);
    await this.auditLog.record({
      actorId,
      action: 'PROMOTION_CREATED',
      entityType: 'Promotion',
      entityId: promotion.id,
      newValue: { name: promotion.name, discountType: promotion.discountType },
    });
    return promotion;
  }

  async update(id: string, input: UpdatePromotionInput, actorId: string): Promise<Promotion> {
    const before = await this.getOrThrow(id);
    const updated = await this.promotions.update(id, input);
    await this.auditLog.record({
      actorId,
      action: 'PROMOTION_UPDATED',
      entityType: 'Promotion',
      entityId: id,
      oldValue: { name: before.name },
      newValue: { name: updated.name },
    });
    return updated;
  }

  async get(id: string): Promise<Promotion> {
    return this.getOrThrow(id);
  }

  async list(filter: {
    status?: PromotionStatus;
    limit: number;
    offset: number;
  }): Promise<{ items: Promotion[]; total: number }> {
    return this.promotions.list(filter);
  }

  async activate(id: string, actorId: string): Promise<Promotion> {
    return this.transition(id, 'ACTIVE', actorId);
  }

  async pause(id: string, actorId: string): Promise<Promotion> {
    return this.transition(id, 'PAUSED', actorId);
  }

  async archive(id: string, actorId: string): Promise<Promotion> {
    return this.transition(id, 'ARCHIVED', actorId);
  }

  private async transition(id: string, to: PromotionStatus, actorId: string): Promise<Promotion> {
    const promotion = await this.getOrThrow(id);
    if (PromotionLifecycle.isNoOp(promotion.status, to)) return promotion;
    PromotionLifecycle.assertTransition(promotion.status, to);
    const updated = await this.promotions.updateStatus(id, to);
    await this.auditLog.record({
      actorId,
      action: 'PROMOTION_STATUS_CHANGED',
      entityType: 'Promotion',
      entityId: id,
      oldValue: { status: promotion.status },
      newValue: { status: to },
    });
    return updated;
  }

  private async getOrThrow(id: string): Promise<Promotion> {
    const promotion = await this.promotions.findById(id);
    if (!promotion) throw new NotFoundException('Promotion not found');
    return promotion;
  }
}
