import Decimal from "decimal.js";

/**
 * All monetary values in this system are stored and calculated as Decimal,
 * never as native JS floating point numbers (Master Spec Part XI.15).
 * Persisted values are strings; arithmetic always goes through this module.
 */

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export type MoneyInput = string | number | Decimal;

export class Money {
  private readonly value: Decimal;
  readonly currency: string;

  private constructor(value: Decimal, currency: string) {
    this.value = value;
    this.currency = currency;
  }

  static of(input: MoneyInput, currency: string): Money {
    return new Money(new Decimal(input), currency);
  }

  static zero(currency: string): Money {
    return new Money(new Decimal(0), currency);
  }

  private assertSameCurrency(other: Money) {
    if (other.currency !== this.currency) {
      throw new Error(
        `Currency mismatch: cannot combine ${this.currency} with ${other.currency}`
      );
    }
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.plus(other.value), this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.minus(other.value), this.currency);
  }

  abs(): Money {
    return new Money(this.value.abs(), this.currency);
  }

  isNegative(): boolean {
    return this.value.isNegative();
  }

  isZero(): boolean {
    return this.value.isZero();
  }

  /** Compares magnitude only after currency check; returns -1, 0 or 1. */
  compare(other: Money): number {
    this.assertSameCurrency(other);
    return this.value.comparedTo(other.value);
  }

  /** Round only at an explicit reporting/Xero boundary (spec 15). */
  toFixedString(decimalPlaces = 2): string {
    return this.value.toFixed(decimalPlaces);
  }

  /** Preserves up to 4 decimal places as Xero often supplies (spec 15). */
  toStorageString(): string {
    return this.value.toFixed(4);
  }

  toNumber(): number {
    return this.value.toNumber();
  }
}

export function variancePercent(actual: Money, expected: Money): Decimal | null {
  if (expected.isZero()) return null;
  const diff = new Decimal(actual.toStorageString()).minus(expected.toStorageString());
  return diff.dividedBy(new Decimal(expected.toStorageString()).abs()).times(100);
}
