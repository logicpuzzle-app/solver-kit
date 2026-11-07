// 移植元: SlitherSolver.Field.nextSolve

use crate::answer_methods::{merge_status, AnswerMethods};
use crate::engine::EdgeState;
use crate::reasons::VERTEX_EXTEND;
use crate::status::Status;

pub fn vertex_extend(answer: &mut AnswerMethods<'_>) -> Status {
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
            // 盤外方向は sdvx と同じく Cross と数えるので、角や辺上でも同じ式になる。
            if lines == 1 && unknown.len() == 1 {
                result = merge_status(
                    result,
                    answer.set_line(unknown[0], VERTEX_EXTEND),
                );
            }
        }
    }
    result
}
