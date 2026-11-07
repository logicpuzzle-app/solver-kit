// 新規手筋: DESIGN_JA.md の three_incoming

use crate::answer_methods::{merge_status, AnswerMethods};
use crate::engine::EdgeState;
use crate::reasons::THREE_INCOMING;
use crate::status::Status;
use crate::techniques::{far_cell_edges, outside_corner_edges, CORNERS};

pub fn three_incoming(answer: &mut AnswerMethods<'_>) -> Status {
    let mut result = Status::Stopped;
    for y in 0..answer.board.rows {
        for x in 0..answer.board.cols {
            if answer.board.clue(x, y) != 3 {
                continue;
            }
            for corner in CORNERS {
                let incoming = outside_corner_edges(answer.board, x, y, corner)
                    .into_iter()
                    .any(|edge| answer.edge(edge) == EdgeState::Line);
                if !incoming {
                    continue;
                }
                // 外から線が入った頂点ではセル側2辺を同時にLineにできない。
                // 3の唯一のCrossはその隅側にあるため、遠い2辺はLineになる。
                for edge in far_cell_edges(answer.board, x, y, corner) {
                    result = merge_status(
                        result,
                        answer.set_line(edge, THREE_INCOMING),
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
