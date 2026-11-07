//! 相互照射禁(段階 1)。
//!
//! 照明は他の照明に照らされてはいけないので、置いた照明の光が届くマスには
//! もう照明を置けない。美術館でいちばん頻繁に発火する手筋。

use crate::answer_methods::{merge_status, AnswerMethods};
use crate::reasons::LAMP_RAY;
use crate::status::Status;

pub fn lamp_ray(answer: &mut AnswerMethods<'_>) -> Status {
    let board = answer.board;
    let mut result = Status::Stopped;
    for index in answer.answer.lamps() {
        for ray in board.rays(index) {
            for &seen in ray {
                if answer.answer.is_lamp(seen) {
                    return Status::Broken; // 照明どうしが照らし合っている
                }
                if answer.answer.is_unknown(seen) {
                    result = merge_status(result, answer.set_empty(seen, LAMP_RAY));
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
    use crate::board::{Board, OPEN, WALL};

    #[test]
    fn a_lamp_forbids_everything_it_lights() {
        let board = Board::new(4, 1, vec![OPEN, OPEN, WALL, OPEN]).unwrap();
        let mut model = AnswerModel::new(&board);
        model.set(0, CellState::Lamp).unwrap();
        let mut methods = AnswerMethods::new(&board, &mut model, None);
        assert_eq!(lamp_ray(&mut methods), Status::Advanced);
        assert!(model.is_empty(1));
        assert!(model.is_unknown(3), "かべの向こうには届かない");
    }

    #[test]
    fn two_lamps_in_sight_are_a_contradiction() {
        let board = Board::new(3, 1, vec![OPEN, OPEN, OPEN]).unwrap();
        let mut model = AnswerModel::new(&board);
        model.set(0, CellState::Lamp).unwrap();
        model.set(2, CellState::Lamp).unwrap();
        let mut methods = AnswerMethods::new(&board, &mut model, None);
        assert_eq!(lamp_ray(&mut methods), Status::Broken);
    }
}
