// 新規手筋: DESIGN_JA.md の corner_clue

use crate::answer_methods::{merge_status, AnswerMethods};
use crate::engine::EdgeState;
use crate::reasons::CORNER_CLUE;
use crate::status::Status;
use crate::techniques::{corner_cell_edges, Corner};

pub fn corner_clue(answer: &mut AnswerMethods<'_>) -> Status {
    let corners = [
        (0, 0, Corner::TopLeft),
        (answer.board.cols - 1, 0, Corner::TopRight),
        (0, answer.board.rows - 1, Corner::BottomLeft),
        (
            answer.board.cols - 1,
            answer.board.rows - 1,
            Corner::BottomRight,
        ),
    ];
    let mut result = Status::Stopped;
    for (x, y, corner) in corners {
        let state = match answer.board.clue(x, y) {
            // 角の頂点ではセル側2辺を同時に使うか、両方使わない。
            // 1には2本は多すぎ、3には両方を使わないと残り2辺では足りない。
            1 => EdgeState::Cross,
            3 => EdgeState::Line,
            _ => continue,
        };
        for edge in corner_cell_edges(answer.board, x, y, corner) {
            result = merge_status(
                result,
                answer.set_edge(edge, state, CORNER_CLUE),
            );
        }
        if result == Status::Broken {
            return result;
        }
    }
    result
}
