//! 救出(段階 2)。美術館でいちばん強い手筋。
//!
//! すべての白マスはいずれかの照明に照らされる。まだ照らされていない白マスについて
//! 「そこを照らせる場所」を数え、
//!
//! - 1 つしかなければ、そこが照明
//! - 0 なら矛盾
//!
//! 「照らせる場所」は、そのマス自身と、そこから 4 方向にかべまで伸びるマスのうち、
//! まだ非照明と決まっていないもの。

use crate::answer_methods::{merge_status, AnswerMethods};
use crate::reasons::ONLY_SOURCE;
use crate::status::Status;

pub fn only_source(answer: &mut AnswerMethods<'_>) -> Status {
    let board = answer.board;
    let lit = answer.answer.lit(board);
    let mut forced = Vec::new();
    for index in 0..board.cell_count() {
        if !board.is_open(index) || lit[index] {
            continue;
        }
        let mut candidates = board
            .sight(index)
            .iter()
            .copied()
            .filter(|&c| answer.answer.is_unknown(c));
        let Some(first) = candidates.next() else {
            return Status::Broken; // 照らしようがない白マスがある
        };
        if candidates.next().is_none() {
            forced.push(first);
        }
    }

    let mut result = Status::Stopped;
    for index in forced {
        result = merge_status(result, answer.set_lamp(index, ONLY_SOURCE));
        if result == Status::Broken {
            return result;
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::answer_model::{AnswerModel, CellState};
    use crate::board::{Board, OPEN, WALL};

    #[test]
    fn a_cell_with_a_single_source_gets_the_lamp() {
        // 1x2: [白][白] のうち右を非照明に決めると、左しか照らせない
        let board = Board::new(2, 1, vec![OPEN, OPEN]).unwrap();
        let mut model = AnswerModel::new(&board);
        model.set(1, CellState::Empty).unwrap();
        let mut methods = AnswerMethods::new(&board, &mut model, None);
        assert_eq!(only_source(&mut methods), Status::Advanced);
        assert!(model.is_lamp(0));
    }

    #[test]
    fn a_cell_with_no_source_is_a_contradiction() {
        let board = Board::new(2, 1, vec![OPEN, OPEN]).unwrap();
        let mut model = AnswerModel::new(&board);
        model.set(0, CellState::Empty).unwrap();
        model.set(1, CellState::Empty).unwrap();
        let mut methods = AnswerMethods::new(&board, &mut model, None);
        assert_eq!(only_source(&mut methods), Status::Broken);
    }

    #[test]
    fn an_isolated_cell_must_hold_its_own_lamp() {
        // 1x3: [かべ][白][かべ] — 真ん中は自分で照らすしかない
        let board = Board::new(3, 1, vec![WALL, OPEN, WALL]).unwrap();
        let mut model = AnswerModel::new(&board);
        let mut methods = AnswerMethods::new(&board, &mut model, None);
        assert_eq!(only_source(&mut methods), Status::Advanced);
        assert!(model.is_lamp(1));
    }

    #[test]
    fn a_lit_cell_says_nothing() {
        let board = Board::new(3, 1, vec![OPEN, OPEN, OPEN]).unwrap();
        let mut model = AnswerModel::new(&board);
        model.set(0, CellState::Lamp).unwrap();
        let mut methods = AnswerMethods::new(&board, &mut model, None);
        assert_eq!(only_source(&mut methods), Status::Stopped);
    }
}
