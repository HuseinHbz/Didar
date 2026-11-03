import { ConflictException, Logger, NotFoundException } from '@nestjs/common';

import { PaymentProvider } from '../domain/entities/payment-provider.entity';
import { PaymentTransaction } from '../domain/entities/payment-transaction.entity';
import { Refund } from '../domain/entities/refund.entity';
import type { PaymentIntentRepositoryPort } from '../domain/ports/payment-intent.repository.port';
import type {
  PaymentProviderAdapter,
  PaymentProviderAdapterRegistry,
} from '../domain/ports/payment-provider-adapter.port';
import type { PaymentProviderRepositoryPort } from '../domain/ports/payment-provider.repository.port';
import type { RefundRepositoryPort } from '../domain/ports/refund.repository.port';
import {
  InvalidRefundTransitionError,
  RefundAlreadyProcessingError,
} from '../domain/services/refund-state-machine';

import { RefundService } from './refund.service';

const REFUND_ID = '11111111-1111-4111-8111-111111111111';
const TRANSACTION_ID = '22222222-2222-4222-8222-222222222222';
const INTENT_ID = '33333333-3333-4333-8333-333333333333';
const ATTEMPT_ID = '44444444-4444-4444-8444-444444444444';
const PROVIDER_ID = '55555555-5555-4555-8555-555555555555';
const AUTHORITY = 'A00000000000000000000000000000000001';
const TRANSACTION_AMOUNT = 1_000_000n;

type RefundStatus = Parameters<typeof Refund.create>[0]['status'];

function refund(status: RefundStatus, amount = TRANSACTION_AMOUNT): Refund {
  return Refund.create({
    id: REFUND_ID,
    paymentTransactionId: TRANSACTION_ID,
    amount,
    reason: 'Customer request',
    status,
    idempotencyKey: 'key-1',
    createdAt: new Date(0),
    updatedAt: new Date(0),
  });
}

function transaction(): PaymentTransaction {
  return PaymentTransaction.create({
    id: TRANSACTION_ID,
    paymentIntentId: INTENT_ID,
    paymentAttemptId: ATTEMPT_ID,
    providerId: PROVIDER_ID,
    providerReference: 'REF-1',
    amount: TRANSACTION_AMOUNT,
    status: 'VERIFIED',
    createdAt: new Date(0),
    updatedAt: new Date(0),
  });
}

function provider(): PaymentProvider {
  return PaymentProvider.create({
    id: PROVIDER_ID,
    code: 'zarinpal',
    name: 'ZarinPal',
    createdAt: new Date(0),
    updatedAt: new Date(0),
  });
}

interface Fakes {
  refunds: jest.Mocked<
    Pick<
      RefundRepositoryPort,
      'findById' | 'search' | 'claimForProcessing' | 'settleProcessing' | 'findByIdempotencyKey'
    >
  >;
  intents: jest.Mocked<Pick<PaymentIntentRepositoryPort, 'findTransactionById' | 'findById'>>;
  providers: jest.Mocked<Pick<PaymentProviderRepositoryPort, 'findById'>>;
  adapter: jest.Mocked<Pick<PaymentProviderAdapter, 'refundPayment'>> & {
    providerCode: string;
    capabilities: { partialRefund: boolean };
  };
  service: RefundService;
}

/** Happy-path defaults: a PENDING full-amount refund against a VERIFIED
 * transaction whose attempt has an authority, on a gateway that can refund
 * partially. Each test overrides only what it is about. */
function build(options: { partialRefund?: boolean; authority?: string | null } = {}): Fakes {
  const refunds: Fakes['refunds'] = {
    findById: jest.fn().mockResolvedValue(refund('PENDING')),
    findByIdempotencyKey: jest.fn(),
    search: jest.fn().mockResolvedValue([]),
    claimForProcessing: jest.fn().mockResolvedValue(true),
    settleProcessing: jest
      .fn()
      .mockImplementation((_id: string, outcome: { status: RefundStatus }) =>
        Promise.resolve(refund(outcome.status)),
      ),
  };
  const intents: Fakes['intents'] = {
    findTransactionById: jest.fn().mockResolvedValue(transaction()),
    findById: jest.fn().mockResolvedValue({
      attempts: [
        {
          id: ATTEMPT_ID,
          providerAuthority: options.authority === undefined ? AUTHORITY : options.authority,
        },
      ],
    }),
  };
  const providers: Fakes['providers'] = { findById: jest.fn().mockResolvedValue(provider()) };
  const adapter: Fakes['adapter'] = {
    providerCode: 'zarinpal',
    capabilities: { partialRefund: options.partialRefund ?? true },
    refundPayment: jest.fn().mockResolvedValue({
      accepted: true,
      providerRefundReference: 'PROVIDER-REFUND-1',
      raw: {},
    }),
  };
  const registry: PaymentProviderAdapterRegistry = {
    resolve: () => adapter as unknown as PaymentProviderAdapter,
  };
  const service = new RefundService(
    refunds as unknown as RefundRepositoryPort,
    intents as unknown as PaymentIntentRepositoryPort,
    providers as unknown as PaymentProviderRepositoryPort,
    registry,
  );
  return { refunds, intents, providers, adapter, service };
}

