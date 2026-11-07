//! 丸の基本。
//!
//! 白丸: 縦か横にまっすぐ通る。通れない向きが決まったらもう片方に確定
//! (盤端の白丸は盤端に平行に直進、もその一例)。
//! 黒丸: ここで曲がり、縦横 1 本ずつの腕が丸の隣でもう 1 マス直進する。
//! 腕を出せない側が決まったら反対側に確定(角・壁際の黒丸もその一例)。

use crate::answer_methods::{merge_status, AnswerMethods};
use crate::answer_model::{AnswerModel, EdgeState};
use crate::board::{opposite, Board, BLACK, DOWN, NO_EDGE, RIGHT, WHITE};
use crate::reasons::PEARL_BASIC;
use crate::status::Status;

/// axis 方向(とその反対)へまっすぐ通れる余地が残っているか。
fn straight_possible(board: &Board, model: &AnswerModel, cell: usize, axis: usize) -> bool {
    let e1 = board.incident(cell)[axis];
    let e2 = board.incident(cell)[opposite(axis)];
    if e1 == NO_EDGE || e2 == NO_EDGE || model.is_bar(e1) || model.is_bar(e2) {
        return false;
    }
    // 垂直方向に既に線が入っていたら直進できない。
    ![axis ^ 1, opposite(axis ^ 1)].iter().any(|&d| {
        let e = board.incident(cell)[d];
        e != NO_EDGE && model.is_line(e)
    })
}

/// dir 方向の腕(丸から 2 マスぶんの直進)がまだ可能か。
/// 腕の中間マスが黒丸だと、そこで直進することになるので張れない
/// (黒丸どうしが隣接したら間の辺は ×、もここから出る)。
fn arm_possible(board: &Board, model: &AnswerModel, cell: usize, dir: usize) -> bool {
    let e1 = board.incident(cell)[dir];
    if e1 == NO_EDGE || model.is_bar(e1) {
        return false;
    }
    let mid = board.neighbour(cell, dir);
    if board.at(mid) == BLACK {
        return false;
    }
    let e2 = board.incident(mid)[dir];
    e2 != NO_EDGE && !model.is_bar(e2)
}

fn forced_straight(board: &Board, cell: usize, axis: usize, out: &mut Vec<(usize, EdgeState)>) {
    for dir in [axis, opposite(axis)] {
        out.push((board.incident(cell)[dir], EdgeState::Line));
    }
    for dir in [axis ^ 1, opposite(axis ^ 1)] {
        let e = board.incident(cell)[dir];
        if e != NO_EDGE {
            out.push((e, EdgeState::Bar));
        }
    }
}

fn forced_arm(board: &Board, cell: usize, dir: usize, out: &mut Vec<(usize, EdgeState)>) {
    out.push((board.incident(cell)[dir], EdgeState::Line));
    out.push((
        board.incident(board.neighbour(cell, dir))[dir],
        EdgeState::Line,
    ));
    let back = board.incident(cell)[opposite(dir)];
    if back != NO_EDGE {
        out.push((back, EdgeState::Bar));
    }
}

