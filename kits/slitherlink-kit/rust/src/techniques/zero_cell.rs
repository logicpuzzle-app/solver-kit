// 新規手筋: DESIGN_JA.md の zero_cell

use crate::answer_methods::{merge_status, AnswerMethods};
use crate::engine::EdgeState;
use crate::reasons::ZERO_CELL;
use crate::status::Status;

pub fn zero_cell(answer: &mut AnswerMethods<'_>) -> Status {
    let mut result = Status::Stopped;
    for y in 0..answer.board.rows {
        for x in 0..answer.board.cols {
            if answer.board.clue(x, y) != 0 {
                continue;
            }
            // 数字0は周囲に一本も線を許さない。
            for edge in answer.board.cell_edges(x, y) {
                if answer.edge(edge) == EdgeState::Line {
                    return Status::Broken;
                }
                if answer.edge(edge) == EdgeState::Unknown {
                    result = merge_status(result, answer.set_cross(edge, ZERO_CELL));
                }
            }
        }
    }
    result
}