describe('RefundService', () => {
  // The service logs a WARN/ERROR line for the refunds it declines to send or
  // cannot record — expected here, and noise in the test output.
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('processRefund — what is sent', () => {
    it('sends a refund of the whole transaction to a whole-transaction-only gateway', async () => {
      const { refunds, adapter, service } = build({ partialRefund: false });

      await service.processRefund(REFUND_ID);

      expect(adapter.refundPayment).toHaveBeenCalledWith({
        providerReference: AUTHORITY,
        amount: TRANSACTION_AMOUNT,
        reason: 'Customer request',
      });
      expect(refunds.settleProcessing).toHaveBeenCalledWith(REFUND_ID, {
        status: 'COMPLETED',
        providerRefundReference: 'PROVIDER-REFUND-1',
      });
    });

    it('never sends a partial refund to a whole-transaction-only gateway: REJECTED with the reason', async () => {
      const { refunds, adapter, service } = build({ partialRefund: false });
      refunds.findById.mockResolvedValue(refund('PENDING', 400_000n));

      await service.processRefund(REFUND_ID);

      expect(adapter.refundPayment).not.toHaveBeenCalled();
      expect(refunds.settleProcessing).toHaveBeenCalledTimes(1);
      const [, outcome] = refunds.settleProcessing.mock.calls[0] ?? [];
      expect(outcome).toMatchObject({ status: 'REJECTED' });
      expect(outcome?.failureReason).toMatch(/partial/i);
    });

    it('sends a partial refund when the gateway declares partial-refund support', async () => {
      const { refunds, adapter, service } = build({ partialRefund: true });
      refunds.findById.mockResolvedValue(refund('PENDING', 400_000n));

      await service.processRefund(REFUND_ID);

      expect(adapter.refundPayment).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 400_000n }),
      );
      expect(refunds.settleProcessing).toHaveBeenCalledWith(
        REFUND_ID,
        expect.objectContaining({ status: 'COMPLETED' }),
      );
    });

    it('records a provider decline as REJECTED, with the provider message as the reason', async () => {
      const { refunds, adapter, service } = build();
      adapter.refundPayment.mockResolvedValue({
        accepted: false,
        providerRefundReference: null,
        raw: { code: -50, message: 'transaction already reversed' },
      });

      await service.processRefund(REFUND_ID);

      const [, outcome] = refunds.settleProcessing.mock.calls[0] ?? [];
      expect(outcome).toMatchObject({ status: 'REJECTED', providerRefundReference: null });
      expect(outcome?.failureReason).toContain('transaction already reversed');
    });

    it('falls back to a generic reason, and bounds a very long one', async () => {
      const { refunds, adapter, service } = build();
      adapter.refundPayment.mockResolvedValueOnce({
        accepted: false,
        providerRefundReference: null,
        raw: { unexpected: true },
      });
      await service.processRefund(REFUND_ID);
      expect(refunds.settleProcessing.mock.calls[0]?.[1].failureReason).toBe(
        'The payment provider declined the refund.',
      );

      adapter.refundPayment.mockResolvedValueOnce({
        accepted: false,
        providerRefundReference: null,
        raw: { error: 'x'.repeat(5_000) },
      });
      await service.processRefund(REFUND_ID);
      expect(refunds.settleProcessing.mock.calls[1]?.[1].failureReason?.length).toBeLessThanOrEqual(
        300,
      );
    });

    it('ends FAILED, with a reason and nothing sent, when no provider authority is recorded', async () => {
      const { refunds, adapter, service } = build({ authority: null });

      await service.processRefund(REFUND_ID);

      expect(adapter.refundPayment).not.toHaveBeenCalled();
      const [, outcome] = refunds.settleProcessing.mock.calls[0] ?? [];
      expect(outcome).toMatchObject({ status: 'FAILED' });
      expect(outcome?.failureReason).toMatch(/authority/i);
    });
  });

  describe('processRefund — exactly one sender', () => {
    it('sends nothing when the refund is already PROCESSING', async () => {
      const { refunds, adapter, service } = build();
      refunds.findById.mockResolvedValue(refund('PROCESSING'));

      await expect(service.processRefund(REFUND_ID)).rejects.toBeInstanceOf(
        RefundAlreadyProcessingError,
      );

      expect(refunds.claimForProcessing).not.toHaveBeenCalled();
      expect(adapter.refundPayment).not.toHaveBeenCalled();
    });

    it('sends nothing when it loses the claim to a concurrent caller', async () => {
      const { refunds, adapter, service } = build();
      refunds.claimForProcessing.mockResolvedValue(false);
      refunds.findById
        .mockResolvedValueOnce(refund('PENDING')) // what this caller read first
        .mockResolvedValueOnce(refund('PROCESSING')); // what the winner has made it

      await expect(service.processRefund(REFUND_ID)).rejects.toMatchObject({
        name: 'RefundAlreadyProcessingError',
        status: 'PROCESSING',
      });

      expect(adapter.refundPayment).not.toHaveBeenCalled();
      expect(refunds.settleProcessing).not.toHaveBeenCalled();
    });

    it('refuses a refund that is already settled (409 via the transition error)', async () => {
      for (const status of ['COMPLETED', 'FAILED', 'REJECTED'] as const) {
        const { refunds, adapter, service } = build();
        refunds.findById.mockResolvedValue(refund(status));

        await expect(service.processRefund(REFUND_ID)).rejects.toBeInstanceOf(
          InvalidRefundTransitionError,
        );
        expect(refunds.claimForProcessing).not.toHaveBeenCalled();
        expect(adapter.refundPayment).not.toHaveBeenCalled();
      }
    });

    it('fails loudly (409) rather than report success when the outcome cannot be recorded', async () => {
      const { refunds, service } = build();
      refunds.settleProcessing.mockResolvedValue(null);

      await expect(service.processRefund(REFUND_ID)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('processRefund — configuration faults leave the refund retryable', () => {
    it('404s without claiming when the refund does not exist', async () => {
      const { refunds, service } = build();
      refunds.findById.mockResolvedValue(null);

      await expect(service.processRefund(REFUND_ID)).rejects.toBeInstanceOf(NotFoundException);
      expect(refunds.claimForProcessing).not.toHaveBeenCalled();
    });

    it('does not claim (the refund stays PENDING) when its transaction is missing', async () => {
      const { refunds, intents, service } = build();
      intents.findTransactionById.mockResolvedValue(null);

      await expect(service.processRefund(REFUND_ID)).rejects.toBeInstanceOf(NotFoundException);
      expect(refunds.claimForProcessing).not.toHaveBeenCalled();
    });

    it('does not claim (the refund stays PENDING) when its provider is missing', async () => {
      const { refunds, providers, service } = build();
      providers.findById.mockResolvedValue(null);

      await expect(service.processRefund(REFUND_ID)).rejects.toBeInstanceOf(NotFoundException);
      expect(refunds.claimForProcessing).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('returns nothing, and queries nothing, when no filter is given', async () => {
      const { refunds, service } = build();

      await expect(service.list({})).resolves.toEqual([]);
      expect(refunds.search).not.toHaveBeenCalled();
    });

    it('passes every filter through to one bounded query', async () => {
      const { refunds, service } = build();

      await service.list({ status: 'REJECTED', paymentTransactionId: TRANSACTION_ID });

      expect(refunds.search).toHaveBeenCalledWith(
        { status: 'REJECTED', paymentTransactionId: TRANSACTION_ID, returnRequestId: undefined },
        50,
      );
    });

    it('clamps the limit to 1..200', async () => {
      const { refunds, service } = build();

      await service.list({ status: 'REJECTED', limit: 0 });
      await service.list({ status: 'REJECTED', limit: 10_000 });
      await service.list({ status: 'REJECTED', limit: 25 });

      expect(refunds.search.mock.calls.map((call) => call[1])).toEqual([1, 200, 25]);
    });
  });
});
