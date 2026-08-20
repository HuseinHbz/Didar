import { prisma } from '@iecp/database';
import type { PromotionStatus } from '@iecp/types';
import { Injectable } from '@nestjs/common';

import { PromotionRule } from '../../domain/entities/promotion-rule.entity';
import { PromotionTarget } from '../../domain/entities/promotion-target.entity';
import { Promotion } from '../../domain/entities/promotion.entity';
import type {
  CreatePromotionInput,
  PromotionRepositoryPort,
  UpdatePromotionInput,
} from '../../domain/ports/promotion.repository.port';

const include = { rules: true, targets: true } as const;

function toEntity(row: {
  id: string;
  name: string;
  description: string | null;
  status: PromotionStatus;
  priority: number;
  startsAt: Date | null;
  endsAt: Date | null;
  usageLimit: number | null;
  perCustomerLimit: number | null;
  usageCount: number;
  stackable: boolean;
  exclusive: boolean;
  minimumCartValue: bigint | null;
  maximumDiscount: bigint | null;
  currency: string;
  requiresCoupon: boolean;
  discountType: Promotion['discountType'];
  discountValue: bigint | null;
  buyQuantity: number | null;
  getQuantity: number | null;
  getDiscountBasisPoints: number | null;
  bundlePrice: bigint | null;
  rules: { id: string; promotionId: string; type: string; config: unknown }[];
  targets: { id: string; promotionId: string; type: string; refId: string }[];
}): Promotion {
  return Promotion.fromPersistence({
    ...row,
    rules: row.rules.map((rule) =>
      PromotionRule.fromPersistence(rule as Parameters<typeof PromotionRule.fromPersistence>[0]),
    ),
    targets: row.targets.map((target) =>
      PromotionTarget.fromPersistence(
        target as Parameters<typeof PromotionTarget.fromPersistence>[0],
      ),
    ),
  });
}

@Injectable()
export class PrismaPromotionRepository implements PromotionRepositoryPort {
  async create(input: CreatePromotionInput): Promise<Promotion> {
    const row = await prisma.promotion.create({
      data: {
        name: input.name,
        description: input.description,
        priority: input.priority,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        usageLimit: input.usageLimit,
        perCustomerLimit: input.perCustomerLimit,
        stackable: input.stackable,
        exclusive: input.exclusive,
        minimumCartValue: input.minimumCartValue,
        maximumDiscount: input.maximumDiscount,
        currency: input.currency,
        requiresCoupon: input.requiresCoupon,
        discountType: input.discountType,
        discountValue: input.discountValue,
        buyQuantity: input.buyQuantity,
        getQuantity: input.getQuantity,
        getDiscountBasisPoints: input.getDiscountBasisPoints,
        bundlePrice: input.bundlePrice,
        rules: {
          create: input.rules.map((rule) => ({
            type: rule.type,
            config: rule.config,
          })),
        },
        targets: {
          create: input.targets.map((target) => ({ type: target.type, refId: target.refId })),
        },
      },
      include,
    });
    return toEntity(row);
  }

  async update(id: string, input: UpdatePromotionInput): Promise<Promotion> {
    const { rules, targets, ...scalars } = input;
    await prisma.$transaction(async (tx) => {
      await tx.promotion.update({ where: { id }, data: scalars });
      if (rules) {
        await tx.promotionRule.deleteMany({ where: { promotionId: id } });
        await tx.promotionRule.createMany({
          data: rules.map((rule) => ({
            promotionId: id,
            type: rule.type,
            config: rule.config,
          })),
        });
      }
      if (targets) {
        await tx.promotionTarget.deleteMany({ where: { promotionId: id } });
        await tx.promotionTarget.createMany({
          data: targets.map((target) => ({
            promotionId: id,
            type: target.type,
            refId: target.refId,
          })),
        });
      }
    });
    const row = await prisma.promotion.findUniqueOrThrow({ where: { id }, include });
    return toEntity(row);
  }

  async findById(id: string): Promise<Promotion | null> {
    const row = await prisma.promotion.findUnique({ where: { id }, include });
    return row ? toEntity(row) : null;
  }

  async list(filter: {
    status?: PromotionStatus;
    limit: number;
    offset: number;
  }): Promise<{ items: Promotion[]; total: number }> {
    const where = filter.status ? { status: filter.status } : {};
    const [rows, total] = await Promise.all([
      prisma.promotion.findMany({
        where,
        include,
        orderBy: [{ priority: 'asc' }, { id: 'asc' }],
        take: filter.limit,
        skip: filter.offset,
      }),
      prisma.promotion.count({ where }),
    ]);
    return { items: rows.map(toEntity), total };
  }

  async listActive(now: Date): Promise<Promotion[]> {
    const rows = await prisma.promotion.findMany({
      where: {
        status: 'ACTIVE',
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ],
      },
      include,
      orderBy: [{ priority: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toEntity);
  }

  async updateStatus(id: string, status: PromotionStatus): Promise<Promotion> {
    const row = await prisma.promotion.update({ where: { id }, data: { status }, include });
    return toEntity(row);
  }

  async listExpiredNotMarked(now: Date): Promise<Promotion[]> {
    const rows = await prisma.promotion.findMany({
      where: {
        status: { in: ['DRAFT', 'SCHEDULED', 'ACTIVE', 'PAUSED'] },
        endsAt: { lt: now },
      },
      include,
    });
    return rows.map(toEntity);
  }
}
