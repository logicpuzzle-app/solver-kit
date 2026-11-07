//! かべの継続(カタログ C)。
//!
//! すべてのかべは最終的にひとつながりになる。あるマスを白にすると、かべがもう繋がれなく
//! なるなら、そのマスはかべである。
//!
//! 判定は「かべ ∪ 未確定」のグラフからそのマスを除いて、既存のかべ同士がまだ到達可能か。
//! Conceptis の「かべの継続」、へやわけでいう寸断の黒にあたる。

use crate::answer_methods::{merge_status, AnswerMethods};
use crate::answer_model::AnswerModel;
use crate::board::Board;
use crate::reasons::WALL_EXTEND;
use crate::status::Status;

/// `blocked` を通れないものとして、`from` から「かべ ∪ 未確定」を辿れる範囲を返す。
fn flood(board: &Board, answer: &AnswerModel, from: usize, blocked: usize) -> Vec<bool> {
    let mut seen = vec![false; board.cell_count()];
    if from == blocked {
        return seen;
    }
    seen[from] = true;
    let mut stack = vec![from];
    while let Some(index) = stack.pop() {
        for next in board.neighbours(index) {
            if seen[next] || next == blocked || answer.is_white(next) {
                continue;
            }
            seen[next] = true;
            stack.push(next);
        }
    }
    seen
}

pub fn wall_cut(answer: &mut AnswerMethods<'_>) -> Status {
    let board = answer.board;
    let blacks: Vec<usize> = (0..board.cell_count())
        .filter(|&i| answer.answer.is_black(i))
        .collect();
    if blacks.len() < 2 {
        return Status::Stopped; // 分断のしようがない
    }

    let mut result = Status::Stopped;
    for index in 0..board.cell_count() {
        if !answer.answer.is_unknown(index) {
            continue;
        }
        // このマスを白にしたと仮定して、かべ同士がまだ繋がれるか
        let seen = flood(board, answer.answer, blacks[0], index);
        if blacks.iter().any(|&b| !seen[b]) {
            result = merge_status(result, answer.set_black(index, WALL_EXTEND));
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
    use crate::board::{Board, NO_CLUE};

    #[test]
    fn a_cell_whose_removal_splits_the_wall_is_wall() {
        // 1x3: 両端かべ。中央を白にすると分断される
        let board = Board::new(3, 1, vec![NO_CLUE; 3]).unwrap();
        let mut answer = AnswerModel::new(&board);
        answer.set(0, CellState::Black).unwrap();
        answer.set(2, CellState::Black).unwrap();
        let mut methods = AnswerMethods::new(&board, &mut answer, None);
        assert_eq!(wall_cut(&mut methods), Status::Advanced);
        assert!(answer.is_black(1));
    }

    #[test]
    fn a_cell_with_an_alternative_route_is_left_alone() {
        // 3x2 のリング状: 迂回路があるので中央は確定しない
        let board = Board::new(3, 2, vec![NO_CLUE; 6]).unwrap();
        let mut answer = AnswerModel::new(&board);
        answer.set(0, CellState::Black).unwrap();
        answer.set(2, CellState::Black).unwrap();
        let mut methods = AnswerMethods::new(&board, &mut answer, None);
        // (1) を白にしても下の行(3,4,5)を回って繋がれる
        assert_eq!(wall_cut(&mut methods), Status::Stopped);
    }

    #[test]
    fn a_single_wall_cell_decides_nothing() {
        let board = Board::new(3, 1, vec![NO_CLUE; 3]).unwrap();
        let mut answer = AnswerModel::new(&board);
        answer.set(0, CellState::Black).unwrap();
        let mut methods = AnswerMethods::new(&board, &mut answer, None);
        assert_eq!(wall_cut(&mut methods), Status::Stopped);
    }
}
