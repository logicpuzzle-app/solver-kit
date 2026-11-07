//! 別々のシマを繋いではいけない(カタログ A の一般形)。
//!
//! ある未確定マスの隣に、異なる数字を含む白の塊が 2 つ以上あるなら、そのマスを白にすると
//! 2 つのシマが繋がってしまう。よってかべ。
//!
//! `clue_neighbours` の「斜め数字」「1マス飛ばし」を、確定済みの白マスまで含めた形に
//! 一般化したもの。盤面が進むほど効く。

use crate::answer_methods::{merge_status, AnswerMethods};
use crate::answer_model::AnswerModel;
use crate::board::Board;
use crate::reasons::DIAGONAL_CLUES;
use crate::status::Status;

/// 各マスがどの白の塊に属するかを塗り分け、塊ごとに「含む数字マス」を返す。
fn white_labels(board: &Board, answer: &AnswerModel) -> (Vec<i32>, Vec<Option<usize>>) {
    let count = board.cell_count();
    let mut label = vec![-1i32; count];
    let mut clue_of = Vec::new();
    for start in 0..count {
        if label[start] >= 0 || !answer.is_white(start) {
            continue;
        }
        let id = clue_of.len() as i32;
        let mut stack = vec![start];
        let mut clue = None;
        label[start] = id;
        while let Some(index) = stack.pop() {
            let (x, y) = board.position(index);
            if board.is_clue(x, y) {
                clue = Some(index);
            }
            for next in board.neighbours(index) {
                if label[next] < 0 && answer.is_white(next) {
                    label[next] = id;
                    stack.push(next);
                }
            }
        }
        clue_of.push(clue);
    }
    (label, clue_of)
}

pub fn separate(answer: &mut AnswerMethods<'_>) -> Status {
    let board = answer.board;
    let (label, clue_of) = white_labels(board, answer.answer);
    let mut result = Status::Stopped;

    for index in 0..board.cell_count() {
        if !answer.answer.is_unknown(index) {
            continue;
        }
        // 隣接する白の塊のうち、数字を持つものの数字マスを集める
        let mut clues = Vec::new();
        for next in board.neighbours(index) {
            if label[next] >= 0 {
                if let Some(clue) = clue_of[label[next] as usize] {
                    if !clues.contains(&clue) {
                        clues.push(clue);
                    }
                }
            }
        }
        if clues.len() >= 2 {
            result = merge_status(result, answer.set_black(index, DIAGONAL_CLUES));
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
    use crate::answer_model::CellState;
    use crate::board::NO_CLUE;

    #[test]
    fn a_cell_joining_two_islands_is_wall() {
        // 1x3: 両端が別の数字 → 中央はかべ
        let board = Board::new(3, 1, vec![2, NO_CLUE, 2]).unwrap();
        let mut answer = AnswerModel::new(&board);
        let mut methods = AnswerMethods::new(&board, &mut answer, None);
        assert_eq!(separate(&mut methods), Status::Advanced);
        assert!(answer.is_black(1));
    }

    #[test]
    fn it_uses_grown_white_cells_not_just_clues() {
        // 1x5: (0)=3 が (1) まで伸びている、(4)=2 が (3) まで伸びている → (2) はかべ
        let board = Board::new(5, 1, vec![3, NO_CLUE, NO_CLUE, NO_CLUE, 2]).unwrap();
        let mut answer = AnswerModel::new(&board);
        answer.set(1, CellState::White).unwrap();
        answer.set(3, CellState::White).unwrap();
        let mut methods = AnswerMethods::new(&board, &mut answer, None);
        assert_eq!(separate(&mut methods), Status::Advanced);
        assert!(answer.is_black(2));
    }

    #[test]
    fn one_island_nearby_decides_nothing() {
        let board = Board::new(3, 1, vec![2, NO_CLUE, NO_CLUE]).unwrap();
        let mut answer = AnswerModel::new(&board);
        let mut methods = AnswerMethods::new(&board, &mut answer, None);
        assert_eq!(separate(&mut methods), Status::Stopped);
    }
}
