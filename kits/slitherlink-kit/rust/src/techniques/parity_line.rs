// 移植元: SlitherSolver.Field.oddSolve（未確定1本の場合まで拡張）

use crate::answer_methods::{merge_status, AnswerMethods};
use crate::engine::EdgeState;
use crate::reasons::PARITY_LINE;
use crate::status::Status;

fn apply_cut(answer: &mut AnswerMethods<'_>, edges: &[usize]) -> Status {
    let line_count = edges
        .iter()
        .filter(|&&edge| answer.edge(edge) == EdgeState::Line)
        .count();
    let unknown: Vec<_> = edges
        .iter()
        .copied()
        .filter(|&edge| answer.edge(edge) == EdgeState::Unknown)
        .collect();
    match unknown.as_slice() {
        [] if line_count % 2 == 1 => Status::Broken,
        [edge] => {
            // 閉曲線と盤面を貫く直線の交点数は偶数。既存Lineが奇数なら
            // 最後の1本はLine、偶数ならCrossでなければならない。
            let state = if line_count % 2 == 1 {
                EdgeState::Line
            } else {
                EdgeState::Cross
            };
            answer.set_edge(*edge, state, PARITY_LINE)
        }
        _ => Status::Stopped,
    }
}

pub fn parity_line(answer: &mut AnswerMethods<'_>) -> Status {
    let mut result = Status::Stopped;
    for k in 1..=answer.board.cols {
        let edges: Vec<_> = (0..=answer.board.rows)
            .map(|y| answer.board.h_id(k - 1, y))
            .collect();
        result = merge_status(result, apply_cut(answer, &edges));
        if result == Status::Broken {
            return result;
        }
    }
    for k in 1..=answer.board.rows {
        let edges: Vec<_> = (0..=answer.board.cols)
            .map(|x| answer.board.v_id(x, k - 1))
            .collect();
        result = merge_status(result, apply_cut(answer, &edges));
        if result == Status::Broken {
            return result;
        }
    }
    result
}
