use crate::answer_methods::AnswerMethods;
use crate::answer_model::LINE_BAR;
use crate::board::to_id;
use crate::position::Position;
use crate::reasons::*;
use crate::status::Status;

pub fn row_col_line_number_theory(answer: &mut AnswerMethods<'_>) -> Status {
    let cols = answer.board.cols;
    let rows = answer.board.rows;
    for r in 1..rows - 1 {
        let mut up = 0;
        let mut down = 0;
        let mut spaces = Vec::new();
        let mut c = 0;
        while c < cols {
            let pos = Position { x: c, y: r };
            let posu = Position { x: c, y: r - 1 };
            let posd = Position { x: c, y: r + 1 };
            if answer.has_black_cell(pos)
                || answer.board.cell[(r * cols + c) as usize].qnum != -1
            {
                c += 1;
                continue;
            }
            if answer.black_candidates_horizontal.contains(to_id(pos))
                && !answer.forbidden(pos)
                && !answer.forbidden(Position { x: c + 1, y: r })
                && (answer.forbidden(Position { x: c - 1, y: r })
                    || answer.get_line_state(pos, Position { x: c - 1, y: r })
                        == Some(LINE_BAR))
                && (answer.forbidden(Position { x: c + 2, y: r })
                    || answer.get_line_state(
                        Position { x: c + 1, y: r },
                        Position { x: c + 2, y: r },
                    ) == Some(LINE_BAR))
            {
                up += 1;
                down += 1;
                c += 2;
                continue;
            }
            if answer.is_line_connection(pos, posu) {
                up += 1;
            }
            if answer.is_line_connection(pos, posd) {
                down += 1;
            }
            if !answer.has_line(pos)
                && !((answer.forbidden(posu)
                    || answer.get_line_state(pos, posu) == Some(LINE_BAR))
                    && (answer.forbidden(posd)
                        || answer.get_line_state(pos, posd) == Some(LINE_BAR)))
            {
                spaces.push(pos);
            }
            c += 1;
        }
        if spaces.len() == 2 {
            let mut flag = false;
            if spaces[0].y + 1 == spaces[1].y && up % 2 == 0 && down % 2 == 0 {
                flag |= answer.add_white_cell(spaces[0], ROW_COUNT_TWO_WHITE);
                flag |= answer.add_white_cell(spaces[1], ROW_COUNT_TWO_WHITE);
            }
            if up == 0 && down == 0 {
                flag |= answer.add_white_cell(spaces[0], ROW_GLOBAL_SMALL_LOOP_TWO_WHITE);
                flag |= answer.add_white_cell(spaces[1], ROW_GLOBAL_SMALL_LOOP_TWO_WHITE);
            }
            if spaces[0].y + 1 == spaces[1].y && up == 0 && down == 0 {
                answer.set_line_bar(spaces[0], spaces[1]);
            }
            if flag {
                return Status::Advanced;
            }
        }
        if spaces.len() == 1 {
            let pos = spaces[0];
            if up % 2 == 0 && down % 2 == 0 {
                if answer.add_black_cell(pos, ROW_COUNT_BLACK) {
                    return Status::Advanced;
                }
            } else if up % 2 == 1 && down % 2 == 1 {
                if answer.add_white_cell(pos, ROW_COUNT_WHITE) {
                    return Status::Advanced;
                }
            } else if up % 2 == 1 && down % 2 == 0 {
                if answer.add_line(
                    &[pos, Position { x: pos.x, y: pos.y - 1 }],
                    ROW_COUNT_LINE,
                ) {
                    return Status::Advanced;
                }
            } else if up % 2 == 0
                && down % 2 == 1
                && answer.add_line(
                    &[pos, Position { x: pos.x, y: pos.y + 1 }],
                    ROW_COUNT_LINE,
                )
            {
                return Status::Advanced;
            }
        } else if spaces.is_empty() && up % 2 != 0 && down % 2 != 0 {
            return Status::Broken;
        }
    }

    for c in 1..cols - 1 {
        let mut left = 0;
        let mut right = 0;
        let mut spaces = Vec::new();
        let mut r = 0;
        while r < rows {
            let pos = Position { x: c, y: r };
            let posl = Position { x: c - 1, y: r };
            let posr = Position { x: c + 1, y: r };
            if answer.has_black_cell(pos)
                || answer.board.cell[(r * cols + c) as usize].qnum != -1
            {
                r += 1;
                continue;
            }
            if answer.black_candidates_vertical.contains(to_id(pos))
                && (answer.forbidden(Position { x: c, y: r - 1 })
                    || answer.get_line_state(pos, Position { x: c, y: r - 1 })
                        == Some(LINE_BAR))
                && (answer.forbidden(Position { x: c, y: r + 2 })
                    || answer.get_line_state(
                        Position { x: c, y: r + 1 },
                        Position { x: c, y: r + 2 },
                    ) == Some(LINE_BAR))
            {
                left += 1;
                right += 1;
                r += 2;
                continue;
            }
            if answer.is_line_connection(pos, posl) {
                left += 1;
            }
            if answer.is_line_connection(pos, posr) {
                right += 1;
            }
            if !answer.has_line(pos)
                && !((answer.forbidden(posl)
                    || answer.get_line_state(pos, posl) == Some(LINE_BAR))
                    && (answer.forbidden(posr)
                        || answer.get_line_state(pos, posr) == Some(LINE_BAR)))
            {
                spaces.push(pos);
            }
            r += 1;
        }
        if spaces.len() == 2 {
            let mut flag = false;
            if spaces[0].y + 1 == spaces[1].y && left % 2 == 0 && right % 2 == 0 {
                flag |= answer.add_white_cell(spaces[0], COL_COUNT_TWO_WHITE);
                flag |= answer.add_white_cell(spaces[1], COL_COUNT_TWO_WHITE);
            }
            if left == 0 && right == 0 {
                flag |= answer.add_white_cell(spaces[0], COL_GLOBAL_SMALL_LOOP_TWO_WHITE);
                flag |= answer.add_white_cell(spaces[1], COL_GLOBAL_SMALL_LOOP_TWO_WHITE);
            }
            if spaces[0].y + 1 == spaces[1].y && left == 0 && right == 0 {
                answer.set_line_bar(spaces[0], spaces[1]);
            }
            if flag {
                return Status::Advanced;
            }
        }
        if spaces.len() == 1 {
            let pos = spaces[0];
            if left % 2 == 0
                && right % 2 == 0
                && answer.add_black_cell(pos, COL_COUNT_BLACK)
            {
                return Status::Advanced;
            }
            if left % 2 == 1
                && right % 2 == 1
                && answer.add_white_cell(pos, COL_COUNT_WHITE)
            {
                return Status::Advanced;
            }
            if left % 2 == 1
                && right % 2 == 0
                && answer.add_line(
                    &[pos, Position { x: pos.x - 1, y: pos.y }],
                    COL_COUNT_LINE,
                )
            {
                return Status::Advanced;
            }
            if left % 2 == 0
                && right % 2 == 1
                && answer.add_line(
                    &[pos, Position { x: pos.x + 1, y: pos.y }],
                    COL_COUNT_LINE,
                )
            {
                return Status::Advanced;
            }
        } else if spaces.is_empty() && left % 2 != 0 && right % 2 != 0 {
            return Status::Broken;
        }
    }
    Status::Stopped
}

