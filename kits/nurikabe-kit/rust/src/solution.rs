//! 完成解がルールを満たすかの検証。
//!
//! 手筋ソルバーとも制約エンジンとも独立に書く。生成・探索・手筋のどれが間違っても
//! ここで捕まえられるようにするため、実装を共有しない。

use crate::answer_model::{AnswerModel, CellState};
use crate::board::{Board, UNKNOWN_CLUE};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ValidationError {
    /// 未確定マスが残っている。
    Incomplete(usize),
    /// 数字マスが黒く塗られている。
    ClueIsBlack(usize),
    /// シマに数字がない。
    IslandWithoutClue { cells: Vec<usize> },
    /// シマに数字が 2 つ以上ある。
    IslandWithManyClues { cells: Vec<usize>, clues: usize },
    /// シマの大きさが数字と違う。
    IslandSizeMismatch {
        clue_index: usize,
        expected: i32,
        actual: usize,
    },
    /// 黒マスが 2 つ以上の塊に分かれている。
    BlackNotConnected { components: usize },
    /// 黒マスが 2x2 の塊になっている(左上のマス)。
    BlackPool(usize),
}

/// 連結成分を求める。`want` が真になるマスだけを辿る。
fn components(board: &Board, want: impl Fn(usize) -> bool) -> Vec<Vec<usize>> {
    let mut seen = vec![false; board.cell_count()];
    let mut out = Vec::new();
    for start in 0..board.cell_count() {
        if seen[start] || !want(start) {
            continue;
        }
        let mut stack = vec![start];
        let mut group = Vec::new();
        seen[start] = true;
        while let Some(index) = stack.pop() {
            group.push(index);
            for next in board.neighbours(index) {
                if !seen[next] && want(next) {
                    seen[next] = true;
                    stack.push(next);
                }
            }
        }
        group.sort_unstable();
        out.push(group);
    }
    out
}

pub fn validate_solution(board: &Board, answer: &AnswerModel) -> Vec<ValidationError> {
    let mut errors = Vec::new();

    for index in 0..board.cell_count() {
        match answer.get(index) {
            CellState::Unknown => errors.push(ValidationError::Incomplete(index)),
            CellState::Black => {
                let (x, y) = board.position(index);
                if board.is_clue(x, y) {
                    errors.push(ValidationError::ClueIsBlack(index));
                }
            }
            CellState::White => {}
        }
    }
    if !errors.is_empty() {
        return errors; // 未確定・矛盾があるなら以降の判定は意味を持たない
    }

    // シマ: 白マスの連結成分ごとに数字がちょうど 1 つ、大きさが一致
    for group in components(board, |i| answer.is_white(i)) {
        let clues: Vec<usize> = group
            .iter()
            .copied()
            .filter(|&i| {
                let (x, y) = board.position(i);
                board.is_clue(x, y)
            })
            .collect();
        match clues.len() {
            0 => errors.push(ValidationError::IslandWithoutClue { cells: group }),
            1 => {
                let clue_index = clues[0];
                let expected = board.clues[clue_index];
                if expected != UNKNOWN_CLUE && expected as usize != group.len() {
                    errors.push(ValidationError::IslandSizeMismatch {
                        clue_index,
                        expected,
                        actual: group.len(),
                    });
                }
            }
            n => errors.push(ValidationError::IslandWithManyClues {
                cells: group,
                clues: n,
            }),
        }
    }

    // かべ: ひとつながり
    let black = components(board, |i| answer.is_black(i));
    if black.len() > 1 {
        errors.push(ValidationError::BlackNotConnected {
            components: black.len(),
        });
    }

    // かべ: 2x2 禁止
    for y in 0..board.rows - 1 {
        for x in 0..board.cols - 1 {
            let quad = [
                board.index(x, y),
                board.index(x + 1, y),
                board.index(x, y + 1),
                board.index(x + 1, y + 1),
            ];
            if quad.iter().all(|&i| answer.is_black(i)) {
                errors.push(ValidationError::BlackPool(quad[0]));
            }
        }
    }

    errors
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::board::NO_CLUE;

    /// 2x2 の盤面。左上が 1 のシマ、残りがかべ。
    fn tiny() -> (Board, AnswerModel) {
        let board = Board::new(2, 2, vec![1, NO_CLUE, NO_CLUE, NO_CLUE]).unwrap();
        let mut answer = AnswerModel::new(&board);
        for i in 1..4 {
            answer.set(i, CellState::Black).unwrap();
        }
        (board, answer)
    }

    #[test]
    fn accepts_a_correct_solution() {
        let (board, answer) = tiny();
        assert_eq!(validate_solution(&board, &answer), vec![]);
    }

    #[test]
    fn rejects_an_island_of_the_wrong_size() {
        let board = Board::new(2, 2, vec![1, NO_CLUE, NO_CLUE, NO_CLUE]).unwrap();
        let mut answer = AnswerModel::new(&board);
        answer.set(1, CellState::White).unwrap();
        answer.set(2, CellState::Black).unwrap();
        answer.set(3, CellState::Black).unwrap();
        let errors = validate_solution(&board, &answer);
        assert!(errors
            .iter()
            .any(|e| matches!(e, ValidationError::IslandSizeMismatch { .. })));
    }

    #[test]
    fn rejects_a_2x2_pool() {
        let board = Board::new(2, 2, vec![NO_CLUE; 4]).unwrap();
        let mut answer = AnswerModel::new(&board);
        for i in 0..4 {
            answer.set(i, CellState::Black).unwrap();
        }
        let errors = validate_solution(&board, &answer);
        assert!(errors.iter().any(|e| matches!(e, ValidationError::BlackPool(0))));
    }

    #[test]
    fn rejects_disconnected_walls() {
        // 3x1: 黒 白 黒 → かべが 2 つに分かれる
        let board = Board::new(3, 1, vec![NO_CLUE, 1, NO_CLUE]).unwrap();
        let mut answer = AnswerModel::new(&board);
        answer.set(0, CellState::Black).unwrap();
        answer.set(2, CellState::Black).unwrap();
        let errors = validate_solution(&board, &answer);
        assert!(errors
            .iter()
            .any(|e| matches!(e, ValidationError::BlackNotConnected { components: 2 })));
    }

    #[test]
    fn rejects_an_island_without_a_clue() {
        let board = Board::new(3, 1, vec![NO_CLUE, NO_CLUE, NO_CLUE]).unwrap();
        let mut answer = AnswerModel::new(&board);
        answer.set(0, CellState::White).unwrap();
        answer.set(1, CellState::Black).unwrap();
        answer.set(2, CellState::Black).unwrap();
        let errors = validate_solution(&board, &answer);
        assert!(errors
            .iter()
            .any(|e| matches!(e, ValidationError::IslandWithoutClue { .. })));
    }
}
