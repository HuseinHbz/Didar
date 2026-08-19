import type { PromotionStatus } from '@iecp/types';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';

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
 * this service only manages the aggregate's own data and status machine. */
@Injectable()
export class PromotionService {
  constructor(@Inject(PROMOTION_REPOSITORY) private readonly promotions: PromotionRepositoryPort) {}

  async create(input: CreatePromotionInput): Promise<Promotion> {
    return this.promotions.create(input);
  }

  async update(id: string, input: UpdatePromotionInput): Promise<Promotion> {
    await this.getOrThrow(id);
    return this.promotions.update(id, input);
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

  async activate(id: string): Promise<Promotion> {
    return this.transition(id, 'ACTIVE');
  }

  async pause(id: string): Promise<Promotion> {
    return this.transition(id, 'PAUSED');
  }

  async archive(id: string): Promise<Promotion> {
    return this.transition(id, 'ARCHIVED');
  }

  private async transition(id: string, to: PromotionStatus): Promise<Promotion> {
    const promotion = await this.getOrThrow(id);
    if (PromotionLifecycle.isNoOp(promotion.status, to)) return promotion;
    PromotionLifecycle.assertTransition(promotion.status, to);
    return this.promotions.updateStatus(id, to);
  }

  private async getOrThrow(id: string): Promise<Promotion> {
    const promotion = await this.promotions.findById(id);
    if (!promotion) throw new NotFoundException('Promotion not found');
    return promotion;
  }
}
