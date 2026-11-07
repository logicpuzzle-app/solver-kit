//! マスの次数。線は通るなら 2 本、通らないなら 0 本。
//!
//! - 線が 2 本のマス: 残りの辺は ×
//! - 線が 1 本で未定が 1 本のマス: その辺は線(一意な延長)
//! - 線が 1 本で未定が 0 本のマス: 行き止まり → 矛盾
//! - 線が 0 本で未定が 1 本のマス: その辺を線にすると行き止まりになるので ×
//! - 丸のマスで線を 2 本にできない: 矛盾

use crate::answer_methods::{merge_status, AnswerMethods};
use crate::answer_model::EdgeState;
use crate::board::NO_EDGE;
use crate::reasons::DEGREE;
use crate::status::Status;

pub fn degree(answer: &mut AnswerMethods<'_>) -> Status {
    let board = answer.board;
    let mut forced: Vec<(usize, EdgeState)> = Vec::new();

    // 線が 1 本もなく、引ける余地も残っていないなら矛盾(ループは必ず要る)。
    // 丸のない問題の仮置きで「全部 ×」の枝を落とすのはこれ。
    if answer.answer.line_total() == 0 && answer.answer.unknown_count() == 0 {
        return Status::Broken;
    }

    for cell in 0..board.cell_count() {
        let lines = answer.answer.line_count(cell);
        let unknown = answer.answer.unknown_count_at(board, cell);
        if board.is_pearl(cell) && u32::from(lines) + u32::from(unknown) < 2 {
            return Status::Broken;
        }
        match (lines, unknown) {
            (2, _) => {
                for &edge in board.incident(cell) {
                    if edge != NO_EDGE && answer.answer.is_unknown(edge) {
                        forced.push((edge, EdgeState::Bar));
                    }
                }
            }
            (1, 0) => return Status::Broken,
            (1, 1) | (0, 1) => {
                let state = if lines == 1 {
                    EdgeState::Line
                } else {
                    EdgeState::Bar
                };
                for &edge in board.incident(cell) {
                    if edge != NO_EDGE && answer.answer.is_unknown(edge) {
                        forced.push((edge, state));
                    }
                }
            }
            _ => {}
        }
    }

    let mut result = Status::Stopped;
    for (edge, state) in forced {
        result = merge_status(result, answer.set(edge, state, DEGREE));
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
    use crate::answer_model::{AnswerModel, EdgeState};
    use crate::board::Board;

    #[test]
    fn a_lone_unknown_edge_is_barred() {
        // 2x2 で辺 0 (マス0-1) 以外を × にすると、マス 0 の未定辺は 1 本。
        let board = Board::new(2, 2, vec![0; 4]).unwrap();
        let mut model = AnswerModel::new(&board);
        model.set(&board, 2, EdgeState::Bar).unwrap();
        let mut answer = AnswerMethods::new(&board, &mut model, None);
        assert_eq!(degree(&mut answer), Status::Advanced);
        assert!(model.is_bar(0));
    }

    #[test]
    fn an_endpoint_with_one_exit_extends() {
        let board = Board::new(3, 3, vec![0; 9]).unwrap();
        let mut model = AnswerModel::new(&board);
        // マス0: 右(辺0)を線、下(辺6)を × → 出口なしで矛盾。
        model.set(&board, 0, EdgeState::Line).unwrap();
        model.set(&board, 6, EdgeState::Bar).unwrap();
        let mut answer = AnswerMethods::new(&board, &mut model, None);
        assert_eq!(degree(&mut answer), Status::Broken);
    }

    #[test]
    fn a_full_cell_bars_the_rest() {
        let board = Board::new(3, 3, vec![0; 9]).unwrap();
        let mut model = AnswerModel::new(&board);
        // 中央(マス4)に 2 本: 右(辺3)と左(辺2)。残り上下は ×。
        model.set(&board, 2, EdgeState::Line).unwrap();
        model.set(&board, 3, EdgeState::Line).unwrap();
        let mut answer = AnswerMethods::new(&board, &mut model, None);
        assert_eq!(degree(&mut answer), Status::Advanced);
        assert!(model.is_bar(7)); // マス1-4
        assert!(model.is_bar(10)); // マス4-7
    }
}
