//! 数字まわりの定石(段階 1)。
//!
//! 数字は「タテヨコに隣り合う 4 マスに置かれる照明の数」なので、
//! 隣 4 マスだけを見れば決まる話が 2 つある。
//!
//! - 数字ぶんの照明が置けたら、残りの隣は非照明(0 のかべもこれに含まれる)
//! - 置ける残りが数字ぶんちょうどなら、その全部が照明
//!
//! どちらも足りない/多すぎるときは矛盾。

use crate::answer_methods::{merge_status, AnswerMethods};
use crate::answer_model::CellState;
use crate::reasons::{CLUE_FULL, CLUE_SATURATED};
use crate::status::Status;

pub fn clue(answer: &mut AnswerMethods<'_>) -> Status {
    let board = answer.board;
    let mut result = Status::Stopped;
    for (index, want) in board.clue_cells() {
        let neighbours = board.neighbours(index);
        let lamps = neighbours
            .iter()
            .filter(|&&n| answer.answer.is_lamp(n))
            .count() as i32;
        let unknown: Vec<usize> = neighbours
            .into_iter()
            .filter(|&&n| answer.answer.is_unknown(n))
            .copied()
            .collect();
        if lamps > want || lamps + (unknown.len() as i32) < want {
            return Status::Broken;
        }
        let fill = if lamps == want {
            Some((CellState::Empty, CLUE_FULL))
        } else if lamps + (unknown.len() as i32) == want {
            Some((CellState::Lamp, CLUE_SATURATED))
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
    use crate::board::{Board, OPEN};

    #[test]
    fn a_zero_wall_forbids_all_four_neighbours() {
        // 1x3: [白][0のかべ][白]
        let board = Board::new(3, 1, vec![OPEN, 0, OPEN]).unwrap();
        let mut model = AnswerModel::new(&board);
        let mut methods = AnswerMethods::new(&board, &mut model, None);
        assert_eq!(clue(&mut methods), Status::Advanced);
        assert!(model.is_empty(0) && model.is_empty(2));
    }

    #[test]
    fn a_clue_that_needs_every_remaining_cell_fills_them() {
        // 1x3: [白][2のかべ][白] — 隣は 2 マスしかないので両方に照明
        let board = Board::new(3, 1, vec![OPEN, 2, OPEN]).unwrap();
        let mut model = AnswerModel::new(&board);
        let mut methods = AnswerMethods::new(&board, &mut model, None);
        assert_eq!(clue(&mut methods), Status::Advanced);
        assert!(model.is_lamp(0) && model.is_lamp(2));
    }

    #[test]
    fn a_clue_that_cannot_be_reached_is_a_contradiction() {
        // 1x2: [白][2のかべ] — 隣が 1 マスしかない
        let board = Board::new(2, 1, vec![OPEN, 2]).unwrap();
        let mut model = AnswerModel::new(&board);
        let mut methods = AnswerMethods::new(&board, &mut model, None);
        assert_eq!(clue(&mut methods), Status::Broken);
    }
}
