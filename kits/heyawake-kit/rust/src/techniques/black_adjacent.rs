//! 黒隣接禁(段階 1)。黒マスのタテヨコ隣を白にする。

use crate::answer_methods::{merge_status, AnswerMethods};
use crate::reasons::BLACK_ADJACENT;
use crate::status::Status;

pub fn black_adjacent(answer: &mut AnswerMethods<'_>) -> Status {
    let board = answer.board;
    let black: Vec<usize> = (0..board.cell_count())
        .filter(|&index| answer.answer.is_black(index))
        .collect();
    let mut result = Status::Stopped;
    for index in black {
        for &next in board.neighbours(index) {
            if answer.answer.is_black(next) {
                return Status::Broken;
            }
            result = merge_status(result, answer.set_white(next, BLACK_ADJACENT));
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
    use crate::answer_model::{AnswerModel, CellState};
    use crate::board::Board;

    #[test]
    fn neighbours_of_black_become_white() {
        let board = Board::new(3, 1, vec![false, false], vec![], vec![None]).unwrap();
        let mut model = AnswerModel::new(&board);
        model.set(1, CellState::Black).unwrap();
        let mut methods = AnswerMethods::new(&board, &mut model, None);
        assert_eq!(black_adjacent(&mut methods), Status::Advanced);
        assert!(model.is_white(0) && model.is_white(2));
    }

    #[test]
    fn adjacent_black_cells_are_a_contradiction() {
        let board = Board::new(2, 1, vec![false], vec![], vec![None]).unwrap();
        let mut model = AnswerModel::new(&board);
        model.set(0, CellState::Black).unwrap();
        model.set(1, CellState::Black).unwrap();
        let mut methods = AnswerMethods::new(&board, &mut model, None);
        assert_eq!(black_adjacent(&mut methods), Status::Broken);
    }
}
