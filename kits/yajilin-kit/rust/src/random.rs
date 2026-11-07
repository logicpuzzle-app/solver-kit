#[derive(Clone, Debug)]
pub struct Rng {
    hi: u64,
    lo: u64,
}

impl Rng {
    const MULTIPLIER_HI: u64 = 0x5de;
    const MULTIPLIER_LO: u64 = 0xece66d;
    const ADDEND: u64 = 0xb;
    const HALF: u64 = 0x1000000;

    pub fn new(seed: i64) -> Self {
        let modulus = 281_474_976_710_656i128;
        let value = ((seed as i128 % modulus) + modulus) % modulus;
        let value = value as u64;
        Self {
            hi: (value / Self::HALF) ^ Self::MULTIPLIER_HI,
            lo: (value % Self::HALF) ^ Self::MULTIPLIER_LO,
        }
    }
    pub fn next(&mut self, bits: u32) -> u64 {
        assert!(bits <= 32);
        let low = self.lo * Self::MULTIPLIER_LO + Self::ADDEND;
        let carry = low / Self::HALF;
        let new_lo = low % Self::HALF;
        let new_hi =
            (self.hi * Self::MULTIPLIER_LO + self.lo * Self::MULTIPLIER_HI + carry)
                % Self::HALF;
        self.hi = new_hi;
        self.lo = new_lo;
        let shift = 48 - bits;
        if shift >= 24 {
            new_hi >> (shift - 24)
        } else {
            (new_hi << (24 - shift)) + (new_lo >> shift)
        }
    }
    pub fn next_int(&mut self, bound: usize) -> usize {
        assert!(bound > 0 && bound <= 0x7fffffff);
        let bound_i = bound as i32;
        if (bound_i & -bound_i) == bound_i {
            return ((bound as u64 * self.next(31)) / 2_147_483_648) as usize;
        }
        loop {
            let bits = self.next(31) as i32;
            let value = bits % bound_i;
            if bits
                .wrapping_sub(value)
                .wrapping_add(bound_i.wrapping_sub(1))
                >= 0
            {
                return value as usize;
            }
        }
    }
    pub fn next_boolean(&mut self) -> bool {
        self.next(1) != 0
    }
    pub fn shuffle<T>(&mut self, values: &mut [T]) {
        for i in (2..=values.len()).rev() {
            let j = self.next_int(i);
            values.swap(i - 1, j);
        }
    }
}

