//! 完成した解答がルールを満たすかの検証。
//!
//! **手筋ソルバーとは独立に書く。** 同じ判断を 2 回書いておくと、
//! 手筋の側にバグが入ったときに「解けた」と言い張れなくなる。

use crate::answer_model::AnswerModel;
use crate::board::Board;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ValidationError {
    /// まだ未確定のマスが残っている。
    Incomplete,
    /// かべに照明が置かれている。
    LampOnWall { index: usize },
    /// 数字と、隣り合う照明の数が合わない。
    ClueMismatch {
        index: usize,
        want: i32,
        got: i32,
    },
    /// 照明どうしが照らし合っている。
    LampsSeeEachOther { a: usize, b: usize },
    /// どの照明にも照らされていない白マスがある。
    Unlit { index: usize },
}

pub fn validate_solution(board: &Board, answer: &AnswerModel) -> Vec<ValidationError> {
    let mut errors = Vec::new();
    if !answer.is_complete() {
        errors.push(ValidationError::Incomplete);
        return errors;
    }

    for index in 0..board.cell_count() {
        if board.is_wall(index) && answer.is_lamp(index) {
            errors.push(ValidationError::LampOnWall { index });
        }
    }

    for (index, want) in board.clue_cells() {
        let got = board
            .neighbours(index)
            .into_iter()
            .filter(|&&n| answer.is_lamp(n))
            .count() as i32;
        if got != want {
            errors.push(ValidationError::ClueMismatch { index, want, got });
        }
    }

    for index in answer.lamps() {
        for ray in board.rays(index) {
            for &seen in ray {
                if answer.is_lamp(seen) {
                    errors.push(ValidationError::LampsSeeEachOther { a: index, b: seen });
                    break;
                }
            }
        }
    }

    let lit = answer.lit(board);
    for index in 0..board.cell_count() {
        if board.is_open(index) && !lit[index] {
            errors.push(ValidationError::Unlit { index });
        }
    }

    errors
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::answer_model::CellState;
    use crate::board::{Board, OPEN, WALL};

    fn place(board: &Board, lamps: &[usize]) -> AnswerModel {
        let mut answer = AnswerModel::new(board);
        for index in 0..board.cell_count() {
            let state = if lamps.contains(&index) {
                CellState::Lamp
            } else {
                CellState::Empty
            };
            let _ = answer.set(index, state);
        }
        answer
    }

    #[test]
    fn a_correct_answer_has_no_errors() {
        // 1x3: [1のかべ][白][白] — 照明は左の白マスに 1 つ
        let board = Board::new(3, 1, vec![1, OPEN, OPEN]).unwrap();
        let answer = place(&board, &[1]);
        assert!(validate_solution(&board, &answer).is_empty());
    }

    #[test]
    fn two_lamps_in_a_line_see_each_other() {
        let board = Board::new(3, 1, vec![OPEN, OPEN, OPEN]).unwrap();
        let answer = place(&board, &[0, 2]);
        assert!(validate_solution(&board, &answer)
            .iter()
            .any(|e| matches!(e, ValidationError::LampsSeeEachOther { .. })));
    }

    #[test]
    fn a_wall_between_lamps_is_fine() {
        let board = Board::new(3, 1, vec![OPEN, WALL, OPEN]).unwrap();
        let answer = place(&board, &[0, 2]);
        assert!(validate_solution(&board, &answer).is_empty());
    }

    #[test]
    fn an_unlit_cell_is_an_error() {
        let board = Board::new(3, 1, vec![OPEN, WALL, OPEN]).unwrap();
        let answer = place(&board, &[0]);
        assert_eq!(
            validate_solution(&board, &answer),
            vec![ValidationError::Unlit { index: 2 }]
        );
    }

    #[test]
    fn a_clue_counts_only_its_four_neighbours() {
        // 3x1: [白][1のかべ][白] — 照明が 2 つなら数字と合わない
        let board = Board::new(3, 1, vec![OPEN, 1, OPEN]).unwrap();
        let answer = place(&board, &[0, 2]);
        assert!(validate_solution(&board, &answer)
            .iter()
            .any(|e| matches!(e, ValidationError::ClueMismatch { want: 1, got: 2, .. })));
    }
}
