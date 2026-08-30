import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../config/env';
import type {
  NotificationChannelPort,
  NotificationMessage,
  NotificationSendResult,
  NotificationSendStatus,
} from '../notification-channel.port';

const REQUEST_TIMEOUT_MS = 15_000;

/** Extracts a human-readable message from a caught value without assuming
 * it's an `instanceof Error` in *this* module's realm — see this file's own
 * catch-block comment for why that assumption is unsafe here. Falls back to
 * `'unknown error'` only when nothing message-shaped is available at all. */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const { message } = error;
    if (typeof message === 'string') return message;
  }
  return 'unknown error';
}

/** Kavenegar's own response envelope, both endpoints this adapter calls
 * share the same shape (https://kavenegar.com/rest.html). `return.status`
 * 200 is success; anything else carries `return.message` as the reason
 * (invalid receptor, insufficient credit, invalid API key, ...). */
interface KavenegarEnvelope<T> {
  return: { status: number; message: string };
  entries?: T[];
}

interface KavenegarSendEntry {
  messageid: number;
  message: string;
  status: number;
  statustext: string;
  sender: string;
  receptor: string;
  date: number;
  cost: number;
}

/**
 * SMS adapter — the reliability backbone for Iran (blueprint §41/§43): every other
 * channel is allowed to fail over to this one, this one is not allowed to fail
 * over to anything else.
 *
 * CP-017: real Kavenegar REST integration (https://kavenegar.com/rest.html),
 * same "real documented contract, not a mock" precedent
 * `ZarinpalAdapter` established for payments (ADR-008 decision 5) — two
 * real endpoints, selected by `NotificationMessage.templateKey`:
 *
 * - `templateKey === 'OTP'` -> Kavenegar's purpose-built "Verify-Lookup"
 *   endpoint (`/verify/lookup.json`), which takes the code as `token` and
 *   a pre-registered template *name* (never message text) as `template`
 *   — the correct, provider-recommended way to send OTP codes, not the
 *   generic send endpoint.
 * - anything else -> Kavenegar's generic send endpoint (`/sms/send.json`),
 *   message body assembled from `NotificationMessage.variables` — no real
 *   caller exists for this path yet (CP-017's own scope is OTP only), but
 *   the port contract must stay meaningful for every `templateKey`, not
 *   just the one this phase actually wires a producer for.
 *
 * Unset/empty `SMS_API_KEY` (every environment that hasn't configured a
 * real Kavenegar account — local dev, CI, this sandbox) is a deliberate,
 * safe fallback to the exact pre-CP-017 stub behavior: log and return a
 * synthetic "sent" result, never attempt a real HTTP call. This is what
 * keeps every existing test/dev flow byte-identical to before this phase
 * — see docs/architecture/redis-reliability.md's own precedent for "an
 * absent credential is a valid environment, not an error" reasoning (CP-016).
 */
@Injectable()
export class SmsAdapter implements NotificationChannelPort {
  readonly channel = 'SMS' as const;
  private readonly logger = new Logger(SmsAdapter.name);
  private readonly statuses = new Map<string, NotificationSendStatus>();

  constructor(private readonly config: ConfigService<Env, true>) {}

