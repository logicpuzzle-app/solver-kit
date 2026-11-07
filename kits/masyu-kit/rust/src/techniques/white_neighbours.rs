//! 白丸の隣の曲がり。
//!
//! 白丸を直進した線は、その前後どちらかのマスで曲がる。
//!
//! - 直進の向きが確定した白丸: 片側の隣で曲がれないと決まったら、
//!   反対側の隣で曲がる(=その先へ直進する辺は ×)。両方なら矛盾。
//! - 向きが未確定の白丸: ある向きに直進すると両隣とも曲がれないなら、
//!   その向き自体が不可能なので、もう片方の向きに確定する。
//!
//! 「隣が白丸なら、そこでは曲がれない」(白丸の上で線は直進する)を含むので、
//! 白丸が 3 つ以上並んだら全部垂直に横断、もここから出る。

use crate::answer_methods::{merge_status, AnswerMethods};
use crate::answer_model::{AnswerModel, EdgeState};
use crate::board::{opposite, Board, DOWN, NO_CELL, NO_EDGE, RIGHT, WHITE};
use crate::reasons::WHITE_NEIGHBOURS;
use crate::status::Status;

/// 白丸から dir 方向に抜けた隣マスで、線が「曲がれない」ことが確定しているか。
/// 曲がれない = 隣が盤外 / 隣も白丸(直進しかできない) /
/// その先へ直進する辺が既に線 / 垂直の辺が全部ふさがっている。
/// 隣が盤外のときは直進も曲がりもできない(その向き自体が不可能)ので、
/// 呼び出し側は直進可能性を先に確かめること。
fn turn_impossible(board: &Board, model: &AnswerModel, cell: usize, dir: usize) -> bool {
    let next = board.neighbour(cell, dir);
    if next == NO_CELL {
        return true;
    }
    if board.at(next) == WHITE {
        return true;
    }
    let ahead = board.incident(next)[dir];
    if ahead != NO_EDGE && model.is_line(ahead) {
        return true;
    }
    [dir ^ 1, opposite(dir ^ 1)].iter().all(|&d| {
        let e = board.incident(next)[d];
        e == NO_EDGE || model.is_bar(e)
    })
}

/// axis 方向へまっすぐ通れる余地が残っているか(白丸用)。
fn straight_possible(board: &Board, model: &AnswerModel, cell: usize, axis: usize) -> bool {
    let e1 = board.incident(cell)[axis];
    let e2 = board.incident(cell)[opposite(axis)];
    if e1 == NO_EDGE || e2 == NO_EDGE || model.is_bar(e1) || model.is_bar(e2) {
        return false;
    }
    ![axis ^ 1, opposite(axis ^ 1)].iter().any(|&d| {
        let e = board.incident(cell)[d];
        e != NO_EDGE && model.is_line(e)
    })
}

