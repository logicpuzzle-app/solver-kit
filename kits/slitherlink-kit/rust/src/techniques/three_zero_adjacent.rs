// 新規手筋: DESIGN_JA.md の three_zero_adjacent

use crate::answer_methods::{merge_status, AnswerMethods};
use crate::engine::EdgeState;
use crate::reasons::THREE_ZERO_ADJACENT;
use crate::status::Status;

fn force_three(
    answer: &mut AnswerMethods<'_>,
    x: usize,
    y: usize,
    shared: usize,
) -> Status {
    // 共有辺は0によりCross。3の残り3辺はすべてLineでなければならない。
    let mut result = answer.set_cross(shared, THREE_ZERO_ADJACENT);
    for edge in answer.board.cell_edges(x, y) {
        if edge != shared && answer.edge(edge) != EdgeState::Line {
            result = merge_status(
                result,
                answer.set_line(edge, THREE_ZERO_ADJACENT),
            );
        }
    }
    result
}

pub fn three_zero_adjacent(answer: &mut AnswerMethods<'_>) -> Status {
    let mut result = Status::Stopped;
    for y in 0..answer.board.rows {
        for x in 0..answer.board.cols.saturating_sub(1) {
            let left = answer.board.clue(x, y);
            let right = answer.board.clue(x + 1, y);
            let shared = answer.board.v_id(x + 1, y);
            if left == 3 && right == 0 {
                result = merge_status(result, force_three(answer, x, y, shared));
            } else if left == 0 && right == 3 {
                result =
                    merge_status(result, force_three(answer, x + 1, y, shared));
            }
            if result == Status::Broken {
                return result;
            }
        }
    }
    for y in 0..answer.board.rows.saturating_sub(1) {
        for x in 0..answer.board.cols {
            let top = answer.board.clue(x, y);
            let bottom = answer.board.clue(x, y + 1);
            let shared = answer.board.h_id(x, y + 1);
            if top == 3 && bottom == 0 {
                result = merge_status(result, force_three(answer, x, y, shared));
            } else if top == 0 && bottom == 3 {
                result =
                    merge_status(result, force_three(answer, x, y + 1, shared));
            }
            if result == Status::Broken {
                return result;
            }
        }
    }
    result
}
