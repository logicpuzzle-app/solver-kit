use std::collections::HashMap;

#[derive(Clone, Debug, Default)]
pub struct UnionFind {
    pub parents: HashMap<i64, i64>,
}

impl UnionFind {
    pub fn root(&mut self, a: i64) -> i64 {
        let parent = self.parents.get(&a).copied();
        if parent.is_none() || parent.unwrap() < 0 {
            return a;
        }
        let root = self.root(parent.unwrap());
        self.parents.insert(a, root);
        root
    }
    fn size_of(&mut self, a: i64) -> Option<i64> {
        let root = self.root(a);
        self.parents.get(&root).map(|value| -*value)
    }
    pub fn connect(&mut self, a: i64, b: i64) -> bool {
        let mut ra = self.root(a);
        let mut rb = self.root(b);
        if ra == rb {
            return false;
        }
        // Missing sparse entries behave as JavaScript NaN, so the comparison is false.
        let swap = match (self.size_of(ra), self.size_of(rb)) {
            (Some(x), Some(y)) => x < y,
            _ => false,
        };
        if swap {
            std::mem::swap(&mut ra, &mut rb);
        }
        let pa = self.parents.get(&ra).copied().unwrap_or(-1);
        let pb = self.parents.get(&rb).copied().unwrap_or(-1);
        self.parents.insert(ra, pa + pb);
        self.parents.insert(rb, ra);
        true
    }
    pub fn is_union(&mut self, a: i64, b: i64) -> bool {
        self.root(a) == self.root(b)
    }
}

