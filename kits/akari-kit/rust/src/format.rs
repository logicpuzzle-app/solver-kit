//! 盤面と解答の文字表示。CLI と、手詰まり盤面の目視確認に使う。

use crate::answer_model::AnswerModel;
use crate::board::{Board, OPEN, WALL};

/// 問題だけの表示。`.` = 白マス、`#` = 数字なしのかべ、数字 = そのまま。
pub fn format_board(board: &Board) -> String {
    let mut out = String::new();
    for y in 0..board.rows {
        for x in 0..board.cols {
            if x > 0 {
                out.push(' ');
            }
            out.push_str(&match board.at(board.index(x, y)) {
                OPEN => ".".to_string(),
                WALL => "#".to_string(),
                n => n.to_string(),
            });
        }
        out.push('\n');
    }
    out
}

/// 解答つきの表示。`*` = 照明、`+` = 照明を置かないと決まった白マス、`.` = 未確定。
pub fn format_answer(board: &Board, answer: &AnswerModel) -> String {
    let mut out = String::new();
    for y in 0..board.rows {
        for x in 0..board.cols {
            let index = board.index(x, y);
            if x > 0 {
                out.push(' ');
            }
            out.push_str(&match board.at(index) {
                WALL => "#".to_string(),
                n if n >= 0 => n.to_string(),
                _ if answer.is_lamp(index) => "*".to_string(),
                _ if answer.is_empty(index) => "+".to_string(),
                _ => ".".to_string(),
            });
        }
        out.push('\n');
    }
    out
}
