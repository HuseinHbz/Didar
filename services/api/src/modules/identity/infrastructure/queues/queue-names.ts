/**
 * The `notifications` queue itself is owned and consumed by
 * `services/notification-worker` (see that service's own
 * `notification.module.ts` — `BullModule.registerQueue({ name:
 * 'notifications' })`), not by this repo's usual "queue owned by the
 * module that registers it" convention every other `queue-names.ts` in
 * this repo follows (ADR-006 decision 8). `services/api`'s identity
 * module is a producer-only client of this cross-process queue — this
 * constant exists so the queue name is declared once, not duplicated as
 * a string literal at both ends.
 */
export const NOTIFICATIONS_QUEUE = 'notifications';
