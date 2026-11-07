//! Walks each arrow, splits the still-undecided cells along it into maximal runs, and
//! compares the arrow's count with the maximum number of blacks those runs can hold.
//! When they match:
//! - odd runs have every second cell forced black;
//! - even runs leave a two-way choice, registered in `black_candidates_*` so that
//!   whitening one half later forces the other, plus the "2n in n" white deductions at
//!   the ends.

use crate::answer_methods::AnswerMethods;
use crate::board::{to_id, Board};
use crate::position::{Position, DIRS};
use crate::reasons::{
    EVERY_SECOND_BLACK, TWO_N_IN_N_WHITE_FAR, TWO_N_IN_N_WHITE_NEAR,
};
use crate::status::Status;

/// The most blacks that could still sit from `from` (exclusive) to the board edge along
/// `delta`, counting the ones already placed.
///
/// Used only to bound a `?` clue. Deliberately an over-estimate — it costs each maximal
/// undecided run `ceil(len / 2)` without checking whether a neighbouring black already
/// rules the first cell out. Over-estimating here can only weaken the bound it feeds, never
/// make it claim too much.
fn max_blacks_beyond(
    board: &Board,
    answer: &AnswerMethods<'_>,
    from: Position,
    delta: Position,
) -> i32 {
    let mut x = from.x + delta.x;
    let mut y = from.y + delta.y;
    let mut placed = 0;
    let mut run = 0;
    let mut capacity = 0;
    while board.in_board(Position { x, y }) {
        let pos = Position { x, y };
        let free = !answer.has_line(pos)
            && !answer.has_black_cell(pos)
            && !answer.has_white_cell(pos)
            && !answer.is_line_edge(pos)
            && board.cell[(y * board.cols + x) as usize].qnum == -1;
        if free {
            run += 1;
        } else {
            if answer.has_black_cell(pos) {
                placed += 1;
            }
            capacity += (run + 1) / 2;
            run = 0;
        }
        x += delta.x;
        y += delta.y;
    }
    capacity += (run + 1) / 2;
    placed + capacity
}

/// Blacks already standing beyond `from`; the floor under a `?` clue's own count.
fn placed_blacks_beyond(
    board: &Board,
    answer: &AnswerMethods<'_>,
    from: Position,
    delta: Position,
) -> i32 {
    let mut x = from.x + delta.x;
    let mut y = from.y + delta.y;
    let mut placed = 0;
    while board.in_board(Position { x, y }) {
        if answer.has_black_cell(Position { x, y }) {
            placed += 1;
        }
        x += delta.x;
        y += delta.y;
    }
    placed
}

