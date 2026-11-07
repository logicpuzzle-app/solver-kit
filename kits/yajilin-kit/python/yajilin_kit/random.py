from __future__ import annotations

from typing import TypeVar

T = TypeVar("T")
MULTIPLIER_HI = 0x5DE
MULTIPLIER_LO = 0xECE66D
ADDEND = 0xB
HALF = 0x1000000
MOD48 = 281474976710656


class Rng:
    def __init__(self, seed: int) -> None:
        value = seed % MOD48
        self.hi = (value // HALF) ^ MULTIPLIER_HI
        self.lo = (value % HALF) ^ MULTIPLIER_LO

    def next(self, bits: int) -> int:
        if bits < 0 or bits > 32:
            raise ValueError("bits must be between 0 and 32")
        hi, lo = self.hi, self.lo
        low = lo * MULTIPLIER_LO + ADDEND
        carry = low // HALF
        new_lo = low % HALF
        new_hi = (hi * MULTIPLIER_LO + lo * MULTIPLIER_HI + carry) % HALF
        self.hi, self.lo = new_hi, new_lo
        shift = 48 - bits
        if shift >= 24:
            return new_hi // (1 << (shift - 24))
        return new_hi * (1 << (24 - shift)) + new_lo // (1 << shift)

    def next_int(self, bound: int) -> int:
        if bound <= 0 or bound > 0x7FFFFFFF:
            raise ValueError("bound must be a positive 32-bit integer")
        if (bound & -bound) == bound:
            return (bound * self.next(31)) // 2147483648
        while True:
            bits = self.next(31)
            value = bits % bound
            # JavaScript's `| 0` wraps the rejection expression to signed 32 bits.
            if ((bits - value + bound - 1) & 0xFFFFFFFF) < 0x80000000:
                return value

    def next_double(self) -> float:
        return (self.next(26) * 134217728 + self.next(27)) / 9007199254740992

    def next_boolean(self) -> bool:
        return self.next(1) != 0

    def shuffle(self, values: list[T]) -> None:
        for i in range(len(values), 1, -1):
            j = self.next_int(i)
            values[i - 1], values[j] = values[j], values[i - 1]
