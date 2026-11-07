// 移植元: SlitherSolver.Field.nextSolve

use crate::answer_methods::{merge_status, AnswerMethods};
use crate::engine::EdgeState;
use crate::reasons::VERTEX_CLOSE;
use crate::status::Status;

pub fn vertex_close(answer: &mut AnswerMethods<'_>) -> Status {
    let mut result = Status::Stopped;
    for y in 0..=answer.board.rows {
        for x in 0..=answer.board.cols {
            let edges = answer.board.vertex_edges(x, y);
            let lines = edges
                .iter()
                .filter(|&&edge| answer.edge(edge) == EdgeState::Line)
                .count();
            let unknown = edges
                .iter()
                .filter(|&&edge| answer.edge(edge) == EdgeState::Unknown)
                .count();
            if lines > 2 || (lines == 1 && unknown == 0) {
                return Status::Broken;
            }
            if lines == 2 {
                for edge in edges {
                    if answer.edge(edge) == EdgeState::Unknown {
                        result = merge_status(result, answer.set_cross(edge, VERTEX_CLOSE));
                    }
                }
            }
        }
    }
    result
}
