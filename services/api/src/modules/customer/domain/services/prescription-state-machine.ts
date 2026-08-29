import type { PrescriptionStatus } from '@iecp/types';

export class InvalidPrescriptionTransitionError extends Error {
  constructor(from: PrescriptionStatus, to: PrescriptionStatus) {
    super(`Cannot transition prescription from ${from} to ${to}`);
    this.name = 'InvalidPrescriptionTransitionError';
  }
}

/**
 * `DRAFT -> SUBMITTED -> UNDER_REVIEW -> {APPROVED | REJECTED}`.
 * `APPROVED`/`REJECTED`/`SUPERSEDED` are all terminal *for this specific
 * version* — an `APPROVED` prescription is never mutated or resubmitted;
 * correcting it creates a brand-new `DRAFT` version in the same lineage
 * (`PrescriptionService.createNewVersion()`), which starts its own,
 * independent walk through this same graph. `SUPERSEDED` is reached only
 * by the application layer's own `approve()` orchestration acting on the
 * *previous* version when a *new* version in the same lineage is
 * approved — never a customer- or reviewer-initiated transition in its
 * own right, so it has no outgoing edges here and no direct entry point
 * either (nothing transitions *into* `SUPERSEDED` through this class;
 * see `PrismaPrescriptionRepository.approve()`). Same no-op-is-not-an-
 * error convention every other state machine in this repo uses
 * (`OrderStateMachine`, `ReturnSettlementStateMachine`, ...).
 */
export class PrescriptionStateMachine {
  private static readonly GRAPH: Record<PrescriptionStatus, readonly PrescriptionStatus[]> = {
    DRAFT: ['SUBMITTED'],
    SUBMITTED: ['UNDER_REVIEW'],
    UNDER_REVIEW: ['APPROVED', 'REJECTED'],
    APPROVED: [],
    REJECTED: [],
    SUPERSEDED: [],
  };

  static isNoOp(from: PrescriptionStatus, to: PrescriptionStatus): boolean {
    return from === to;
  }

  static canTransition(from: PrescriptionStatus, to: PrescriptionStatus): boolean {
    return this.isNoOp(from, to) || this.GRAPH[from].includes(to);
  }

  static assertTransition(from: PrescriptionStatus, to: PrescriptionStatus): void {
    if (!this.canTransition(from, to)) {
      throw new InvalidPrescriptionTransitionError(from, to);
    }
  }
}
