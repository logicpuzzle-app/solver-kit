//! 盤面(問題)の表現。
//!
//! ぬりかべの問題は「数字の入ったマス」だけで決まる。数字マスは必ず白マスなので、
//! 盤面側で黒白を持つ必要はない。解答の状態は `answer_model.rs` が持つ。

/// 数字なしのマス。
pub const NO_CLUE: i32 = -1;
/// 数字が伏せられたマス(`?`)。島であることは分かるがサイズが不明。
pub const UNKNOWN_CLUE: i32 = -2;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Board {
    pub cols: i32,
    pub rows: i32,
    /// 行優先。`NO_CLUE` / `UNKNOWN_CLUE` / 正の島サイズ。
    pub clues: Vec<i32>,
}

impl Board {
    pub fn new(cols: i32, rows: i32, clues: Vec<i32>) -> Result<Self, String> {
        if cols <= 0 || rows <= 0 {
            return Err("盤面サイズは正でなければなりません".into());
        }
        if clues.len() != (cols * rows) as usize {
            return Err(format!(
                "ヒントの数が盤面サイズと合いません: {} != {}x{}",
                clues.len(),
                cols,
                rows
            ));
        }
        Ok(Self { cols, rows, clues })
    }

    pub fn cell_count(&self) -> usize {
        (self.cols * self.rows) as usize
    }

    pub fn in_board(&self, x: i32, y: i32) -> bool {
        x >= 0 && x < self.cols && y >= 0 && y < self.rows
    }

    pub fn index(&self, x: i32, y: i32) -> usize {
        (y * self.cols + x) as usize
    }

    pub fn position(&self, index: usize) -> (i32, i32) {
        let i = index as i32;
        (i % self.cols, i / self.cols)
    }

    pub fn clue(&self, x: i32, y: i32) -> i32 {
        self.clues[self.index(x, y)]
    }

    /// 数字マス(`?` を含む)かどうか。数字マスは必ず白。
    pub fn is_clue(&self, x: i32, y: i32) -> bool {
        self.clue(x, y) != NO_CLUE
    }

    /// 数字マスの一覧を (index, 島サイズ) で返す。`?` は `UNKNOWN_CLUE` のまま。
    pub fn clue_cells(&self) -> Vec<(usize, i32)> {
        self.clues
            .iter()
            .enumerate()
            .filter(|(_, &c)| c != NO_CLUE)
            .map(|(i, &c)| (i, c))
            .collect()
    }

    /// タテヨコに隣接するマスの添字。
    pub fn neighbours(&self, index: usize) -> Vec<usize> {
        let (x, y) = self.position(index);
        let mut out = Vec::with_capacity(4);
        for (dx, dy) in [(0, -1), (0, 1), (-1, 0), (1, 0)] {
            let (nx, ny) = (x + dx, y + dy);
            if self.in_board(nx, ny) {
                out.push(self.index(nx, ny));
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_mismatched_clue_count() {
        assert!(Board::new(2, 2, vec![NO_CLUE; 3]).is_err());
        assert!(Board::new(2, 2, vec![NO_CLUE; 4]).is_ok());
    }

    #[test]
    fn neighbours_stay_inside_the_board() {
        let board = Board::new(3, 3, vec![NO_CLUE; 9]).unwrap();
        assert_eq!(board.neighbours(0).len(), 2); // 角
        assert_eq!(board.neighbours(4).len(), 4); // 中央
        assert_eq!(board.neighbours(1).len(), 3); // 辺
    }

    #[test]
    fn position_round_trips_with_index() {
        let board = Board::new(4, 3, vec![NO_CLUE; 12]).unwrap();
        for i in 0..12 {
            let (x, y) = board.position(i);
            assert_eq!(board.index(x, y), i);
        }
    }
}
