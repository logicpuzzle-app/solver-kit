// 新規手筋: DESIGN_JA.md の three_diagonal

use crate::answer_methods::{merge_status, AnswerMethods};
use crate::reasons::THREE_DIAGONAL;
use crate::status::Status;
use crate::techniques::{far_cell_edges, Corner};

pub fn three_diagonal(answer: &mut AnswerMethods<'_>) -> Status {
    let mut result = Status::Stopped;
    for y in 0..answer.board.rows.saturating_sub(1) {
        for x in 0..answer.board.cols.saturating_sub(1) {
            if answer.board.clue(x, y) == 3
                && answer.board.clue(x + 1, y + 1) == 3
            {
                // 一方の遠い辺を Cross にすると、共有頂点側2辺が Line になり、
                // 他方の3に Cross を2本強制してしまう。従って遠い4辺は Line。
                for edge in far_cell_edges(
                    answer.board,
                    x,
                    y,
                    Corner::BottomRight,
                )
                .into_iter()
                .chain(far_cell_edges(
                    answer.board,
                    x + 1,
                    y + 1,
                    Corner::TopLeft,
                ))
                {
                    result = merge_status(
                        result,
                        answer.set_line(edge, THREE_DIAGONAL),
                    );
                }
            }
            if answer.board.clue(x + 1, y) == 3
                && answer.board.clue(x, y + 1) == 3
            {
                for edge in far_cell_edges(
                    answer.board,
                    x + 1,
                    y,
                    Corner::BottomLeft,
                )
                .into_iter()
                .chain(far_cell_edges(
                    answer.board,
                    x,
                    y + 1,
                    Corner::TopRight,
                ))
                {
                    result = merge_status(
                        result,
                        answer.set_line(edge, THREE_DIAGONAL),
                    );
                }
            }
            if result == Status::Broken {
                return result;
            }
        }
    }
    result
}
