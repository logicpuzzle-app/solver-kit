/*
 * Yajilin Kit — deterministic RNG.
 *
 * A 48-bit linear congruential generator matching the algorithm documented for
 * `java.util.Random` (seed scrambling, `next(bits)`, and the rejection loop in
 * `nextInt(bound)`). It is reimplemented here from that specification so that the
 * TypeScript, Rust and Python ports produce identical streams — the same seed must yield
 * a byte-identical puzzle in every language.
 */

const MULTIPLIER_HI = 0x5de;
const MULTIPLIER_LO = 0xece66d;
const ADDEND = 0xb;
const HALF = 0x1000000; // 2^24

/**
 * The 48-bit state is held as two 24-bit halves of plain numbers rather than a bigint.
 * Every product below stays under 2^53, so the arithmetic is exact, and it measured
 * several times faster than the bigint version in the generator's inner loop.
 */
export class Rng {
  private hi: number;
  private lo: number;

  constructor(seed: number) {
    // Scrambling the seed with the multiplier is a bitwise xor, and the split falls on a
    // bit boundary, so each half can be scrambled independently.
    const value = ((seed % 281474976710656) + 281474976710656) % 281474976710656;
    this.hi = Math.floor(value / HALF) ^ MULTIPLIER_HI;
    this.lo = (value % HALF) ^ MULTIPLIER_LO;
  }

  /** Top `bits` bits of the next LCG state. */
  next(bits: number): number {
    if (bits < 0 || bits > 32) {
      throw new RangeError("bits must be between 0 and 32");
    }
    const hi = this.hi;
    const lo = this.lo;
    const low = lo * MULTIPLIER_LO + ADDEND;
    const carry = Math.floor(low / HALF);
    const newLo = low % HALF;
    const newHi = (hi * MULTIPLIER_LO + lo * MULTIPLIER_HI + carry) % HALF;
    this.hi = newHi;
    this.lo = newLo;
    const shift = 48 - bits;
    if (shift >= 24) {
      return Math.floor(newHi / Math.pow(2, shift - 24));
    }
    return newHi * Math.pow(2, 24 - shift) + Math.floor(newLo / Math.pow(2, shift));
  }

  /** Uniform integer in [0, bound). */
  nextInt(bound: number): number {
    if (!Number.isInteger(bound) || bound <= 0 || bound > 0x7fffffff) {
      throw new RangeError("bound must be a positive 32-bit integer");
    }
    if ((bound & -bound) === bound) {
      return Math.floor((bound * this.next(31)) / 2147483648);
    }
    let bits: number;
    let value: number;
    do {
      bits = this.next(31);
      value = bits % bound;
      // The rejection test overflows a signed 32-bit int in the reference algorithm.
    } while (((bits - value + (bound - 1)) | 0) < 0);
    return value;
  }

  /** Uniform double in [0, 1). */
  nextDouble(): number {
    return (this.next(26) * 134217728 + this.next(27)) / 9007199254740992;
  }

  nextBoolean(): boolean {
    return this.next(1) !== 0;
  }

  /** Fisher-Yates, iterating downwards like `java.util.Collections.shuffle`. */
  shuffle<T>(values: T[]): void {
    for (let i = values.length; i > 1; i--) {
      const j = this.nextInt(i);
      const tmp = values[i - 1]!;
      values[i - 1] = values[j]!;
      values[j] = tmp;
    }
  }
}
