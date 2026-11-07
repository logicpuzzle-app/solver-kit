//! カット偶奇。
//!
//! 盤面を縦(横)一直線に切ると、ループはその切り口を偶数回横切る
//! (Jordan 曲線)。切り口の未定辺が 1 本なら、確定済みの横断本数の
//! 偶奇からその辺が決まる。0 本で奇数なら矛盾。

use crate::answer_methods::{merge_status, AnswerMethods};
use crate::answer_model::EdgeState;
use crate::board::Board;
use crate::reasons::CUT_PARITY;
use crate::status::Status;

/// 縦カット x | x+1 を横切る水平辺、横カット y | y+1 を横切る垂直辺の一覧。
fn cuts(board: &Board) -> Vec<Vec<usize>> {
    let mut cuts = Vec::with_capacity(board.cols - 1 + board.rows - 1);
    for x in 0..board.cols - 1 {
        cuts.push(
            (0..board.rows)
                .map(|y| y * (board.cols - 1) + x)
                .collect(),
        );
    }
    let h_count = (board.cols - 1) * board.rows;
    for y in 0..board.rows - 1 {
        cuts.push(
            (0..board.cols)
                .map(|x| h_count + y * board.cols + x)
                .collect(),
        );
    }
    cuts
}

pub fn cut_parity(answer: &mut AnswerMethods<'_>) -> Status {
    let board = answer.board;
    let mut forced: Vec<(usize, EdgeState)> = Vec::new();

    for cut in cuts(board) {
        let mut lines = 0;
        let mut unknown = None;
        let mut unknown_count = 0;
        for &edge in &cut {
            if answer.answer.is_line(edge) {
                lines += 1;
            } else if answer.answer.is_unknown(edge) {
                unknown_count += 1;
                unknown = Some(edge);
            }
        }
        match (unknown_count, lines % 2) {
            (0, 1) => return Status::Broken,
            (1, parity) => {
                let state = if parity == 1 {
                    EdgeState::Line
                } else {
                    EdgeState::Bar
                };
                forced.push((unknown.unwrap(), state));
            }
            _ => {}
        }
    }

    let mut result = Status::Stopped;
    for (edge, state) in forced {
        result = merge_status(result, answer.set(edge, state, CUT_PARITY));
        if result == Status::Broken {
            return result;
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::answer_methods::AnswerMethods;
    use crate::answer_model::AnswerModel;

    #[test]
    fn an_odd_cut_with_one_unknown_is_completed() {
        // 3x2。縦カット 0|1 の水平辺は 2 本(辺0, 辺2)。
        // 辺0 を線にすると、残る辺2 は偶奇から線に確定する。
        let board = Board::new(3, 2, vec![0; 6]).unwrap();
        let mut model = AnswerModel::new(&board);
        model.set(&board, 0, EdgeState::Line).unwrap();
        let mut answer = AnswerMethods::new(&board, &mut model, None);
        assert_eq!(cut_parity(&mut answer), Status::Advanced);
        assert!(model.is_line(2));
    }

    #[test]
    fn an_odd_full_cut_is_broken() {
        let board = Board::new(3, 2, vec![0; 6]).unwrap();
        let mut model = AnswerModel::new(&board);
        model.set(&board, 0, EdgeState::Line).unwrap();
        model.set(&board, 2, EdgeState::Bar).unwrap();
        let mut answer = AnswerMethods::new(&board, &mut model, None);
        assert_eq!(cut_parity(&mut answer), Status::Broken);
    }
}
