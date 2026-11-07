//! 盤面(問題)の表現。
//!
//! 美術館の問題は「かべマス」と「そのかべに書かれた数字」だけで決まる。
//! 照明をどこに置いたかは解答側(`answer_model.rs`)が持つ。
//!
//! 「照らされているか」は照明の配置から導ける派生量なので、盤面にも解答にも持たない。
//! 持つと、照明を 1 つ置くたびに何マスも書き換えることになり、
//! どの手筋が何を決めたかの記録が壊れる。

/// 照明を置ける白マス。
pub const OPEN: i32 = -1;
/// 数字のないかべ。
pub const WALL: i32 = -2;

#[derive(Clone, Debug)]
pub struct Board {
    pub cols: i32,
    pub rows: i32,
    /// 行優先。`OPEN` / `WALL` / 0〜4 の数字。
    pub cells: Vec<i32>,
    /// マスごとの 4 方向の光線。盤面が決まれば変わらないので作り置きする。
    rays: Vec<[Vec<usize>; 4]>,
    /// マスごとの視界(自分 + 4 方向の光線)。同上。
    sight: Vec<Vec<usize>>,
    /// マスごとの隣接マス。同上。
    neighbours: Vec<Vec<usize>>,
}

impl PartialEq for Board {
    fn eq(&self, other: &Self) -> bool {
        self.cols == other.cols && self.rows == other.rows && self.cells == other.cells
    }
}

impl Eq for Board {}

impl Board {
    pub fn new(cols: i32, rows: i32, cells: Vec<i32>) -> Result<Self, String> {
        if cols <= 0 || rows <= 0 {
            return Err("盤面サイズは正でなければなりません".into());
        }
        if cells.len() != (cols * rows) as usize {
            return Err(format!(
                "マスの数が盤面サイズと合いません: {} != {}x{}",
                cells.len(),
                cols,
                rows
            ));
        }
        if let Some(bad) = cells.iter().find(|&&v| v > 4 || v < WALL) {
            return Err(format!("数字は 0〜4 でなければなりません: {bad}"));
        }
        let mut board = Self {
            cols,
            rows,
            cells,
            rays: Vec::new(),
            sight: Vec::new(),
            neighbours: Vec::new(),
        };
        // 光線と視界は盤面だけで決まる。手筋は 1 巡ごとに何万回も引くので、
        // ここで一度だけ作る。作り直していた頃は 25x25 の盤面で時間切れが出た。
        board.neighbours = (0..board.cell_count())
            .map(|index| board.compute_neighbours(index))
            .collect();
        board.rays = (0..board.cell_count())
            .map(|index| board.compute_rays(index))
            .collect();
        board.sight = (0..board.cell_count())
            .map(|index| {
                if board.is_wall(index) {
                    Vec::new()
                } else {
                    let mut out = vec![index];
                    for ray in &board.rays[index] {
                        out.extend(ray);
                    }
                    out
                }
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
        let i = index as i32;
        (i % self.cols, i / self.cols)
    }

    pub fn at(&self, index: usize) -> i32 {
        self.cells[index]
    }

    /// 照明を置けるマスか(かべでない)。
    pub fn is_open(&self, index: usize) -> bool {
        self.cells[index] == OPEN
    }

    pub fn is_wall(&self, index: usize) -> bool {
        self.cells[index] != OPEN
    }

    /// 数字の書かれたかべなら、その数字。
    pub fn clue(&self, index: usize) -> Option<i32> {
        let value = self.cells[index];
        (value >= 0).then_some(value)
    }

    /// 数字マスの一覧。`(マス番号, 数字)`。
    pub fn clue_cells(&self) -> Vec<(usize, i32)> {
        (0..self.cell_count())
            .filter_map(|index| self.clue(index).map(|value| (index, value)))
            .collect()
    }

    /// タテヨコに隣り合うマス。
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

    /// `index` から見て、4 方向それぞれにかべまで伸びる白マスの列。
    ///
    /// 照明の光が届く範囲そのもの。相互照射禁も全照射も、これを使って判定する。
    pub fn rays(&self, index: usize) -> &[Vec<usize>] {
        &self.rays[index]
    }

    fn compute_rays(&self, index: usize) -> [Vec<usize>; 4] {
        let (x, y) = self.position(index);
        [(1, 0), (-1, 0), (0, 1), (0, -1)]
            .into_iter()
            .map(|(dx, dy)| {
                let mut ray = Vec::new();
                let (mut cx, mut cy) = (x + dx, y + dy);
                while self.in_board(cx, cy) {
                    let next = self.index(cx, cy);
                    if self.is_wall(next) {
                        break;
                    }
                    ray.push(next);
                    cx += dx;
                    cy += dy;
                }
                ray
            })
            .collect::<Vec<_>>()
            .try_into()
            .expect("4 方向")
    }

    /// `index` を照らせるマス(自分自身を含む)。かべなら空。
    ///
    /// 「そこに照明を置けば `index` が照らされる」マスの集合であり、
    /// 同時に「`index` に照明を置いたとき照らされる」マスの集合でもある(対称)。
    pub fn sight(&self, index: usize) -> &[usize] {
        &self.sight[index]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rays_stop_at_walls() {
        // 1x5: [白][白][かべ][白][白]
        let board = Board::new(5, 1, vec![OPEN, OPEN, WALL, OPEN, OPEN]).unwrap();
        let rays = board.rays(0);
        assert_eq!(rays[0], vec![1], "右はかべの手前まで");
        assert!(rays[1].is_empty(), "左は盤外");
    }

    #[test]
    fn sight_includes_the_cell_itself() {
        let board = Board::new(3, 1, vec![OPEN, OPEN, OPEN]).unwrap();
        let mut sight = board.sight(1).to_vec();
        sight.sort_unstable();
        assert_eq!(sight, vec![0, 1, 2]);
    }

    #[test]
    fn walls_see_nothing() {
        let board = Board::new(3, 1, vec![OPEN, WALL, OPEN]).unwrap();
        assert!(board.sight(1).is_empty());
    }
}
