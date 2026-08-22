/**
 * ADR-018 decision 7 — `P018`'s own `observability_requirements` calls
 * for "frontend error tracking wired." No third-party service is
 * reachable from this sandbox (the outbound proxy denies unlisted
 * hosts — the same constraint already documented for ZarinPal/P1-6 and
 * Kavenegar/P1-8), so this is the real structural half: a stable
 * interface every future provider (Sentry or equivalent) implements,
 * with a console-based implementation wired in for now. Never logs
 * tokens/passwords/OTP codes — `context` is caller-supplied and must
 * never include one (see call sites).
 */
export interface ErrorContext {
  route?: string;
  [key: string]: unknown;
}

export interface ErrorReporter {
  reportError: (error: unknown, context?: ErrorContext) => void;
}

const consoleReporter: ErrorReporter = {
  reportError(error, context) {
    console.error('[admin] unhandled error', error, context);
  },
};

let activeReporter: ErrorReporter = consoleReporter;

export function setErrorReporter(reporter: ErrorReporter): void {
  activeReporter = reporter;
}

export function reportError(error: unknown, context?: ErrorContext): void {
  activeReporter.reportError(error, context);
}
