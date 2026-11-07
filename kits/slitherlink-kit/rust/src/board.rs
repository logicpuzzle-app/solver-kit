use std::ops::Deref;

use crate::position::Position;

pub type EdgeId = usize;
pub type VertexId = usize;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SmallIds<const N: usize> {
    values: [usize; N],
    len: usize,
}

impl<const N: usize> SmallIds<N> {
    fn new() -> Self {
        Self {
            values: [0; N],
            len: 0,
        }
    }

    fn push(&mut self, value: usize) {
        self.values[self.len] = value;
        self.len += 1;
    }
}

impl<const N: usize> Deref for SmallIds<N> {
    type Target = [usize];

    fn deref(&self) -> &Self::Target {
        &self.values[..self.len]
    }
}

impl<const N: usize> IntoIterator for SmallIds<N> {
    type Item = usize;
    type IntoIter = std::iter::Take<std::array::IntoIter<usize, N>>;

    fn into_iter(self) -> Self::IntoIter {
        self.values.into_iter().take(self.len)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Board {
    pub cols: usize,
    pub rows: usize,
    pub clues: Vec<i8>,
}

impl Board {
    pub fn new(cols: usize, rows: usize, clues: Vec<i8>) -> Result<Self, String> {
        if cols == 0 || rows == 0 {
            return Err("盤面サイズは正でなければなりません".into());
        }
        if clues.len() != cols * rows {
            return Err(format!(
                "ヒント数が不正です: {} 個ではなく {} 個必要です",
                clues.len(),
                cols * rows
            ));
        }
        if let Some(clue) = clues.iter().find(|&&clue| !(-2..=4).contains(&clue)) {
            return Err(format!("不正なヒント値です: {clue}"));
        }
        Ok(Self { cols, rows, clues })
    }

    pub fn empty(cols: usize, rows: usize) -> Result<Self, String> {
        Self::new(cols, rows, vec![-1; cols * rows])
    }

    pub fn clue(&self, x: usize, y: usize) -> i8 {
        self.clues[y * self.cols + x]
    }

    pub fn cell_index(&self, x: usize, y: usize) -> usize {
        y * self.cols + x
    }

    pub fn cell_position(&self, index: usize) -> Position {
        Position::new(index % self.cols, index / self.cols)
    }

    pub fn h_id(&self, x: usize, y: usize) -> EdgeId {
        debug_assert!(x < self.cols && y <= self.rows);
        y * self.cols + x
    }

    pub fn v_id(&self, x: usize, y: usize) -> EdgeId {
        debug_assert!(x <= self.cols && y < self.rows);
        self.horizontal_edge_count() + y * (self.cols + 1) + x
    }

    pub fn horizontal_edge_count(&self) -> usize {
        self.cols * (self.rows + 1)
    }

    pub fn edge_count(&self) -> usize {
        self.horizontal_edge_count() + (self.cols + 1) * self.rows
    }

    pub fn vertex_count(&self) -> usize {
        (self.cols + 1) * (self.rows + 1)
    }

    pub fn vertex_id(&self, x: usize, y: usize) -> VertexId {
        debug_assert!(x <= self.cols && y <= self.rows);
        y * (self.cols + 1) + x
    }

    pub fn vertex_position(&self, id: VertexId) -> Position {
        Position::new(id % (self.cols + 1), id / (self.cols + 1))
    }

    pub fn cell_edges(&self, x: usize, y: usize) -> [EdgeId; 4] {
        [
            self.h_id(x, y),
            self.h_id(x, y + 1),
            self.v_id(x, y),
            self.v_id(x + 1, y),
        ]
    }

    pub fn vertex_edges(&self, x: usize, y: usize) -> SmallIds<4> {
        // 最大4本なのでヒープ確保を避け、探索・仮置きの反復コストを抑える。
        let mut edges = SmallIds::new();
        if x > 0 {
            edges.push(self.h_id(x - 1, y));
        }
        if x < self.cols {
            edges.push(self.h_id(x, y));
        }
        if y > 0 {
            edges.push(self.v_id(x, y - 1));
        }
        if y < self.rows {
            edges.push(self.v_id(x, y));
        }
        edges
    }

    pub fn edge_endpoints(&self, id: EdgeId) -> (VertexId, VertexId) {
        debug_assert!(id < self.edge_count());
        if id < self.horizontal_edge_count() {
            let x = id % self.cols;
            let y = id / self.cols;
            (self.vertex_id(x, y), self.vertex_id(x + 1, y))
        } else {
            let offset = id - self.horizontal_edge_count();
            let x = offset % (self.cols + 1);
            let y = offset / (self.cols + 1);
            (self.vertex_id(x, y), self.vertex_id(x, y + 1))
        }
    }

    pub fn edge_cells(&self, id: EdgeId) -> SmallIds<2> {
        // 辺に接するセルは高々2個で、返却順は従来の Vec と同じに保つ。
        let mut cells = SmallIds::new();
        if id < self.horizontal_edge_count() {
            let x = id % self.cols;
            let y = id / self.cols;
            if y > 0 {
                cells.push(self.cell_index(x, y - 1));
            }
            if y < self.rows {
                cells.push(self.cell_index(x, y));
            }
        } else {
            let offset = id - self.horizontal_edge_count();
            let x = offset % (self.cols + 1);
            let y = offset / (self.cols + 1);
            if x > 0 {
                cells.push(self.cell_index(x - 1, y));
            }
            if x < self.cols {
                cells.push(self.cell_index(x, y));
            }
        }
        cells
    }
}
