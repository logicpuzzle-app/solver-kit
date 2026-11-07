//! 盤面(問題)の表現。
//!
//! 色は解答側が持つ。部屋・隣接・直線走査は問題だけで決まり、手筋と探索の
//! 内側で繰り返し使うので構築時に一度だけ作る。

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RoomBounds {
    /// 外接矩形の左端・上端・右端・下端。端はすべて盤面内のマス座標。
    pub min_x: i32,
    pub min_y: i32,
    pub max_x: i32,
    pub max_y: i32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Room {
    pub cells: Vec<usize>,
    pub bounds: RoomBounds,
    /// `None` は数字なし、`Some(-1)` は `.` で明示された数字なし。
    pub clue: Option<i32>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LineScan {
    pub cells: Vec<usize>,
    /// `boundaries[i]` は `cells[i]` と `cells[i + 1]` の間が部屋境界なら真。
    pub boundaries: Vec<bool>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Board {
    pub cols: i32,
    pub rows: i32,
    /// 左右に隣り合うマスの間。行優先で `rows * (cols - 1)` 個。
    pub vertical_borders: Vec<bool>,
    /// 上下に隣り合うマスの間。行優先で `(rows - 1) * cols` 個。
    pub horizontal_borders: Vec<bool>,
    /// マスごとの部屋番号。部屋番号は左上から最初のマスが現れる順。
    pub room_ids: Vec<usize>,
    pub rooms: Vec<Room>,
    neighbours: Vec<Vec<usize>>,
    row_lines: Vec<LineScan>,
    col_lines: Vec<LineScan>,
}

impl Board {
    pub fn new(
        cols: i32,
        rows: i32,
        vertical_borders: Vec<bool>,
        horizontal_borders: Vec<bool>,
        room_clues: Vec<Option<i32>>,
    ) -> Result<Self, String> {
        if cols <= 0 || rows <= 0 {
            return Err("盤面サイズは正でなければなりません".into());
        }
        let want_vertical = (rows * (cols - 1)) as usize;
        let want_horizontal = ((rows - 1) * cols) as usize;
        if vertical_borders.len() != want_vertical {
            return Err(format!(
                "縦境界の数が盤面サイズと合いません: {} != {want_vertical}",
                vertical_borders.len()
            ));
        }
        if horizontal_borders.len() != want_horizontal {
            return Err(format!(
                "横境界の数が盤面サイズと合いません: {} != {want_horizontal}",
                horizontal_borders.len()
            ));
        }
        if let Some(bad) = room_clues
            .iter()
            .flatten()
            .find(|&&clue| clue < -1 || clue >= 4096)
        {
            return Err(format!("部屋の数字が範囲外です: {bad}"));
        }

        let count = (cols * rows) as usize;
        let mut room_ids = vec![usize::MAX; count];
        let mut room_cells: Vec<Vec<usize>> = Vec::new();
        for start in 0..count {
            if room_ids[start] != usize::MAX {
                continue;
            }
            let room_id = room_cells.len();
            let mut cells = Vec::new();
            let mut stack = vec![start];
            room_ids[start] = room_id;
            while let Some(index) = stack.pop() {
                cells.push(index);
                let x = index as i32 % cols;
                let y = index as i32 / cols;
                let candidates = [
                    (
                        x > 0,
                        x - 1,
                        y,
                        x > 0
                            && !vertical_borders[(y * (cols - 1) + x - 1) as usize],
                    ),
                    (
                        x + 1 < cols,
                        x + 1,
                        y,
                        x + 1 < cols && !vertical_borders[(y * (cols - 1) + x) as usize],
                    ),
                    (
                        y > 0,
                        x,
                        y - 1,
                        y > 0 && !horizontal_borders[((y - 1) * cols + x) as usize],
                    ),
                    (
                        y + 1 < rows,
                        x,
                        y + 1,
                        y + 1 < rows && !horizontal_borders[(y * cols + x) as usize],
                    ),
                ];
                for (inside, nx, ny, open) in candidates {
                    if !inside || !open {
                        continue;
                    }
                    let next = (ny * cols + nx) as usize;
                    if room_ids[next] == usize::MAX {
                        room_ids[next] = room_id;
                        stack.push(next);
                    }
                }
            }
            cells.sort_unstable();
            room_cells.push(cells);
        }

        if room_clues.len() != room_cells.len() {
            return Err(format!(
                "部屋の数字の数が部屋数と合いません: {} != {}",
                room_clues.len(),
                room_cells.len()
            ));
        }
        let rooms = room_cells
            .into_iter()
            .zip(room_clues)
            .map(|(cells, clue)| {
                let mut min_x = cols;
                let mut min_y = rows;
                let mut max_x = 0;
                let mut max_y = 0;
                for &index in &cells {
                    let x = index as i32 % cols;
                    let y = index as i32 / cols;
                    min_x = min_x.min(x);
                    min_y = min_y.min(y);
                    max_x = max_x.max(x);
                    max_y = max_y.max(y);
                }
                Room {
                    cells,
                    bounds: RoomBounds {
                        min_x,
                        min_y,
                        max_x,
                        max_y,
                    },
                    clue,
                }
            })
            .collect();

        let mut board = Self {
            cols,
            rows,
            vertical_borders,
            horizontal_borders,
            room_ids,
            rooms,
            neighbours: Vec::new(),
            row_lines: Vec::new(),
            col_lines: Vec::new(),
        };
        board.neighbours = (0..count)
            .map(|index| board.compute_neighbours(index))
            .collect();
        board.row_lines = (0..rows)
            .map(|y| LineScan {
                cells: (0..cols).map(|x| board.index(x, y)).collect(),
                boundaries: (0..cols - 1)
                    .map(|x| board.has_vertical_border(x, y))
                    .collect(),
            })
            .collect();
        board.col_lines = (0..cols)
            .map(|x| LineScan {
                cells: (0..rows).map(|y| board.index(x, y)).collect(),
                boundaries: (0..rows - 1)
                    .map(|y| board.has_horizontal_border(x, y))
                    .collect(),
            })
            .collect();
        Ok(board)
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
        let index = index as i32;
        (index % self.cols, index / self.cols)
    }

    pub fn room_id(&self, index: usize) -> usize {
        self.room_ids[index]
    }

    pub fn room(&self, room_id: usize) -> &Room {
        &self.rooms[room_id]
    }

    /// 数字が実際に与えられた部屋。`.` の `Some(-1)` は含めない。
    pub fn clue_rooms(&self) -> Vec<(usize, i32)> {
        self.rooms
            .iter()
            .enumerate()
            .filter_map(|(room_id, room)| {
                room.clue
                    .filter(|&n| n >= 0)
                    .map(|n| (room_id, n))
            })
            .collect()
    }

    pub fn neighbours(&self, index: usize) -> &[usize] {
        &self.neighbours[index]
    }

    fn compute_neighbours(&self, index: usize) -> Vec<usize> {
        let (x, y) = self.position(index);
        [(1, 0), (-1, 0), (0, 1), (0, -1)]
            .into_iter()
            .filter(|&(dx, dy)| self.in_board(x + dx, y + dy))
            .map(|(dx, dy)| self.index(x + dx, y + dy))
            .collect()
    }

    pub fn has_vertical_border(&self, x: i32, y: i32) -> bool {
        self.vertical_borders[(y * (self.cols - 1) + x) as usize]
    }

    pub fn has_horizontal_border(&self, x: i32, y: i32) -> bool {
        self.horizontal_borders[(y * self.cols + x) as usize]
    }

    pub fn row_lines(&self) -> &[LineScan] {
        &self.row_lines
    }

    pub fn col_lines(&self) -> &[LineScan] {
        &self.col_lines
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_rooms_bounds_neighbours_and_lines() {
        // 左列が 1 部屋、右上と右下が別々の部屋。
        let board = Board::new(
            2,
            2,
            vec![true, true],
            vec![false, true],
            vec![Some(1), None, Some(0)],
        )
        .unwrap();
        assert_eq!(board.room_ids, vec![0, 1, 0, 2]);
        assert_eq!(board.rooms[0].cells, vec![0, 2]);
        assert_eq!(
            board.rooms[0].bounds,
            RoomBounds {
                min_x: 0,
                min_y: 0,
                max_x: 0,
                max_y: 1,
            }
        );
        assert_eq!(board.neighbours(0).len(), 2);
        assert_eq!(board.row_lines()[0].boundaries, vec![true]);
        assert_eq!(board.col_lines()[0].boundaries, vec![false]);
    }
}