  async send(message: NotificationMessage): Promise<NotificationSendResult> {
    const apiKey = this.config.get('SMS_API_KEY', { infer: true });
    if (apiKey === undefined || apiKey.length === 0) {
      this.logger.log(
        `[stub-fallback] SMS -> ${message.to} (template: ${message.templateKey}) — no SMS_API_KEY configured`,
      );
      const id = randomUUID();
      this.statuses.set(id, 'sent');
      return { id, status: 'sent' };
    }

    try {
      const entry =
        message.templateKey === 'OTP'
          ? await this.sendOtpLookup(apiKey, message)
          : await this.sendGeneric(apiKey, message);
      const id = entry.messageid.toString();
      // Kavenegar's own status codes: 1-9 = in transit/queued (treat as
      // "sent" — this API call itself succeeded), 10 = delivered, >=100 =
      // a real delivery failure the caller should know about.
      const status: NotificationSendStatus = entry.status >= 100 ? 'failed' : 'sent';
      this.statuses.set(id, status);
      this.logger.log(
        `SMS -> ${message.to} (template: ${message.templateKey}, provider status: ${entry.statustext})`,
      );
      return { id, status };
    } catch (error) {
      // Never log `error` raw here if it could ever embed the request body
      // (it can't — `post()` below only throws with Kavenegar's own
      // message field, never the request we sent) — see this class's own
      // security note in docs/security/notification-security.md.
      //
      // CP-017 audit finding: a bare `error instanceof Error` check silently
      // degrades to "unknown error" for a real `Error` whose constructor
      // isn't the same `Error` reference this module closes over — exactly
      // what happens when Node's own `fetch`/`response.json()` throw across
      // a VM-realm boundary (reproduced by this file's own test suite,
      // running under Jest's per-file sandboxed context — the same failure
      // shape a `vm`-isolated plugin host or a future Node runtime change
      // could reproduce in production). `messageOf()` recovers the real,
      // still-non-sensitive message (this class's own contract above: the
      // request body/key never end up in a message) whenever the thrown
      // value merely looks like an Error, without ever trusting a raw
      // `String(error)` that could stringify to `[object Object]` or worse.
      this.logger.warn(`SMS -> ${message.to} failed: ${messageOf(error)}`);
      const id = randomUUID();
      this.statuses.set(id, 'failed');
      return { id, status: 'failed' };
    }
  }

  getStatus(id: string): Promise<NotificationSendStatus> {
    return Promise.resolve(this.statuses.get(id) ?? 'failed');
  }

  /** OTP-purpose messages, via Kavenegar's Verify-Lookup endpoint — `token`
   * carries the code, `template` names a pre-registered Kavenegar template
   * (configured content lives in Kavenegar's own panel, never here). */
  private async sendOtpLookup(
    apiKey: string,
    message: NotificationMessage,
  ): Promise<KavenegarSendEntry> {
    const code = message.variables['code'];
    if (code === undefined) {
      throw new Error('OTP template requires a "code" variable');
    }
    const template = this.config.get('SMS_OTP_TEMPLATE', { infer: true });
    return this.post(apiKey, '/verify/lookup.json', {
      receptor: message.to,
      token: code,
      template,
    });
  }

  /** Every other template — the generic send endpoint. No caller wires
   * this yet (CP-017's own scope is OTP only); kept real and functional
   * rather than throwing, so the port's contract stays honest for
   * whichever future phase adds the next real caller (e.g. order
   * confirmation SMS). */
  private async sendGeneric(
    apiKey: string,
    message: NotificationMessage,
  ): Promise<KavenegarSendEntry> {
    const sender = this.config.get('SMS_SENDER', { infer: true });
    const body = Object.entries(message.variables)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n');
    return this.post(apiKey, '/sms/send.json', {
      receptor: message.to,
      message: body.length > 0 ? body : message.templateKey,
      ...(sender !== undefined ? { sender } : {}),
    });
  }

  private async post(
    apiKey: string,
    path: string,
    params: Record<string, string | undefined>,
  ): Promise<KavenegarSendEntry> {
    const baseUrl = this.config.get('SMS_BASE_URL', { infer: true });
    // Kavenegar's API key is part of the URL path itself, not a header —
    // this is their own documented contract, not a choice made here. It
    // never appears in any log line this adapter writes.
    const url = new URL(`/v1/${apiKey}${path}`, baseUrl);
    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) form.set(key, value);
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const envelope = (await response.json()) as KavenegarEnvelope<KavenegarSendEntry>;
    if (envelope.return.status !== 200 || envelope.entries?.[0] === undefined) {
      throw new Error(`Kavenegar API error ${envelope.return.status}: ${envelope.return.message}`);
    }
    return envelope.entries[0];
  }
}
