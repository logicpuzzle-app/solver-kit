#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Parity {
    Same,
    Different,
}

impl Parity {
    fn xor(self, other: Self) -> Self {
        if self == other {
            Self::Same
        } else {
            Self::Different
        }
    }
}

#[derive(Clone, Copy, Debug)]
struct Change {
    child: usize,
    parent: usize,
    parent_size: usize,
    child_parity: Parity,
}

#[derive(Clone, Debug)]
pub struct RollbackParityUnionFind {
    parent: Vec<usize>,
    size: Vec<usize>,
    parity_to_parent: Vec<Parity>,
    history: Vec<Change>,
}

impl RollbackParityUnionFind {
    pub fn new(len: usize) -> Self {
        Self {
            parent: (0..len).collect(),
            size: vec![1; len],
            parity_to_parent: vec![Parity::Same; len],
            history: Vec::new(),
        }
    }

    fn root_with_parity(&self, mut value: usize) -> (usize, Parity) {
        // 経路圧縮は巻き戻す変更箇所を増やすため行わず、サイズ併合で深さを抑える。
        let mut parity = Parity::Same;
        while self.parent[value] != value {
            parity = parity.xor(self.parity_to_parent[value]);
            value = self.parent[value];
        }
        (value, parity)
    }

    pub fn relation(&self, left: usize, right: usize) -> Option<Parity> {
        let (left_root, left_parity) = self.root_with_parity(left);
        let (right_root, right_parity) = self.root_with_parity(right);
        (left_root == right_root).then(|| left_parity.xor(right_parity))
    }

    pub fn unite(
        &mut self,
        left: usize,
        right: usize,
        parity: Parity,
    ) -> Result<bool, ()> {
        let (mut left_root, left_parity) = self.root_with_parity(left);
        let (mut right_root, right_parity) = self.root_with_parity(right);
        if left_root == right_root {
            return if left_parity.xor(right_parity) == parity {
                Ok(false)
            } else {
                Err(())
            };
        }

        // 根同士の関係は向きを反転しても同じ二値なので、サイズで親子を
        // 入れ替えても同じ式を使える。
        let root_parity = left_parity.xor(right_parity).xor(parity);
        if self.size[left_root] < self.size[right_root] {
            std::mem::swap(&mut left_root, &mut right_root);
        }
        self.history.push(Change {
            child: right_root,
            parent: left_root,
            parent_size: self.size[left_root],
            child_parity: self.parity_to_parent[right_root],
        });
        self.parent[right_root] = left_root;
        self.parity_to_parent[right_root] = root_parity;
        self.size[left_root] += self.size[right_root];
        Ok(true)
    }

    pub fn snapshot(&self) -> usize {
        self.history.len()
    }

    pub fn rollback(&mut self, snapshot: usize) {
        while self.history.len() > snapshot {
            let change = self.history.pop().expect("履歴の長さを確認済み");
            self.parent[change.child] = change.child;
            self.parity_to_parent[change.child] = change.child_parity;
            self.size[change.parent] = change.parent_size;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{Parity, RollbackParityUnionFind};

    #[test]
    fn relations_chain_and_detect_conflicts() {
        let mut union_find = RollbackParityUnionFind::new(4);
        assert_eq!(union_find.relation(0, 1), None);
        assert_eq!(union_find.unite(0, 1, Parity::Different), Ok(true));
        assert_eq!(union_find.unite(1, 2, Parity::Different), Ok(true));
        assert_eq!(union_find.relation(0, 2), Some(Parity::Same));
        assert_eq!(union_find.unite(0, 2, Parity::Same), Ok(false));
        assert_eq!(union_find.unite(0, 2, Parity::Different), Err(()));
    }

    #[test]
    fn rollback_restores_components_and_parities() {
        let mut union_find = RollbackParityUnionFind::new(4);
        union_find
            .unite(0, 1, Parity::Different)
            .expect("最初の併合に成功する");
        let snapshot = union_find.snapshot();
        union_find
            .unite(1, 2, Parity::Same)
            .expect("二回目の併合に成功する");
        assert_eq!(union_find.relation(0, 2), Some(Parity::Different));

        union_find.rollback(snapshot);
        assert_eq!(union_find.relation(0, 1), Some(Parity::Different));
        assert_eq!(union_find.relation(0, 2), None);
        assert_eq!(union_find.unite(2, 3, Parity::Different), Ok(true));
    }
}
