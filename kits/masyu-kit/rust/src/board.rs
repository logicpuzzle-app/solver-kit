//! 盤面。マスの丸と、線が通る辺の幾何を作り置きする。
//!
//! 線はマスの中心どうしを結ぶ**内部の辺**に引く。盤外へ出る辺は存在しない。
//! 辺 id は水平辺(右向き)を先に、垂直辺(下向き)を後ろに並べる。

pub const EMPTY: i32 = 0;
pub const WHITE: i32 = 1;
pub const BLACK: i32 = 2;

pub const NO_CELL: usize = usize::MAX;
pub const NO_EDGE: usize = usize::MAX;

/// 方向。`d ^ 2` が反対方向になる並び。
pub const RIGHT: usize = 0;
pub const DOWN: usize = 1;
pub const LEFT: usize = 2;
pub const UP: usize = 3;
pub const DIRS: [(i32, i32); 4] = [(1, 0), (0, 1), (-1, 0), (0, -1)];

pub fn opposite(dir: usize) -> usize {
    dir ^ 2
}

pub struct Board {
    pub cols: usize,
    pub rows: usize,
    pub cells: Vec<i32>,
    h_count: usize,
    edge_cells: Vec<[usize; 2]>,
    incident: Vec<[usize; 4]>,
    neighbours: Vec<[usize; 4]>,
    incident_count: Vec<u8>,
    pearl_cells: Vec<(usize, i32)>,
}

impl PartialEq for Board {
    fn eq(&self, other: &Self) -> bool {
        self.cols == other.cols && self.rows == other.rows && self.cells == other.cells
    }
}

impl Board {
    pub fn new(cols: usize, rows: usize, cells: Vec<i32>) -> Result<Self, String> {
        if cols < 2 || rows < 2 {
            return Err(format!("盤面が小さすぎる: {}x{}", cols, rows));
        }
        if cells.len() != cols * rows {
            return Err(format!(
                "マス数が合わない: {}x{} に {} 個",
                cols,
                rows,
                cells.len()
            ));
        }
        for (i, &c) in cells.iter().enumerate() {
            if !(EMPTY..=BLACK).contains(&c) {
                return Err(format!("マス {} の値が不正: {}", i, c));
            }
        }

        let cell_count = cols * rows;
        let h_count = (cols - 1) * rows;
        let v_count = cols * (rows - 1);

        let mut edge_cells = Vec::with_capacity(h_count + v_count);
        for y in 0..rows {
            for x in 0..cols - 1 {
                edge_cells.push([y * cols + x, y * cols + x + 1]);
            }
        }
        for y in 0..rows - 1 {
            for x in 0..cols {
                edge_cells.push([y * cols + x, (y + 1) * cols + x]);
            }
        }

        let mut incident = vec![[NO_EDGE; 4]; cell_count];
        let mut neighbours = vec![[NO_CELL; 4]; cell_count];
        for y in 0..rows {
            for x in 0..cols {
                let i = y * cols + x;
                if x + 1 < cols {
                    let e = y * (cols - 1) + x;
                    incident[i][RIGHT] = e;
                    incident[i + 1][LEFT] = e;
                    neighbours[i][RIGHT] = i + 1;
                    neighbours[i + 1][LEFT] = i;
                }
                if y + 1 < rows {
                    let e = h_count + y * cols + x;
                    incident[i][DOWN] = e;
                    incident[i + cols][UP] = e;
                    neighbours[i][DOWN] = i + cols;
                    neighbours[i + cols][UP] = i;
                }
            }
        }

        let incident_count = incident
            .iter()
            .map(|dirs| dirs.iter().filter(|&&e| e != NO_EDGE).count() as u8)
            .collect();
        let pearl_cells = cells
            .iter()
            .enumerate()
            .filter(|(_, &c)| c != EMPTY)
            .map(|(i, &c)| (i, c))
            .collect();

        Ok(Board {
            cols,
            rows,
            cells,
            h_count,
            edge_cells,
            incident,
            neighbours,
            incident_count,
            pearl_cells,
        })
    }

    pub fn cell_count(&self) -> usize {
        self.cols * self.rows
    }

    pub fn edge_count(&self) -> usize {
        self.edge_cells.len()
    }

    pub fn index(&self, x: usize, y: usize) -> usize {
        y * self.cols + x
    }

    pub fn position(&self, index: usize) -> (usize, usize) {
        (index % self.cols, index / self.cols)
    }

    pub fn at(&self, index: usize) -> i32 {
        self.cells[index]
    }

    pub fn is_pearl(&self, index: usize) -> bool {
        self.cells[index] != EMPTY
    }

    /// (マス, 丸の色) の一覧。
    pub fn pearls(&self) -> &[(usize, i32)] {
        &self.pearl_cells
    }

    /// マスの各方向の辺 id。盤外は NO_EDGE。
    pub fn incident(&self, index: usize) -> &[usize; 4] {
        &self.incident[index]
    }

    /// マスに接する辺の本数(角 2、辺上 3、内部 4)。
    pub fn incident_count(&self, index: usize) -> u8 {
        self.incident_count[index]
    }

    pub fn neighbour(&self, index: usize, dir: usize) -> usize {
        self.neighbours[index][dir]
    }

    /// 辺の両端のマス。
    pub fn edge_cells(&self, edge: usize) -> [usize; 2] {
        self.edge_cells[edge]
    }

    pub fn edge_is_horizontal(&self, edge: usize) -> bool {
        edge < self.h_count
    }

    /// 辺の反対側のマス。
    pub fn other_cell(&self, edge: usize, cell: usize) -> usize {
        let [a, b] = self.edge_cells[edge];
        if a == cell {
            b
        } else {
            a
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn geometry_of_a_3x2_board() {
        let board = Board::new(3, 2, vec![0, 1, 0, 2, 0, 0]).unwrap();
        assert_eq!(board.edge_count(), 2 * 2 + 3);
        assert_eq!(board.incident(0), &[0, 4, NO_EDGE, NO_EDGE]);
        assert_eq!(board.incident(4), &[3, NO_EDGE, 2, 5]);
        assert_eq!(board.incident_count(0), 2);
        assert_eq!(board.incident_count(1), 3);
        assert_eq!(board.pearls(), &[(1, WHITE), (3, BLACK)]);
        assert_eq!(board.other_cell(0, 0), 1);
        assert!(board.edge_is_horizontal(0));
        assert!(!board.edge_is_horizontal(4));
    }

    #[test]
    fn rejects_bad_input() {
        assert!(Board::new(1, 5, vec![0; 5]).is_err());
        assert!(Board::new(2, 2, vec![0; 3]).is_err());
        assert!(Board::new(2, 2, vec![0, 0, 0, 3]).is_err());
    }
}
