#[derive(Clone, Copy, Debug)]
struct Change {
    child: usize,
    parent: usize,
    parent_size: usize,
    parent_tail: usize,
}

#[derive(Clone, Debug)]
pub struct RollbackUnionFind {
    parent: Vec<usize>,
    size: Vec<usize>,
    tail: Vec<usize>,
    next: Vec<Option<usize>>,
    history: Vec<Change>,
}

impl RollbackUnionFind {
    pub fn new(len: usize) -> Self {
        Self {
            parent: (0..len).collect(),
            size: vec![1; len],
            tail: (0..len).collect(),
            next: vec![None; len],
            history: Vec::new(),
        }
    }

    pub fn root(&self, mut value: usize) -> usize {
        // 経路圧縮は変更履歴を壊すため行わず、サイズ併合で深さを抑える。
        while self.parent[value] != value {
            value = self.parent[value];
        }
        value
    }

    pub fn same(&self, left: usize, right: usize) -> bool {
        self.root(left) == self.root(right)
    }

    pub fn unite(&mut self, left: usize, right: usize) -> bool {
        let mut left_root = self.root(left);
        let mut right_root = self.root(right);
        if left_root == right_root {
            return false;
        }
        if self.size[left_root] < self.size[right_root] {
            std::mem::swap(&mut left_root, &mut right_root);
        }
        self.history.push(Change {
            child: right_root,
            parent: left_root,
            parent_size: self.size[left_root],
            parent_tail: self.tail[left_root],
        });
        self.next[self.tail[left_root]] = Some(right_root);
        self.tail[left_root] = self.tail[right_root];
        self.parent[right_root] = left_root;
        self.size[left_root] += self.size[right_root];
        true
    }

    pub fn first_member(&self, value: usize) -> usize {
        self.root(value)
    }

    pub fn next_member(&self, value: usize) -> Option<usize> {
        self.next[value]
    }

    pub fn snapshot(&self) -> usize {
        self.history.len()
    }

    pub fn rollback(&mut self, snapshot: usize) {
        while self.history.len() > snapshot {
            let change = self.history.pop().expect("履歴の長さを確認済み");
            self.parent[change.child] = change.child;
            self.size[change.parent] = change.parent_size;
            self.next[change.parent_tail] = None;
            self.tail[change.parent] = change.parent_tail;
        }
    }
}