pub fn pearl_basic(answer: &mut AnswerMethods<'_>) -> Status {
    let board = answer.board;
    let mut forced: Vec<(usize, EdgeState)> = Vec::new();

    for &(cell, pearl) in board.pearls() {
        if pearl == WHITE {
            let horizontal = straight_possible(board, answer.answer, cell, RIGHT);
            let vertical = straight_possible(board, answer.answer, cell, DOWN);
            match (horizontal, vertical) {
                (false, false) => return Status::Broken,
                (true, false) => forced_straight(board, cell, RIGHT, &mut forced),
                (false, true) => forced_straight(board, cell, DOWN, &mut forced),
                (true, true) => {}
            }
        } else if pearl == BLACK {
            for axis in [RIGHT, DOWN] {
                let d1 = axis;
                let d2 = opposite(axis);
                // 既に線が入っている側があればその腕に確定。
                let line1 = {
                    let e = board.incident(cell)[d1];
                    e != NO_EDGE && answer.answer.is_line(e)
                };
                let line2 = {
                    let e = board.incident(cell)[d2];
                    e != NO_EDGE && answer.answer.is_line(e)
                };
                if line1 {
                    if !arm_possible(board, answer.answer, cell, d1) {
                        return Status::Broken;
                    }
                    forced_arm(board, cell, d1, &mut forced);
                    continue;
                }
                if line2 {
                    if !arm_possible(board, answer.answer, cell, d2) {
                        return Status::Broken;
                    }
                    forced_arm(board, cell, d2, &mut forced);
                    continue;
                }
                match (
                    arm_possible(board, answer.answer, cell, d1),
                    arm_possible(board, answer.answer, cell, d2),
                ) {
                    (false, false) => return Status::Broken,
                    (true, false) => forced_arm(board, cell, d1, &mut forced),
                    (false, true) => forced_arm(board, cell, d2, &mut forced),
                    (true, true) => {}
                }
            }
        }
    }

    let mut result = Status::Stopped;
    for (edge, state) in forced {
        // 同じ辺が二度出てもよい(同値なら Stopped 扱い)。食い違えば矛盾。
        let status = answer.set(edge, state, PEARL_BASIC);
        result = merge_status(result, status);
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
    fn a_white_pearl_on_the_top_row_runs_along_the_edge() {
        let board = Board::new(4, 4, vec![0, WHITE, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
            .unwrap();
        let mut model = AnswerModel::new(&board);
        let mut answer = AnswerMethods::new(&board, &mut model, None);
        assert_eq!(pearl_basic(&mut answer), Status::Advanced);
        // 上段の白丸(マス1)は横に直進(辺0,1)、下(1-5)は ×。
        assert!(model.is_line(0));
        assert!(model.is_line(1));
        assert!(model.is_bar(board.incident(1)[DOWN]));
    }

    #[test]
    fn a_black_pearl_in_a_corner_extends_both_arms() {
        let board = Board::new(4, 4, vec![BLACK, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
            .unwrap();
        let mut model = AnswerModel::new(&board);
        let mut answer = AnswerMethods::new(&board, &mut model, None);
        assert_eq!(pearl_basic(&mut answer), Status::Advanced);
        // 角の黒丸(マス0)は右と下に 2 マスずつ。
        assert!(model.is_line(board.incident(0)[RIGHT]));
        assert!(model.is_line(board.incident(1)[RIGHT]));
        assert!(model.is_line(board.incident(0)[DOWN]));
        assert!(model.is_line(board.incident(4)[DOWN]));
    }

    #[test]
    fn adjacent_black_pearls_turn_away_from_each_other() {
        // 横に隣接する黒丸は、互いの方向に腕を張れないので反対側へ。
        let board = Board::new(6, 4, {
            let mut cells = vec![0; 24];
            cells[8] = BLACK;
            cells[9] = BLACK;
            cells
        })
        .unwrap();
        let mut model = AnswerModel::new(&board);
        let mut answer = AnswerMethods::new(&board, &mut model, None);
        assert_eq!(pearl_basic(&mut answer), Status::Advanced);
        // マス8 は左へ 2 マス、マス9 は右へ 2 マス。間の辺は ×。
        assert!(model.is_line(board.incident(8)[crate::board::LEFT]));
        assert!(model.is_line(board.incident(7)[crate::board::LEFT]));
        assert!(model.is_line(board.incident(9)[RIGHT]));
        assert!(model.is_line(board.incident(10)[RIGHT]));
        assert!(model.is_bar(board.incident(8)[RIGHT]));
    }

    #[test]
    fn a_black_pearl_next_to_the_wall_cannot_face_it() {
        // 左端(x=0)の黒丸は左に腕を出せないので右へ。
        let board = Board::new(4, 4, vec![0, 0, 0, 0, BLACK, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
            .unwrap();
        let mut model = AnswerModel::new(&board);
        let mut answer = AnswerMethods::new(&board, &mut model, None);
        assert_eq!(pearl_basic(&mut answer), Status::Advanced);
        assert!(model.is_line(board.incident(4)[RIGHT]));
        assert!(model.is_line(board.incident(5)[RIGHT]));
    }
}
