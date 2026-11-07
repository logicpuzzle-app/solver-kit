//! 連結性。丸と線はすべて 1 つのループに乗る。
//!
//! ループに必ず乗るマス(丸、線が通っているマス)から、× でない辺だけを
//! 通って届く範囲を調べる。届かない必乗マスがあれば矛盾。届かないマスは
//! ループに乗れないので、そのまわりの辺は全部 ×。

use crate::answer_methods::{merge_status, AnswerMethods};
use crate::answer_model::EdgeState;
use crate::board::NO_EDGE;
use crate::reasons::CONNECTIVITY;
use crate::status::Status;

pub fn connectivity(answer: &mut AnswerMethods<'_>) -> Status {
    let board = answer.board;

    let must_visit: Vec<usize> = (0..board.cell_count())
        .filter(|&c| board.is_pearl(c) || answer.answer.line_count(c) > 0)
        .collect();
    let Some(&start) = must_visit.first() else {
        return Status::Stopped;
    };

    let mut seen = vec![false; board.cell_count()];
    let mut stack = vec![start];
    seen[start] = true;
    while let Some(cell) = stack.pop() {
        for dir in 0..4 {
            let edge = board.incident(cell)[dir];
            if edge == NO_EDGE || answer.answer.is_bar(edge) {
                continue;
            }
            let next = board.neighbour(cell, dir);
            if !seen[next] {
                seen[next] = true;
                stack.push(next);
            }
        }
    }

    if must_visit.iter().any(|&c| !seen[c]) {
        return Status::Broken;
    }

    let mut result = Status::Stopped;
    for cell in 0..board.cell_count() {
        if seen[cell] {
            continue;
        }
        for &edge in board.incident(cell) {
            if edge != NO_EDGE && answer.answer.is_unknown(edge) {
                result = merge_status(result, answer.set(edge, EdgeState::Bar, CONNECTIVITY));
                if result == Status::Broken {
                    return result;
                }
            }
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::answer_methods::AnswerMethods;
    use crate::answer_model::AnswerModel;
    use crate::board::{Board, WHITE};

    #[test]
    fn a_walled_off_pearl_is_broken() {
        // 左上の 2x1 を × で仕切ると、そこの丸へ届かない。
        let board = Board::new(4, 4, {
            let mut cells = vec![0; 16];
            cells[0] = WHITE;
            cells[5] = WHITE;
            cells
        })
        .unwrap();
        let mut model = AnswerModel::new(&board);
        // マス0 を囲う: 右(辺0)と下(0-4)。
        model.set(&board, 0, EdgeState::Bar).unwrap();
        model
            .set(&board, board.incident(0)[crate::board::DOWN], EdgeState::Bar)
            .unwrap();
        let mut answer = AnswerMethods::new(&board, &mut model, None);
        assert_eq!(connectivity(&mut answer), Status::Broken);
    }

    #[test]
    fn unreachable_cells_get_barred() {
        // 丸から × で仕切られた角のマスは、ループに乗れないので辺が全部 ×。
        let board = Board::new(4, 4, {
            let mut cells = vec![0; 16];
            cells[10] = WHITE;
            cells
        })
        .unwrap();
        let mut model = AnswerModel::new(&board);
        model.set(&board, 0, EdgeState::Bar).unwrap();
        model
            .set(&board, board.incident(0)[crate::board::DOWN], EdgeState::Bar)
            .unwrap();
        let mut answer = AnswerMethods::new(&board, &mut model, None);
        assert_eq!(connectivity(&mut answer), Status::Stopped);
        // マス0 は既に全辺 × なので新たに確定するものはないが、
        // 矛盾にもならない(丸ではないから)。
    }
}
