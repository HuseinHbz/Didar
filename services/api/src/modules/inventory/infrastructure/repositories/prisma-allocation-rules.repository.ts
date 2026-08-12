import { Prisma, prisma } from '@iecp/database';
import { ALLOCATION_RULE_TYPES, type AllocationRule } from '@iecp/types';
import { Injectable } from '@nestjs/common';

import type { AllocationRulesRepositoryPort } from '../../domain/ports/allocation-rules.repository.port';

const SETTING_KEY = 'inventory.allocation_rules';

@Injectable()
export class PrismaAllocationRulesRepository implements AllocationRulesRepositoryPort {
  async get(): Promise<AllocationRule[]> {
    const row = await prisma.setting.findUnique({ where: { key: SETTING_KEY } });
    if (!row) return [];
    return parseRules(row.value);
  }

  async set(rules: AllocationRule[]): Promise<AllocationRule[]> {
    for (const rule of rules) {
      if (!ALLOCATION_RULE_TYPES.includes(rule.type)) {
        throw new Error(`Unknown allocation rule type: ${rule.type}`);
      }
    }
    const value = rules as unknown as Prisma.InputJsonValue;
    await prisma.setting.upsert({
      where: { key: SETTING_KEY },
      update: { value },
      create: {
        key: SETTING_KEY,
        value,
        description: 'Inventory allocation engine rule order (ADR-006 decision 7)',
      },
    });
    return rules;
  }
}

/** Defensive parse — never trusts the JSON column's shape blindly (it's
 * admin-editable via a generic `Setting` row, not schema-enforced). An
 * unparseable value resolves to an empty rule list rather than throwing,
 * so a malformed Setting row degrades to "no configured rules" instead of
 * taking down every allocation call. */
function parseRules(value: unknown): AllocationRule[] {
  if (!Array.isArray(value)) return [];
  const rules: AllocationRule[] = [];
  for (const entry of value) {
    if (
      typeof entry === 'object' &&
      entry !== null &&
      'type' in entry &&
      'priority' in entry &&
      typeof (entry as { type: unknown }).type === 'string' &&
      typeof (entry as { priority: unknown }).priority === 'number' &&
      ALLOCATION_RULE_TYPES.includes(
        (entry as { type: string }).type as (typeof ALLOCATION_RULE_TYPES)[number],
      )
    ) {
      const candidate = entry as {
        type: string;
        priority: number;
        params?: Record<string, unknown>;
      };
      rules.push({
        type: candidate.type as AllocationRule['type'],
        priority: candidate.priority,
        params: candidate.params,
      });
    }
  }
  return rules;
}
