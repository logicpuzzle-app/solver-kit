// 移植元: SlitherSolver.Field.nextSolve

use crate::answer_methods::{merge_status, AnswerMethods};
use crate::engine::EdgeState;
use crate::reasons::VERTEX_DEAD;
use crate::status::Status;

pub fn vertex_dead(answer: &mut AnswerMethods<'_>) -> Status {
    let mut result = Status::Stopped;
    for y in 0..=answer.board.rows {
        for x in 0..=answer.board.cols {
            let edges = answer.board.vertex_edges(x, y);
            let lines = edges
                .iter()
                .filter(|&&edge| answer.edge(edge) == EdgeState::Line)
                .count();
            let unknown: Vec<_> = edges
                .iter()
                .copied()
                .filter(|&edge| answer.edge(edge) == EdgeState::Unknown)
                .collect();
            if lines > 2 || (lines == 1 && unknown.is_empty()) {
                return Status::Broken;
            }
            // 盤外も Cross なので「残り1辺だけ」はその頂点を使えない。
            if lines == 0 && unknown.len() == 1 {
                result = merge_status(
                    result,
                    answer.set_cross(unknown[0], VERTEX_DEAD),
                );
            }
        }
    }
    result
}
