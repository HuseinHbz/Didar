/**
 * A minimal `Result<T, E>` type for service/application-layer functions that fail in
 * expected, typed ways (business-rule violations) as opposed to exceptional ones
 * (bugs, infra failures). Keeps error handling out of untyped `catch (e) {}` blocks
 * and out of `any`.
 */
export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
