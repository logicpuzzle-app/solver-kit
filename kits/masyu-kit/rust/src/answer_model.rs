//! 解答状態。辺ごとに 線 / × / 未定 の 3 値を持つ。
//!
//! マスの状態は持たない。「線が通るマスか」は接する線の本数から毎回導く
//! (美術館の「照らされているか」と同じ理由 — 派生量を状態に持つと、
//! どの手筋が何を決めたかの記録が壊れる)。
//!
//! 線分の同一性は Union-Find で持つ。辺を線にしたとき両端がすでに同じ
//! 線分なら閉路なので `loop_closed` を立てる。閉じてよいのは全体が
//! 完成するときだけで、その判定は手筋側(小ループ禁)と検証側が行う。

use crate::board::Board;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EdgeState {
    Unknown,
    Line,
    Bar,
}

#[derive(Clone)]
pub struct AnswerModel {
    edges: Vec<EdgeState>,
    line_count: Vec<u8>,
    bar_count: Vec<u8>,
    parent: Vec<u32>,
    line_total: u32,
    pub loop_closed: bool,
}

impl AnswerModel {
    pub fn new(board: &Board) -> Self {
        AnswerModel {
            edges: vec![EdgeState::Unknown; board.edge_count()],
            line_count: vec![0; board.cell_count()],
            bar_count: vec![0; board.cell_count()],
            parent: (0..board.cell_count() as u32).collect(),
            line_total: 0,
            loop_closed: false,
        }
    }

    pub fn edge(&self, edge: usize) -> EdgeState {
        self.edges[edge]
    }

    pub fn is_line(&self, edge: usize) -> bool {
        self.edges[edge] == EdgeState::Line
    }

    pub fn is_bar(&self, edge: usize) -> bool {
        self.edges[edge] == EdgeState::Bar
    }

    pub fn is_unknown(&self, edge: usize) -> bool {
        self.edges[edge] == EdgeState::Unknown
    }

    /// マスに接する線の本数。
    pub fn line_count(&self, cell: usize) -> u8 {
        self.line_count[cell]
    }

    /// マスから dir 方向へ線が出ているか。盤外は「出ていない」。
    pub fn is_line_at(&self, board: &Board, cell: usize, dir: usize) -> bool {
        let edge = board.incident(cell)[dir];
        edge != crate::board::NO_EDGE && self.is_line(edge)
    }

    /// マスに接する未定の辺の本数。
    pub fn unknown_count_at(&self, board: &Board, cell: usize) -> u8 {
        board.incident_count(cell) - self.line_count[cell] - self.bar_count[cell]
    }

    /// 未定の辺の総数。
    pub fn unknown_count(&self) -> usize {
        self.edges
            .iter()
            .filter(|&&e| e == EdgeState::Unknown)
            .count()
    }

    pub fn line_total(&self) -> u32 {
        self.line_total
    }

    fn find(&mut self, cell: usize) -> usize {
        let mut root = cell;
        while self.parent[root] as usize != root {
            root = self.parent[root] as usize;
        }
        let mut cur = cell;
        while self.parent[cur] as usize != cur {
            let next = self.parent[cur] as usize;
            self.parent[cur] = root as u32;
            cur = next;
        }
        root
    }

    /// 2 マスが同じ線分(線でつながった成分)にいるか。
    pub fn same_segment(&mut self, a: usize, b: usize) -> bool {
        self.find(a) == self.find(b)
    }

    /// 辺を確定する。Ok(true)=新規確定 / Ok(false)=同値 / Err=矛盾。
    pub fn set(&mut self, board: &Board, edge: usize, state: EdgeState) -> Result<bool, String> {
        if state == EdgeState::Unknown {
            return Err("辺を未定に戻すことはできない".into());
        }
        if self.edges[edge] == state {
            return Ok(false);
        }
        if self.edges[edge] != EdgeState::Unknown {
            let (a, b) = {
                let [a, b] = board.edge_cells(edge);
                (board.position(a), board.position(b))
            };
            return Err(format!(
                "辺 {:?}-{:?} の {:?} を {:?} に変えようとした",
                a, b, self.edges[edge], state
            ));
        }
        let [a, b] = board.edge_cells(edge);
        match state {
            EdgeState::Line => {
                if self.line_count[a] >= 2 || self.line_count[b] >= 2 {
                    return Err(format!(
                        "マス {:?} に 3 本めの線",
                        board.position(if self.line_count[a] >= 2 { a } else { b })
                    ));
                }
                self.edges[edge] = EdgeState::Line;
                self.line_count[a] += 1;
                self.line_count[b] += 1;
                self.line_total += 1;
                let ra = self.find(a);
                let rb = self.find(b);
                if ra == rb {
                    self.loop_closed = true;
                } else {
                    self.parent[ra] = rb as u32;
                }
            }
            EdgeState::Bar => {
                self.edges[edge] = EdgeState::Bar;
                self.bar_count[a] += 1;
                self.bar_count[b] += 1;
            }
            EdgeState::Unknown => unreachable!(),
        }
        Ok(true)
    }

    /// 完成したか。閉路ができていて、線の端点がなく、全部の丸を線が通る。
    /// 残った未定の辺は暗黙に × とみなす(検証は validate_solution が行う)。
    pub fn is_complete(&self, board: &Board) -> bool {
        if !self.loop_closed {
            return false;
        }
        if self.line_count.iter().any(|&n| n == 1) {
            return false;
        }
        board.pearls().iter().all(|&(i, _)| self.line_count[i] == 2)
    }

    pub fn clone_for_trial(&self) -> Self {
        self.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn board_3x3() -> Board {
        Board::new(3, 3, vec![0; 9]).unwrap()
    }

    #[test]
    fn set_updates_counts_and_segments() {
        let board = board_3x3();
        let mut answer = AnswerModel::new(&board);
        // 水平辺 0 は マス0-1。
        assert_eq!(answer.set(&board, 0, EdgeState::Line), Ok(true));
        assert_eq!(answer.set(&board, 0, EdgeState::Line), Ok(false));
        assert!(answer.set(&board, 0, EdgeState::Bar).is_err());
        assert_eq!(answer.line_count(0), 1);
        assert!(answer.same_segment(0, 1));
        assert!(!answer.same_segment(0, 2));
    }

    #[test]
    fn closing_a_square_sets_loop_closed() {
        let board = Board::new(2, 2, vec![0; 4]).unwrap();
        let mut answer = AnswerModel::new(&board);
        // 2x2 の辺: 水平 0(0-1) 1(2-3)、垂直 2(0-2) 3(1-3)。
        for e in [0, 1, 2] {
            answer.set(&board, e, EdgeState::Line).unwrap();
            assert!(!answer.loop_closed);
        }
        answer.set(&board, 3, EdgeState::Line).unwrap();
        assert!(answer.loop_closed);
        assert!(answer.is_complete(&board));
    }

    #[test]
    fn third_line_into_a_cell_is_an_error() {
        let board = board_3x3();
        let mut answer = AnswerModel::new(&board);
        // マス4(中央) に 3 本入れると失敗する。
        let incident = *board.incident(4);
        answer.set(&board, incident[0], EdgeState::Line).unwrap();
        answer.set(&board, incident[1], EdgeState::Line).unwrap();
        assert!(answer.set(&board, incident[2], EdgeState::Line).is_err());
    }
}