pub fn white_neighbours(answer: &mut AnswerMethods<'_>) -> Status {
    let board = answer.board;
    let mut forced: Vec<(usize, EdgeState)> = Vec::new();

    for &(cell, pearl) in board.pearls() {
        if pearl != WHITE {
            continue;
        }
        let fixed_axis = if answer.answer.is_line_at(board, cell, RIGHT)
            || answer.answer.is_line_at(board, cell, opposite(RIGHT))
        {
            Some(RIGHT)
        } else if answer.answer.is_line_at(board, cell, DOWN)
            || answer.answer.is_line_at(board, cell, opposite(DOWN))
        {
            Some(DOWN)
        } else {
            None
        };

        match fixed_axis {
            Some(axis) => {
                let d1 = axis;
                let d2 = opposite(axis);
                match (
                    turn_impossible(board, answer.answer, cell, d1),
                    turn_impossible(board, answer.answer, cell, d2),
                ) {
                    (true, true) => return Status::Broken,
                    (true, false) => {
                        let next = board.neighbour(cell, d2);
                        let ahead = board.incident(next)[d2];
                        if ahead != NO_EDGE {
                            forced.push((ahead, EdgeState::Bar));
                        }
                    }
                    (false, true) => {
                        let next = board.neighbour(cell, d1);
                        let ahead = board.incident(next)[d1];
                        if ahead != NO_EDGE {
                            forced.push((ahead, EdgeState::Bar));
                        }
                    }
                    (false, false) => {}
                }
            }
            None => {
                // 向きが未確定でも「その向きでは両隣とも曲がれない」なら
                // その向きを消せる。
                let viable = |axis: usize| {
                    straight_possible(board, answer.answer, cell, axis)
                        && !(turn_impossible(board, answer.answer, cell, axis)
                            && turn_impossible(board, answer.answer, cell, opposite(axis)))
                };
                match (viable(RIGHT), viable(DOWN)) {
                    (false, false) => return Status::Broken,
                    (true, false) => {
                        for dir in [RIGHT, opposite(RIGHT)] {
                            forced.push((board.incident(cell)[dir], EdgeState::Line));
                        }
                    }
                    (false, true) => {
                        for dir in [DOWN, opposite(DOWN)] {
                            forced.push((board.incident(cell)[dir], EdgeState::Line));
                        }
                    }
                    (true, true) => {}
                }
            }
        }
    }

    let mut result = Status::Stopped;
    for (edge, state) in forced {
        result = merge_status(result, answer.set(edge, state, WHITE_NEIGHBOURS));
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

    #[test]
    fn three_whites_in_a_row_are_crossed_vertically() {
        // 盤の中程に白丸 3 連。横に直進すると隣の白丸で曲がれないので、
        // 3 つとも縦の横断に確定する。
        let board = Board::new(6, 5, {
            let mut cells = vec![0; 30];
            cells[13] = WHITE;
            cells[14] = WHITE;
            cells[15] = WHITE;
            cells
        })
        .unwrap();
        let mut model = AnswerModel::new(&board);
        // 中央の白丸が縦になり、次数(×)を挟んで両端の白丸も縦になる。
        for _ in 0..4 {
            let mut answer = AnswerMethods::new(&board, &mut model, None);
            let _ = white_neighbours(&mut answer);
            let mut answer = AnswerMethods::new(&board, &mut model, None);
            let _ = crate::techniques::degree::degree(&mut answer);
        }
        for cell in [13, 14, 15] {
            assert!(model.is_line_at(&board, cell, crate::board::UP));
            assert!(model.is_line_at(&board, cell, DOWN));
        }
    }

    #[test]
    fn a_forced_turn_bars_the_far_edge() {
        let board = Board::new(5, 4, {
            let mut cells = vec![0; 20];
            cells[2] = WHITE;
            cells
        })
        .unwrap();
        let mut model = AnswerModel::new(&board);
        // 白丸の直進(辺1,2)と、左隣(マス1)の先(辺0)を線に。
        for e in [1, 2, 0] {
            model.set(&board, e, EdgeState::Line).unwrap();
        }
        let mut answer = AnswerMethods::new(&board, &mut model, None);
        assert_eq!(white_neighbours(&mut answer), Status::Advanced);
        // 左で曲がれない → 右隣(マス3)で曲がる → その先(辺3)は ×。
        assert!(model.is_bar(3));
    }

    #[test]
    fn two_whites_on_the_border_stop_after_the_pair() {
        // 上段の白丸 2 連: 横に直進が確定したら、並びのすぐ外で曲がる。
        let board = Board::new(6, 4, {
            let mut cells = vec![0; 24];
            cells[2] = WHITE;
            cells[3] = WHITE;
            cells
        })
        .unwrap();
        let mut model = AnswerModel::new(&board);
        for e in [1, 2, 3] {
            // マス1..4 を横断する線(白丸 2 つの直進ぶん)。
            model.set(&board, e, EdgeState::Line).unwrap();
        }
        let mut answer = AnswerMethods::new(&board, &mut model, None);
        assert_eq!(white_neighbours(&mut answer), Status::Advanced);
        // マス2 から見て右隣(マス3)は白丸なので曲がれない → 左隣(マス1)で
        // 曲がる → その先(辺0)は ×。マス3 側も対称に辺4が ×。
        assert!(model.is_bar(0));
        assert!(model.is_bar(4));
    }
}
