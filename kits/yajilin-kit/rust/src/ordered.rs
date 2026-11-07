use std::collections::HashMap;

#[derive(Clone, Debug, Default)]
pub struct OrderedSet {
    order: Vec<i64>,
    index: HashMap<i64, usize>,
}

impl OrderedSet {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn insert(&mut self, key: i64) -> bool {
        if self.index.contains_key(&key) {
            return false;
        }
        self.index.insert(key, self.order.len());
        self.order.push(key);
        true
    }
    pub fn contains(&self, key: i64) -> bool {
        self.index.contains_key(&key)
    }
    pub fn remove(&mut self, key: i64) -> bool {
        let Some(at) = self.index.remove(&key) else {
            return false;
        };
        self.order.remove(at);
        for i in at..self.order.len() {
            self.index.insert(self.order[i], i);
        }
        true
    }
    pub fn clear(&mut self) {
        self.order.clear();
        self.index.clear();
    }
    pub fn len(&self) -> usize {
        self.order.len()
    }
    pub fn is_empty(&self) -> bool {
        self.order.is_empty()
    }
    pub fn iter(&self) -> impl Iterator<Item = i64> + '_ {
        self.order.iter().copied()
    }
}

#[derive(Clone, Debug)]
pub struct OrderedMap<V> {
    order: Vec<i64>,
    index: HashMap<i64, usize>,
    values: Vec<V>,
}

impl<V> Default for OrderedMap<V> {
    fn default() -> Self {
        Self {
            order: Vec::new(),
            index: HashMap::new(),
            values: Vec::new(),
        }
    }
}

impl<V> OrderedMap<V> {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn insert(&mut self, key: i64, value: V) -> Option<V> {
        if let Some(&at) = self.index.get(&key) {
            return Some(std::mem::replace(&mut self.values[at], value));
        }
        self.index.insert(key, self.order.len());
        self.order.push(key);
        self.values.push(value);
        None
    }
    pub fn get(&self, key: i64) -> Option<&V> {
        self.index.get(&key).map(|&at| &self.values[at])
    }
    pub fn get_mut(&mut self, key: i64) -> Option<&mut V> {
        self.index.get(&key).copied().map(|at| &mut self.values[at])
    }
    pub fn contains_key(&self, key: i64) -> bool {
        self.index.contains_key(&key)
    }
    pub fn remove(&mut self, key: i64) -> Option<V> {
        let at = self.index.remove(&key)?;
        self.order.remove(at);
        let value = self.values.remove(at);
        for i in at..self.order.len() {
            self.index.insert(self.order[i], i);
        }
        Some(value)
    }
    pub fn len(&self) -> usize {
        self.order.len()
    }
    pub fn is_empty(&self) -> bool {
        self.order.is_empty()
    }
    pub fn iter(&self) -> impl Iterator<Item = (i64, &V)> {
        self.order
            .iter()
            .copied()
            .zip(self.values.iter())
    }
}

