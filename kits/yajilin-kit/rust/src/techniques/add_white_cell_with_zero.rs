//! When an arrow's remaining count is already satisfied, every still-free cell along the
//! arrow becomes white. `next_num` subtracts the clue of the next arrow pointing the same
//! way, which is what lets chained arrows cancel out.

use crate::answer_methods::AnswerMethods;
use crate::position::{Position, DIRS};
use crate::reasons::{
    BLACK_ALREADY_PLACED_WHITE, SUBTRACTED_BLACK_ALREADY_PLACED_WHITE,
    SUBTRACTED_ZERO_WHITE, ZERO_WHITE,
};
use crate::status::Status;

/// Blacks already standing from `from` (exclusive) to the board edge along `delta`.
///
/// A `?` clue counts these whether or not its own number is known, so they are the floor
/// under it and come straight off the arrow that runs into it.
fn placed_blacks_beyond(
    board: &crate::board::Board,
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

pub fn add_white_cell_with_zero(answer: &mut AnswerMethods<'_>) -> Status {
    let board = answer.board;
    let mut advanced = false;
    for i in 0..board.cell.len() {
        let dir = board.cell[i].qdir;
        if dir == -1 || dir == 0 {
            continue;
        }
        let delta = DIRS[dir as usize];
        let mut x = i as i32 % board.cols + delta.x;
        let mut y = i as i32 / board.cols + delta.y;
        let mut black_count = 0;
        while board.in_board(Position { x, y })
            && board.cell[(y * board.cols + x) as usize].qdir != dir
        {
            if answer.has_black_cell(Position { x, y }) {
                black_count += 1;
            }
            x += delta.x;
            y += delta.y;
        }
        let next_num = if board.in_board(Position { x, y }) {
            board.cell[(y * board.cols + x) as usize].qnum
        } else {
            0
        };
        // This arrow's own count has to be known for the rule to say anything at all.
        if board.cell[i].qnum == -2 {
            continue;
        }
        // The most blacks that can lie between here and the clue this arrow runs into.
        // When that clue is a `?` the subtraction is unavailable, but the far clue still
        // counts every black already standing beyond it, and subtracting those is what
        // makes the bound bite. An arrow reading 1 that runs into a `?` with one black
        // already placed past it has nothing left to spend, so everything in between is
        // white — reading the `?` as merely "nothing or more" throws that away.
        let most = if next_num == -2 {
            board.cell[i].qnum
                - placed_blacks_beyond(board, answer, Position { x, y }, delta)
        } else {
            board.cell[i].qnum - next_num
        };
        // A `?` leaves nothing subtracted, so the two "subtracted" reasons cannot apply and
        // the deduction is recorded as the plain one it is.
        let subtracted = next_num != -2 && next_num > 0;

        if most == black_count {
            x = i as i32 % board.cols + delta.x;
            y = i as i32 / board.cols + delta.y;
            while board.in_board(Position { x, y })
                && board.cell[(y * board.cols + x) as usize].qdir != dir
            {
                let pos = Position { x, y };
                if !answer.forbidden(pos) {
                    if black_count > 0 && subtracted {
                        advanced |= answer.add_white_cell(
                            pos,
                            SUBTRACTED_BLACK_ALREADY_PLACED_WHITE,
                        );
                    }
                    if black_count > 0 {
                        advanced |= answer.add_white_cell(pos, BLACK_ALREADY_PLACED_WHITE);
                    } else if subtracted {
                        advanced |= answer.add_white_cell(pos, SUBTRACTED_ZERO_WHITE);
                    } else {
                        advanced |= answer.add_white_cell(pos, ZERO_WHITE);
                    }
                }
                x += delta.x;
                y += delta.y;
            }
        }
    }
    if advanced {
        Status::Advanced
    } else {
        Status::Stopped
    }
}
