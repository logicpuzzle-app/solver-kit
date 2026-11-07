//! 盤面と解答のテキスト表示。
//!
//! 解答は 1 マスを 2x2 文字で描く(右端・下端は 1 文字)。
//! マス文字: `.`=空 / `o`=白丸 / `*`=黒丸。
//! 辺文字: `-` `|`=線 / `x`=× / ` `=未定。

use crate::answer_model::AnswerModel;
use crate::board::{Board, BLACK, NO_EDGE, RIGHT, DOWN, WHITE};

fn cell_char(board: &Board, index: usize) -> char {
    match board.at(index) {
        WHITE => 'o',
        BLACK => '*',
        _ => '.',
    }
}

pub fn format_board(board: &Board) -> String {
    let mut out = String::new();
    for y in 0..board.rows {
        for x in 0..board.cols {
            out.push(cell_char(board, board.index(x, y)));
        }
        out.push('\n');
    }
    out
}

fn edge_char(answer: &AnswerModel, edge: usize, line: char) -> char {
    if edge == NO_EDGE {
        ' '
    } else if answer.is_line(edge) {
        line
    } else if answer.is_bar(edge) {
        'x'
    } else {
        // 未定。スペースにすると行頭がスペースで始まり、measure.py の
        // 「2 スペース始まり = 手筋カウント行」の規約とぶつかる。
        '.'
    }
}

pub fn format_answer(board: &Board, answer: &AnswerModel) -> String {
    let mut out = String::new();
    for y in 0..board.rows {
        for x in 0..board.cols {
            let i = board.index(x, y);
            out.push(cell_char(board, i));
            if x + 1 < board.cols {
                out.push(edge_char(answer, board.incident(i)[RIGHT], '-'));
            }
        }
        out.push('\n');
        if y + 1 < board.rows {
            for x in 0..board.cols {
                let i = board.index(x, y);
                out.push(edge_char(answer, board.incident(i)[DOWN], '|'));
                if x + 1 < board.cols {
                    out.push(' ');
                }
            }
            out.push('\n');
        }
    }
    out
}
