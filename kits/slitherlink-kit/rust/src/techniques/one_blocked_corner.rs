// 新規手筋: DESIGN_JA.md の one_blocked_corner

use crate::answer_methods::{merge_status, AnswerMethods};
use crate::engine::EdgeState;
use crate::reasons::ONE_BLOCKED_CORNER;
use crate::status::Status;
use crate::techniques::{corner_cell_edges, outside_corner_edges, CORNERS};

pub fn one_blocked_corner(answer: &mut AnswerMethods<'_>) -> Status {
    let mut result = Status::Stopped;
    for y in 0..answer.board.rows {
        for x in 0..answer.board.cols {
            if answer.board.clue(x, y) != 1 {
                continue;
            }
            for corner in CORNERS {
                if !outside_corner_edges(answer.board, x, y, corner)
                    .into_iter()
                    .all(|edge| answer.edge(edge) == EdgeState::Cross)
                {
                    continue;
                }
                // 外側が塞がれた頂点ではセル側2辺は同時に使うか使わない。
                // 1には2本は多すぎるため、両方Crossに限られる。
                for edge in corner_cell_edges(answer.board, x, y, corner) {
                    result = merge_status(
                        result,
                        answer.set_cross(edge, ONE_BLOCKED_CORNER),
                    );
                }
                if result == Status::Broken {
                    return result;
                }
            }
        }
    }
    result
}