pub fn add_black_cell_with_number(answer: &mut AnswerMethods<'_>) -> Status {
    let board = answer.board;
    let mut advanced = false;
    for i in 0..board.cell.len() {
        let dir = board.cell[i].qdir;
        if dir == -1 || dir == 0 || board.cell[i].qnum == -2 {
            continue;
        }
        let delta = DIRS[dir as usize];
        let mut x = i as i32 % board.cols + delta.x;
        let mut y = i as i32 / board.cols + delta.y;
        let mut black_count = 0;
        let mut runs: Vec<Vec<Position>> = Vec::new();
        while board.in_board(Position { x, y })
            && board.cell[(y * board.cols + x) as usize].qdir != dir
        {
            let pos = Position { x, y };
            if answer.has_black_cell(pos) {
                black_count += 1;
            }
            if !answer.has_line(pos)
                && !answer.has_black_cell(pos)
                && !answer.has_white_cell(pos)
                && !answer.is_line_edge(pos)
                && board.cell[(y * board.cols + x) as usize].qnum == -1
            {
                if let Some(last) = runs.last_mut() {
                    let prev = last[last.len() - 1];
                    if prev.x + delta.x == x && prev.y + delta.y == y {
                        last.push(pos);
                    } else {
                        runs.push(vec![pos]);
                    }
                } else {
                    runs.push(vec![pos]);
                }
            }
            x += delta.x;
            y += delta.y;
        }
        let next_num = if board.in_board(Position { x, y }) {
            board.cell[(y * board.cols + x) as usize].qnum
        } else {
            0
        };
        // How many blacks lie between this arrow and the clue it runs into. An arrow counts
        // to the board edge, and the clue it runs into counts a suffix of the same ray, so
        // the count in between is this arrow's number minus that clue's.
        //
        // When that clue is a `?` its number is unknown and the difference becomes a range
        // rather than a value. Both ends are still usable: the far clue can count no fewer
        // than nothing, which caps the run at this arrow's own number, and it can count no
        // more than the blacks that could physically fit beyond it, which puts a floor
        // under the run.
        let capped = board.cell[i].qnum;
        let (low, high) = if next_num == -2 {
            (
                0.max(capped - max_blacks_beyond(board, answer, Position { x, y }, delta)),
                capped - placed_blacks_beyond(board, answer, Position { x, y }, delta),
            )
        } else {
            (capped - next_num, capped - next_num)
        };
        let capacity: i32 = runs.iter().map(|run| (run.len() as i32 + 1) / 2).sum();
        if low == capacity + black_count {
            for run in &runs {
                if run.len() % 2 == 1 {
                    for (index, &pos) in run.iter().enumerate() {
                        if index % 2 == 0 {
                            advanced |= answer.add_black_cell(pos, EVERY_SECOND_BLACK);
                        }
                    }
                }
            }
            for run in &runs {
                if run.len() % 2 != 0 {
                    continue;
                }
                for (index, &pos) in run.iter().enumerate() {
                    if index % 2 != 0 {
                        continue;
                    }
                    if delta.x == 0 {
                        answer.black_candidates_vertical.insert(to_id(Position {
                            x: pos.x,
                            y: pos.y + delta.y.min(0),
                        }));
                    } else {
                        answer.black_candidates_horizontal.insert(to_id(Position {
                            x: pos.x + delta.x.min(0),
                            y: pos.y,
                        }));
                    }
                    answer.set_line_bar(
                        pos,
                        Position {
                            x: pos.x + delta.x,
                            y: pos.y + delta.y,
                        },
                    );
                }
                let first = run[0];
                let last = run[run.len() - 1];
                let prev = Position {
                    x: first.x - delta.x,
                    y: first.y - delta.y,
                };
                let pn1 = Position {
                    x: first.x - delta.y,
                    y: first.y - delta.x,
                };
                let pn2 = Position {
                    x: first.x + delta.y,
                    y: first.y + delta.x,
                };
                if answer.forbidden(prev) {
                    if !answer.forbidden(pn1) {
                        advanced |= answer.add_white_cell(pn1, TWO_N_IN_N_WHITE_NEAR);
                    }
                    if !answer.forbidden(pn2) {
                        advanced |= answer.add_white_cell(pn2, TWO_N_IN_N_WHITE_NEAR);
                    }
                }
                let next = Position {
                    x: last.x + delta.x,
                    y: last.y + delta.y,
                };
                let nn1 = Position {
                    x: last.x - delta.y,
                    y: last.y - delta.x,
                };
                let nn2 = Position {
                    x: last.x + delta.y,
                    y: last.y + delta.x,
                };
                if answer.forbidden(next) {
                    if !answer.forbidden(nn1) {
                        advanced |= answer.add_white_cell(nn1, TWO_N_IN_N_WHITE_NEAR);
                    }
                    if !answer.forbidden(nn2) {
                        advanced |= answer.add_white_cell(nn2, TWO_N_IN_N_WHITE_NEAR);
                    }
                }
                let pd1 = Position {
                    x: first.x - delta.x - delta.y,
                    y: first.y - delta.y - delta.x,
                };
                if answer.forbidden(pd1) && !answer.forbidden(pn1) && !answer.is_line_edge(pn1)
                {
                    let pos = Position {
                        x: run[1].x - delta.y,
                        y: run[1].y - delta.x,
                    };
                    if !answer.forbidden(pos) {
                        advanced |= answer.add_white_cell(pos, TWO_N_IN_N_WHITE_FAR);
                    }
                }
                let pd2 = Position {
                    x: first.x - delta.x + delta.y,
                    y: first.y - delta.y + delta.x,
                };
                if answer.forbidden(pd2) && !answer.forbidden(pn2) && !answer.is_line_edge(pn2)
                {
                    let pos = Position {
                        x: run[1].x + delta.y,
                        y: run[1].y + delta.x,
                    };
                    if !answer.forbidden(pos) {
                        advanced |= answer.add_white_cell(pos, TWO_N_IN_N_WHITE_FAR);
                    }
                }
                let nd1 = Position {
                    x: last.x + delta.x - delta.y,
                    y: last.y + delta.y - delta.x,
                };
                if answer.forbidden(nd1) && !answer.forbidden(nn1) && !answer.is_line_edge(nn1)
                {
                    let pos = Position {
                        x: run[run.len() - 2].x - delta.y,
                        y: run[run.len() - 2].y - delta.x,
                    };
                    if !answer.forbidden(pos) {
                        advanced |= answer.add_white_cell(pos, TWO_N_IN_N_WHITE_FAR);
                    }
                }
                let nd2 = Position {
                    x: last.x + delta.x + delta.y,
                    y: last.y + delta.y + delta.x,
                };
                if answer.forbidden(nd2) && !answer.forbidden(nn2) && !answer.is_line_edge(nn2)
                {
                    let pos = Position {
                        x: run[run.len() - 2].x + delta.y,
                        y: run[run.len() - 2].y + delta.x,
                    };
                    if !answer.forbidden(pos) {
                        advanced |= answer.add_white_cell(pos, TWO_N_IN_N_WHITE_FAR);
                    }
                }
            }
        } else if low > capacity + black_count {
            return Status::Broken;
        } else if high < black_count {
            return Status::Broken;
        }
    }
    if advanced {
        Status::Advanced
    } else {
        Status::Stopped
    }
}
