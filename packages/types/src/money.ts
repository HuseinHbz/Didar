/**
 * Money value object.
 *
 * Project rule (docs/product/blueprint.md §90): money is never a floating point
 * number. Amounts are stored and moved around as integers in the currency's base
 * unit (Rial for IRR — `amount BIGINT`), and only formatted to Toman at the
 * presentation edge.
 */

export type CurrencyCode = 'IRR';

const RIAL_PER_TOMAN = 10n;

export class Money {
  /** Amount in the currency's smallest unit (Rial, for IRR). Always an integer. */
  public readonly amount: bigint;
  public readonly currency: CurrencyCode;

  private constructor(amount: bigint, currency: CurrencyCode) {
    this.amount = amount;
    this.currency = currency;
  }

  static ofRial(amount: bigint | number, currency: CurrencyCode = 'IRR'): Money {
    return new Money(BigInt(amount), currency);
  }

  static ofToman(amount: bigint | number, currency: CurrencyCode = 'IRR'): Money {
    return new Money(BigInt(amount) * RIAL_PER_TOMAN, currency);
  }

  static zero(currency: CurrencyCode = 'IRR'): Money {
    return new Money(0n, currency);
  }

  private assertSameCurrency(other: Money): void {
    // `CurrencyCode` is single-valued ('IRR' only) today, so TS can prove this
    // branch unreachable — but the check is genuine defense, not dead code: it's
    // what catches a second currency being added later, or a `Money` built from
    // untrusted/deserialized data (e.g. `toJSON()`'s inverse) bypassing the type
    // system. Keep the runtime guard; silence the two rules that assume the type
    // system is the only source of truth here.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (this.currency !== other.currency) {
      throw new TypeError(
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        `Currency mismatch: ${this.currency} vs ${other.currency}`,
      );
    }
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amount + other.amount, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amount - other.amount, this.currency);
  }

  multiply(factor: number): Money {
    if (!Number.isInteger(factor)) {
      throw new TypeError('Money.multiply only accepts integer factors (e.g. quantity)');
    }
    return new Money(this.amount * BigInt(factor), this.currency);
  }

  /** Applies an integer basis-point discount/markup (e.g. 1500 = 15.00%). */
  applyBasisPoints(basisPoints: number): Money {
    return new Money((this.amount * BigInt(basisPoints)) / 10_000n, this.currency);
  }

  isNegative(): boolean {
    return this.amount < 0n;
  }

  equals(other: Money): boolean {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- see assertSameCurrency
    return this.currency === other.currency && this.amount === other.amount;
  }

  toToman(): bigint {
    return this.amount / RIAL_PER_TOMAN;
  }

  /** Formats as Persian-locale Toman for display, e.g. "۵٬۸۰۰٬۰۰۰ تومان". */
  formatToman(locale: 'fa-IR' | 'en-US' = 'fa-IR'): string {
    const toman = this.toToman();
    const formatted = new Intl.NumberFormat(locale).format(toman);
    return locale === 'fa-IR' ? `${formatted} تومان` : `${formatted} Toman`;
  }

  toJSON(): { amount: string; currency: CurrencyCode } {
    return { amount: this.amount.toString(), currency: this.currency };
  }
}
