//! 3 連続禁(段階 3)。
//!
//! 白の直線は部屋境界を 2 本以上またげない。見るのは「隣り合う境界 2 本の最小窓」
//! (境界の左のマス〜次の境界の右のマス)だけでよい。2 本以上またぐ区間はどれも
//! 最小窓を含むので、矛盾の検出も 1 マスの強制も等価になる。
//! 内向き三連禁(両側が白で間の 1 マスが黒)も外向き三連禁(白 2 部屋の先が黒)も
//! この窓の「黒が置ける残りが 1 マス」の場合として同じ形で出る。

use crate::answer_methods::{merge_status, AnswerMethods};
use crate::reasons::THREE_IN_LINE;
use crate::status::Status;

pub fn three_in_line(answer: &mut AnswerMethods<'_>) -> Status {
    let board = answer.board;
    let mut result = Status::Stopped;
    for line in board.row_lines().iter().chain(board.col_lines()) {
        let mut previous: Option<usize> = None;
        for (at, &is_boundary) in line.boundaries.iter().enumerate() {
            if !is_boundary {
                continue;
            }
            if let Some(start) = previous {
                let cells = &line.cells[start..=at + 1];
                if !cells.iter().any(|&index| answer.answer.is_black(index)) {
                    let mut unknown = cells
                        .iter()
                        .copied()
                        .filter(|&index| answer.answer.is_unknown(index));
                    match (unknown.next(), unknown.next()) {
                        (None, _) => return Status::Broken,
                        (Some(only), None) => {
                            result =
                                merge_status(result, answer.set_black(only, THREE_IN_LINE));
                            if result == Status::Broken {
                                return result;
                            }
                        }
                        _ => {}
                    }
                }
            }
            previous = Some(at);
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::answer_model::{AnswerModel, CellState};
    use crate::board::Board;

    /// 外向き: 白が 2 部屋続いたら、次の部屋の最初のマスは黒。
    #[test]
    fn stops_a_white_run_before_the_third_room() {
        let board = Board::new(
            3,
            1,
            vec![true, true],
            vec![],
            vec![None, None, None],
        )
        .unwrap();
        let mut model = AnswerModel::new(&board);
        model.set(0, CellState::White).unwrap();
        model.set(1, CellState::White).unwrap();
        let mut methods = AnswerMethods::new(&board, &mut model, None);
        assert_eq!(three_in_line(&mut methods), Status::Advanced);
        assert!(model.is_black(2));
    }

    /// 全部白に確定してしまっていたら矛盾。
    #[test]
    fn an_all_white_window_is_broken() {
        let board = Board::new(
            3,
            1,
            vec![true, true],
            vec![],
            vec![None, None, None],
        )
        .unwrap();
        let mut model = AnswerModel::new(&board);
        for index in 0..3 {
            model.set(index, CellState::White).unwrap();
        }
        let mut methods = AnswerMethods::new(&board, &mut model, None);
        assert_eq!(three_in_line(&mut methods), Status::Broken);
    }

    /// 窓に黒が置けるうちは何もしない。
    #[test]
    fn leaves_an_open_window_alone() {
        let board = Board::new(
            3,
            1,
            vec![true, true],
            vec![],
            vec![None, None, None],
        )
        .unwrap();
        let mut model = AnswerModel::new(&board);
        let mut methods = AnswerMethods::new(&board, &mut model, None);
        assert_eq!(three_in_line(&mut methods), Status::Stopped);
    }
}
