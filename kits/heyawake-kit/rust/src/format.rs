//! 部屋境界を含む盤面と解答のテキスト表現。

use crate::answer_model::AnswerModel;
use crate::board::Board;

fn render(board: &Board, answer: Option<&AnswerModel>) -> String {
    let mut out = String::new();
    for y in 0..board.rows {
        for x in 0..board.cols {
            out.push('+');
            let border = y == 0 || board.has_horizontal_border(x, y - 1);
            out.push_str(if border { "----" } else { "    " });
        }
        out.push_str("+\n");

        for x in 0..board.cols {
            if x == 0 || board.has_vertical_border(x - 1, y) {
                out.push('|');
            } else {
                out.push(' ');
            }
            let index = board.index(x, y);
            let room = board.room(board.room_id(index));
            let clue = (room.cells[0] == index)
                .then_some(room.clue)
                .flatten()
                .filter(|&value| value >= 0)
                .map(|value| value.to_string())
                .unwrap_or_default();
            let token = if let Some(answer) = answer {
                let state = if answer.is_black(index) {
                    '#'
                } else if answer.is_white(index) {
                    '+'
                } else {
                    '.'
                };
                format!("{state}{clue}")
            } else if clue.is_empty() {
                ".".to_string()
            } else {
                clue
            };
            out.push_str(&format!("{token:^4}"));
        }
        out.push_str("|\n");
    }
    for _ in 0..board.cols {
        out.push_str("+----");
    }
    out.push_str("+\n");
    out
}

/// 問題だけを描く。数字は部屋の左上マス、`.` は数字なし。
pub fn format_board(board: &Board) -> String {
    render(board, None)
}

/// `#` は黒、`+` は白、`.` は未確定。数字はその部屋の左上マスに添える。
pub fn format_answer(board: &Board, answer: &AnswerModel) -> String {
    render(board, Some(answer))
}
