/*
 * Checks the split-24-bit LCG against a straightforward bigint reference, since the RNG
 * stream is what makes generation reproducible across the three ports.
 * Usage: node --import tsx tools/check-rng.mjs [draws]
 */

import { Rng } from "../src/random.ts";

const draws = Number.parseInt(process.argv[2] ?? "200000", 10);

const MULTIPLIER = 0x5deece66dn;
const ADDEND = 0xbn;
const MASK = (1n << 48n) - 1n;

class Reference {
  constructor(seed) {
    this.state = (BigInt(seed) ^ MULTIPLIER) & MASK;
  }
  next(bits) {
    this.state = (this.state * MULTIPLIER + ADDEND) & MASK;
    return Number(this.state >> BigInt(48 - bits));
  }
  nextInt(bound) {
    if ((bound & -bound) === bound) {
      return Number((BigInt(bound) * BigInt(this.next(31))) >> 31n);
    }
    let bits;
    let value;
    do {
      bits = this.next(31);
      value = bits % bound;
    } while (((bits - value + (bound - 1)) | 0) < 0);
    return value;
  }
}

let failures = 0;
for (const seed of [0, 1, 42, 12345, 2147483647]) {
  const fast = new Rng(seed);
  const slow = new Reference(seed);
  for (let i = 0; i < draws; i++) {
    const bits = 1 + (i % 32);
    const a = fast.next(bits);
    const b = slow.next(bits);
    if (a !== b) {
      console.log(`seed ${seed} draw ${i} bits ${bits}: ${a} !== ${b}`);
      failures++;
      break;
    }
  }
  const fastInt = new Rng(seed);
  const slowInt = new Reference(seed);
  for (let i = 0; i < draws; i++) {
    const bound = 1 + (i % 1000);
    const a = fastInt.nextInt(bound);
    const b = slowInt.nextInt(bound);
    if (a !== b) {
      console.log(`seed ${seed} nextInt draw ${i} bound ${bound}: ${a} !== ${b}`);
      failures++;
      break;
    }
  }
}
console.log(failures === 0 ? `OK (${draws} draws per seed)` : `${failures} mismatches`);
process.exitCode = failures === 0 ? 0 : 1;
