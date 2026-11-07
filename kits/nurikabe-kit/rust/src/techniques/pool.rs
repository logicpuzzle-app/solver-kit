//! 2x2 禁止(カタログ D)。
//!
//! かべが 2x2 の塊になってはいけないので、2x2 の 4 マスのうち 3 マスがかべなら
//! 残りは白。4 マスすべてかべなら矛盾。

use crate::answer_methods::{merge_status, AnswerMethods};
use crate::reasons::POOL_WHITE;
use crate::status::Status;

pub fn pool(answer: &mut AnswerMethods<'_>) -> Status {
    let board = answer.board;
    let mut result = Status::Stopped;
    for y in 0..board.rows - 1 {
        for x in 0..board.cols - 1 {
            let quad = [
                board.index(x, y),
                board.index(x + 1, y),
                board.index(x, y + 1),
                board.index(x + 1, y + 1),
            ];
            let black = quad.iter().filter(|&&i| answer.answer.is_black(i)).count();
            if black == 4 {
                return Status::Broken;
            }
            if black == 3 {
                if let Some(&rest) = quad.iter().find(|&&i| !answer.answer.is_black(i)) {
                    result = merge_status(result, answer.set_white(rest, POOL_WHITE));
                    if result == Status::Broken {
                        return result;
                    }
                }
            }
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::answer_model::{AnswerModel, CellState};
    use crate::board::{Board, NO_CLUE};

    #[test]
    fn three_walls_in_a_square_force_the_fourth_white() {
        let board = Board::new(2, 2, vec![NO_CLUE; 4]).unwrap();
        let mut answer = AnswerModel::new(&board);
        for i in 0..3 {
            answer.set(i, CellState::Black).unwrap();
        }
        let mut methods = AnswerMethods::new(&board, &mut answer, None);
        assert_eq!(pool(&mut methods), Status::Advanced);
        assert!(answer.is_white(3));
    }

    #[test]
    fn a_full_square_of_wall_is_a_contradiction() {
        let board = Board::new(2, 2, vec![NO_CLUE; 4]).unwrap();
        let mut answer = AnswerModel::new(&board);
        for i in 0..4 {
            answer.set(i, CellState::Black).unwrap();
        }
        let mut methods = AnswerMethods::new(&board, &mut answer, None);
        assert_eq!(pool(&mut methods), Status::Broken);
    }

    #[test]
    fn two_walls_decide_nothing() {
        let board = Board::new(2, 2, vec![NO_CLUE; 4]).unwrap();
        let mut answer = AnswerModel::new(&board);
        answer.set(0, CellState::Black).unwrap();
        answer.set(1, CellState::Black).unwrap();
        let mut methods = AnswerMethods::new(&board, &mut answer, None);
        assert_eq!(pool(&mut methods), Status::Stopped);
    }
}
