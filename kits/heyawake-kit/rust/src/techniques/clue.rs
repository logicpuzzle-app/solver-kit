//! 部屋の数字の勘定(段階 1)。
//!
//! 黒が数字ぶんあれば残りは白、未確定が残り必要な黒数と同じなら全部黒。
//! 数字 0 の部屋が全白になるのも前者に含まれる。

use crate::answer_methods::{merge_status, AnswerMethods};
use crate::answer_model::CellState;
use crate::reasons::{CLUE_FULL, CLUE_SATURATED};
use crate::status::Status;

pub fn clue(answer: &mut AnswerMethods<'_>) -> Status {
    let board = answer.board;
    let mut result = Status::Stopped;
    for (room_id, want) in board.clue_rooms() {
        let cells = &board.room(room_id).cells;
        let black = cells
            .iter()
            .filter(|&&index| answer.answer.is_black(index))
            .count() as i32;
        let unknown: Vec<usize> = cells
            .iter()
            .copied()
            .filter(|&index| answer.answer.is_unknown(index))
            .collect();
        if black > want || black + (unknown.len() as i32) < want {
            return Status::Broken;
        }
        let fill = if black == want {
            Some((CellState::White, CLUE_FULL))
        } else if black + unknown.len() as i32 == want {
            Some((CellState::Black, CLUE_SATURATED))
        } else {
            None
        };
        if let Some((state, reason)) = fill {
            result = merge_status(result, answer.set_many(unknown, state, reason));
            if result == Status::Broken {
                return result;
            }
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::answer_model::AnswerModel;
    use crate::board::Board;

    #[test]
    fn a_zero_room_becomes_white() {
        let board = Board::new(2, 1, vec![false], vec![], vec![Some(0)]).unwrap();
        let mut model = AnswerModel::new(&board);
        let mut methods = AnswerMethods::new(&board, &mut model, None);
        assert_eq!(clue(&mut methods), Status::Advanced);
        assert!(model.is_white(0) && model.is_white(1));
    }

    #[test]
    fn every_remaining_cell_becomes_black() {
        let board = Board::new(2, 1, vec![false], vec![], vec![Some(2)]).unwrap();
        let mut model = AnswerModel::new(&board);
        let mut methods = AnswerMethods::new(&board, &mut model, None);
        assert_eq!(clue(&mut methods), Status::Advanced);
        assert!(model.is_black(0) && model.is_black(1));
    }

    #[test]
    fn an_unreachable_number_is_a_contradiction() {
        let board = Board::new(1, 1, vec![], vec![], vec![Some(2)]).unwrap();
        let mut model = AnswerModel::new(&board);
        let mut methods = AnswerMethods::new(&board, &mut model, None);
        assert_eq!(clue(&mut methods), Status::Broken);
    }
}
