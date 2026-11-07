// 新規手筋: DESIGN_JA.md の three_zero_diagonal

use crate::answer_methods::{merge_status, AnswerMethods};
use crate::reasons::THREE_ZERO_DIAGONAL;
use crate::status::Status;
use crate::techniques::{corner_cell_edges, Corner};

fn apply_pair(
    answer: &mut AnswerMethods<'_>,
    three_x: usize,
    three_y: usize,
    three_corner: Corner,
) -> Status {
    // 0側の2辺が塞がるため、共有頂点で3側の2辺は同時に使うか
    // 同時に使わないかになる。3に許されるCrossは1本なので両方Line。
    let mut result = Status::Stopped;
    for edge in corner_cell_edges(answer.board, three_x, three_y, three_corner) {
        result = merge_status(
            result,
            answer.set_line(edge, THREE_ZERO_DIAGONAL),
        );
    }
    result
}

pub fn three_zero_diagonal(answer: &mut AnswerMethods<'_>) -> Status {
    let mut result = Status::Stopped;
    for y in 0..answer.board.rows.saturating_sub(1) {
        for x in 0..answer.board.cols.saturating_sub(1) {
            let top_left = answer.board.clue(x, y);
            let top_right = answer.board.clue(x + 1, y);
            let bottom_left = answer.board.clue(x, y + 1);
            let bottom_right = answer.board.clue(x + 1, y + 1);
            if top_left == 3 && bottom_right == 0 {
                result = merge_status(
                    result,
                    apply_pair(answer, x, y, Corner::BottomRight),
                );
            }
            if top_left == 0 && bottom_right == 3 {
                result = merge_status(
                    result,
                    apply_pair(answer, x + 1, y + 1, Corner::TopLeft),
                );
            }
            if top_right == 3 && bottom_left == 0 {
                result = merge_status(
                    result,
                    apply_pair(answer, x + 1, y, Corner::BottomLeft),
                );
            }
            if top_right == 0 && bottom_left == 3 {
                result = merge_status(
                    result,
                    apply_pair(answer, x, y + 1, Corner::TopRight),
                );
            }
            if result == Status::Broken {
                return result;
            }
        }
    }
    result
}
