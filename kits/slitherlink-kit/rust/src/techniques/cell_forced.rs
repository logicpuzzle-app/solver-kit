// 移植元: SlitherSolver.Field.numberSolve

use crate::answer_methods::{merge_status, AnswerMethods};
use crate::engine::EdgeState;
use crate::reasons::CELL_FORCED;
use crate::status::Status;

pub fn cell_forced(answer: &mut AnswerMethods<'_>) -> Status {
    let mut result = Status::Stopped;
    for y in 0..answer.board.rows {
        for x in 0..answer.board.cols {
            let clue = answer.board.clue(x, y);
            if clue < 0 {
                continue;
            }
            let edges = answer.board.cell_edges(x, y);
            let lines = edges
                .iter()
                .filter(|&&edge| answer.edge(edge) == EdgeState::Line)
                .count();
            let crosses = edges
                .iter()
                .filter(|&&edge| answer.edge(edge) == EdgeState::Cross)
                .count();
            if lines > clue as usize || crosses > 4 - clue as usize {
                return Status::Broken;
            }
            if crosses == 4 - clue as usize {
                for edge in edges {
                    if answer.edge(edge) == EdgeState::Unknown {
                        result = merge_status(result, answer.set_line(edge, CELL_FORCED));
                    }
                }
            }
        }
    }
    result
}
