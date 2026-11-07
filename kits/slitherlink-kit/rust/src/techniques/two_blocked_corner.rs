// 新規手筋: DESIGN_JA.md の two_blocked_corner

use crate::answer_methods::{merge_status, AnswerMethods};
use crate::engine::EdgeState;
use crate::reasons::TWO_BLOCKED_CORNER;
use crate::status::Status;
use crate::techniques::{far_cell_edges, outside_corner_edges, CORNERS};

pub fn two_blocked_corner(answer: &mut AnswerMethods<'_>) -> Status {
    let mut result = Status::Stopped;
    for y in 0..answer.board.rows {
        for x in 0..answer.board.cols {
            if answer.board.clue(x, y) != 2 {
                continue;
            }
            for corner in CORNERS {
                if !outside_corner_edges(answer.board, x, y, corner)
                    .into_iter()
                    .all(|edge| answer.edge(edge) == EdgeState::Cross)
                {
                    continue;
                }
                // 塞がれた隅側2辺は同時に使うか使わない。数字2なので、
                // 対角側2辺も同じ状態になり、一方の確定を他方へ移せる。
                let far = far_cell_edges(answer.board, x, y, corner);
                match (answer.edge(far[0]), answer.edge(far[1])) {
                    (EdgeState::Line, EdgeState::Cross)
                    | (EdgeState::Cross, EdgeState::Line) => {
                        return Status::Broken;
                    }
                    (known, EdgeState::Unknown) if known != EdgeState::Unknown => {
                        result = merge_status(
                            result,
                            answer.set_edge(far[1], known, TWO_BLOCKED_CORNER),
                        );
                    }
                    (EdgeState::Unknown, known) if known != EdgeState::Unknown => {
                        result = merge_status(
                            result,
                            answer.set_edge(far[0], known, TWO_BLOCKED_CORNER),
                        );
                    }
                    _ => {}
                }
                if result == Status::Broken {
                    return result;
                }
            }
        }
    }
    result
}
