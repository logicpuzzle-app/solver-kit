//! 盤面と解答のテキスト表現。

use crate::answer_model::{AnswerModel, CellState};
use crate::board::{Board, NO_CLUE, UNKNOWN_CLUE};

/// 問題だけを描く。`.` は数字なし。
pub fn format_board(board: &Board) -> String {
    let mut out = String::new();
    for y in 0..board.rows {
        for x in 0..board.cols {
            if x > 0 {
                out.push(' ');
            }
            out.push_str(&match board.clue(x, y) {
                NO_CLUE => ".".to_string(),
                UNKNOWN_CLUE => "?".to_string(),
                n => n.to_string(),
            });
        }
        out.push('\n');
    }
    out
}

/// 解答を描く。`#` がかべ、`.` が未確定、数字とその他の白は `+`。
pub fn format_answer(board: &Board, answer: &AnswerModel) -> String {
    let mut out = String::new();
    for y in 0..board.rows {
        for x in 0..board.cols {
            if x > 0 {
                out.push(' ');
            }
            let index = board.index(x, y);
            out.push_str(&match answer.get(index) {
                CellState::Black => "#".to_string(),
                CellState::Unknown => ".".to_string(),
                CellState::White => match board.clue(x, y) {
                    NO_CLUE => "+".to_string(),
                    UNKNOWN_CLUE => "?".to_string(),
                    n => n.to_string(),
                },
            });
        }
        out.push('\n');
    }
    out
}
