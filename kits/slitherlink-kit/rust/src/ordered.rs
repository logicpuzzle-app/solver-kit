use std::collections::VecDeque;

#[derive(Clone, Debug)]
pub struct OrderedIdSet {
    bits: Vec<u64>,
    len: usize,
    first: Option<usize>,
}

impl OrderedIdSet {
    pub fn new(len: usize) -> Self {
        Self {
            bits: vec![0; len.div_ceil(64)],
            len,
            first: None,
        }
    }

    pub fn insert(&mut self, value: usize) -> bool {
        debug_assert!(value < self.len);
        let word = value / 64;
        let mask = 1u64 << (value % 64);
        if self.bits[word] & mask != 0 {
            return false;
        }
        self.bits[word] |= mask;
        if self.first.is_none_or(|first| value < first) {
            self.first = Some(value);
        }
        true
    }

    pub fn remove(&mut self, value: usize) -> bool {
        debug_assert!(value < self.len);
        let word = value / 64;
        let mask = 1u64 << (value % 64);
        if self.bits[word] & mask == 0 {
            return false;
        }
        self.bits[word] &= !mask;
        if self.first == Some(value) {
            // 最小IDを消す時だけ次の立ったビットを探すため、探索側は常に
            // キャッシュ済みの先頭を読むだけで分岐順を維持できる。
            self.first = self.find_from(value + 1);
        }
        true
    }

    pub fn first(&self) -> Option<usize> {
        self.first
    }

    pub fn is_empty(&self) -> bool {
        self.first.is_none()
    }

    pub fn iter(&self) -> OrderedIdSetIter<'_> {
        OrderedIdSetIter {
            set: self,
            word_index: 0,
            remaining: self.bits.first().copied().unwrap_or(0),
        }
    }

    fn find_from(&self, start: usize) -> Option<usize> {
        if start >= self.len {
            return None;
        }
        let mut word_index = start / 64;
        let mut word = self.bits[word_index] & (u64::MAX << (start % 64));
        loop {
            if word != 0 {
                let value = word_index * 64 + word.trailing_zeros() as usize;
                return (value < self.len).then_some(value);
            }
            word_index += 1;
            if word_index >= self.bits.len() {
                return None;
            }
            word = self.bits[word_index];
        }
    }
}

pub struct OrderedIdSetIter<'a> {
    set: &'a OrderedIdSet,
    word_index: usize,
    remaining: u64,
}

impl Iterator for OrderedIdSetIter<'_> {
    type Item = usize;

    fn next(&mut self) -> Option<Self::Item> {
        loop {
            if self.remaining != 0 {
                let bit = self.remaining.trailing_zeros() as usize;
                self.remaining &= self.remaining - 1;
                return Some(self.word_index * 64 + bit);
            }
            self.word_index += 1;
            self.remaining = *self.set.bits.get(self.word_index)?;
        }
    }
}

#[derive(Clone, Debug)]
pub struct OrderedWorklist {
    queue: VecDeque<usize>,
    present: Vec<bool>,
}

impl OrderedWorklist {
    pub fn new(capacity: usize) -> Self {
        Self {
            queue: VecDeque::new(),
            present: vec![false; capacity],
        }
    }

    pub fn insert(&mut self, value: usize) {
        if !self.present[value] {
            self.present[value] = true;
            self.queue.push_back(value);
        }
    }

    pub fn pop_front(&mut self) -> Option<usize> {
        let value = self.queue.pop_front()?;
        self.present[value] = false;
        Some(value)
    }

    pub fn clear(&mut self) {
        self.queue.clear();
        self.present.fill(false);
    }
}
