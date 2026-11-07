//! かべの行き先(カタログ C)。`white_link` のかべ版。
//!
//! かべは最後にひとつながりになるので、すべてのかべマスは同じ連結成分に入る。
//! 「かべ ∪ 未確定」で連結成分を取り、既存のかべを 1 つも含まない成分の未確定マスは、
//! かべにしたところで本体と合流できない。よって白。
//!
//! `wall_cut` は「そこを白にすると分断される → かべ」と逆向きを見ており、
//! 1 マスずつ全盤を洗い直すので重い。こちらは成分を 1 回数えるだけで済む。
//!
//! 実測ではこれが仮置きの主な用途だった。盤面の隅で「白に囲まれた 1 マス」が
//! 残るとき、人間は迷わず白と判断する。それを言語化したもの。

use crate::answer_methods::{merge_status, AnswerMethods};
use crate::reasons::WALL_STRANDED;
use crate::status::Status;

pub fn wall_reach(answer: &mut AnswerMethods<'_>) -> Status {
    let board = answer.board;
    let count = board.cell_count();

    // 「かべ ∪ 未確定」の連結成分。白は通れない。
    let mut component = vec![usize::MAX; count];
    let mut has_black = Vec::new();
    for start in 0..count {
        if answer.answer.is_white(start) || component[start] != usize::MAX {
            continue;
        }
        let id = has_black.len();
        has_black.push(false);
        let mut stack = vec![start];
        component[start] = id;
        while let Some(index) = stack.pop() {
            if answer.answer.is_black(index) {
                has_black[id] = true;
            }
            for n in board.neighbours(index) {
                if component[n] == usize::MAX && !answer.answer.is_white(n) {
                    component[n] = id;
                    stack.push(n);
                }
            }
        }
    }

    let black_components = has_black.iter().filter(|&&b| b).count();
    if black_components == 0 {
        return Status::Stopped; // まだかべが 1 マスもない
    }
    if black_components > 1 {
        return Status::Broken; // かべが白で分断されていて、もう繋がらない
    }

    let mut result = Status::Stopped;
    for index in 0..count {
        if !answer.answer.is_unknown(index) || has_black[component[index]] {
            continue;
        }
        result = merge_status(result, answer.set_white(index, WALL_STRANDED));
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
    use crate::board::{Board, NO_CLUE};

    #[test]
    fn a_cell_walled_off_by_white_cannot_be_wall() {
        // 1x4: [.][白][.][かべ] — 左端はかべにすると孤立するので白
        let board = Board::new(4, 1, vec![NO_CLUE, NO_CLUE, NO_CLUE, NO_CLUE]).unwrap();
        let mut answer = AnswerModel::new(&board);
        answer.set(1, CellState::White).unwrap();
        answer.set(3, CellState::Black).unwrap();
        let mut methods = AnswerMethods::new(&board, &mut answer, None);
        assert_eq!(wall_reach(&mut methods), Status::Advanced);
        assert!(answer.is_white(0));
    }

    #[test]
    fn walls_split_by_white_are_a_contradiction() {
        // 1x3: [かべ][白][かべ] — もう繋がらない
        let board = Board::new(3, 1, vec![NO_CLUE, NO_CLUE, NO_CLUE]).unwrap();
        let mut answer = AnswerModel::new(&board);
        answer.set(0, CellState::Black).unwrap();
        answer.set(1, CellState::White).unwrap();
        answer.set(2, CellState::Black).unwrap();
        let mut methods = AnswerMethods::new(&board, &mut answer, None);
        assert_eq!(wall_reach(&mut methods), Status::Broken);
    }

    #[test]
    fn nothing_to_say_before_any_wall_exists() {
        let board = Board::new(3, 1, vec![NO_CLUE, NO_CLUE, NO_CLUE]).unwrap();
        let mut answer = AnswerModel::new(&board);
        let mut methods = AnswerMethods::new(&board, &mut answer, None);
        assert_eq!(wall_reach(&mut methods), Status::Stopped);
    }
}
