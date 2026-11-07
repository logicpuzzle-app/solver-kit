//! 小ループ禁。
//!
//! 同じ線分の両端をつなぐ辺は、それで盤面全体が完成しないかぎり ×。
//! (完成する = つないだあと、線の端点が他になく、全部の丸を線が通る。)

use crate::answer_methods::{merge_status, AnswerMethods};
use crate::answer_model::EdgeState;
use crate::reasons::SMALL_LOOP_BAN;
use crate::status::Status;

pub fn small_loop_ban(answer: &mut AnswerMethods<'_>) -> Status {
    let board = answer.board;
    let mut forced: Vec<usize> = Vec::new();

    for edge in 0..board.edge_count() {
        if !answer.answer.is_unknown(edge) {
            continue;
        }
        let [a, b] = board.edge_cells(edge);
        // 両端が同じ線分の端点(次数 1)のときだけ閉じる可能性がある。
        if answer.answer.line_count(a) != 1 || answer.answer.line_count(b) != 1 {
            continue;
        }
        if !answer.answer.same_segment(a, b) {
            continue;
        }
        // つなぐと閉路。完成しないなら ×。
        let closes_everything = (0..board.cell_count())
            .all(|c| c == a || c == b || answer.answer.line_count(c) != 1)
            && board
                .pearls()
                .iter()
                .all(|&(c, _)| answer.answer.line_count(c) == 2 || c == a || c == b);
        if !closes_everything {
            forced.push(edge);
        }
    }

    let mut result = Status::Stopped;
    for edge in forced {
        result = merge_status(result, answer.set(edge, EdgeState::Bar, SMALL_LOOP_BAN));
        if result == Status::Broken {
            return result;
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::answer_methods::AnswerMethods;
    use crate::answer_model::AnswerModel;
    use crate::board::Board;

    #[test]
    fn a_premature_closure_is_barred() {
        // 3x3、外周を 7 辺引いて残り 1 辺。中央の丸が未通過なので閉じられない。
        let board = Board::new(3, 3, {
            let mut cells = vec![0; 9];
            cells[4] = crate::board::WHITE;
            cells
        })
        .unwrap();
        let mut model = AnswerModel::new(&board);
        for e in [0, 1, 4, 5, 6, 8, 9] {
            model.set(&board, e, EdgeState::Line).unwrap();
        }
        let mut answer = AnswerMethods::new(&board, &mut model, None);
        assert_eq!(small_loop_ban(&mut answer), Status::Advanced);
        assert!(model.is_bar(11)); // 最後の辺(5-8)は×。
    }

    #[test]
    fn the_final_closure_is_allowed() {
        // 丸なし 3x3 の外周 7 辺 → 最後の 1 辺は完成をつくるので触らない。
        let board = Board::new(3, 3, vec![0; 9]).unwrap();
        let mut model = AnswerModel::new(&board);
        for e in [0, 1, 4, 5, 6, 8, 9] {
            model.set(&board, e, EdgeState::Line).unwrap();
        }
        let mut answer = AnswerMethods::new(&board, &mut model, None);
        assert_eq!(small_loop_ban(&mut answer), Status::Stopped);
        assert!(model.is_unknown(11));
    }
}
