use crate::answer_methods::AnswerMethods;
use crate::position::{add, Position, DIR_LIST};
use crate::reasons::{
    BRANCH_BAN_WHITE, EXIT_TECHNIQUE, EXTEND_LINE_END, LINE_FIXED,
    SIMPLE_LOOP_TECHNIQUE, SMALL_LOOP_BAN, SMALL_LOOP_BAN_BLACK,
    SMALL_LOOP_BAN_EXTENSION, SMALL_LOOP_BAN_WHITE, UNREACHABLE_BLACK,
};
use crate::status::Status;

fn fixed_edge(answer: &mut AnswerMethods<'_>, target: Position) -> Status {
    let enables = answer.edge_around(target);
    let mut advanced = false;
    match enables.len() {
        0 => return Status::Broken,
        1 => advanced |= answer.add_line(&[target, enables[0].0], EXTEND_LINE_END),
        2 => {
            if !answer.is_single_line() && answer.is_same_line(target, enables[0].0) {
                advanced |= answer.add_line(&[target, enables[1].0], SMALL_LOOP_BAN);
            } else if !answer.is_single_line() && answer.is_same_line(target, enables[1].0) {
                advanced |=
                    answer.add_line(&[target, enables[0].0], SMALL_LOOP_BAN_EXTENSION);
            }
        }
        3 => {
            for enabled in enables.iter().take(3) {
                if !answer.is_single_line() && answer.is_same_line(target, enabled.0) {
                    answer.set_line_bar(target, enabled.0);
                    advanced = true;
                }
            }
        }
        _ => {}
    }
    if advanced {
        Status::Advanced
    } else {
        Status::Stopped
    }
}

fn fixed_white(answer: &mut AnswerMethods<'_>, target: Position) -> Status {
    let enables = answer.edge_around(target);
    let mut advanced = false;
    if enables.len() == 2 {
        advanced |= answer.add_line(
            &[add(target, enables[0].1), target, add(target, enables[1].1)],
            LINE_FIXED,
        );
    } else if enables.len() <= 1 {
        return Status::Broken;
    } else if enables.len() == 3 {
        let not_edges: Vec<_> = enables
            .iter()
            .copied()
            .filter(|(pos, _)| !answer.is_line_edge(*pos))
            .collect();
        let edges: Vec<_> = enables
            .iter()
            .copied()
            .filter(|(pos, _)| answer.is_line_edge(*pos))
            .collect();
        if not_edges.len() == 1
            && !answer.is_single_line()
            && answer.is_same_line(edges[0].0, edges[1].0)
        {
            advanced |= answer.add_line(&[target, not_edges[0].0], SIMPLE_LOOP_TECHNIQUE);
        }
    }
    if advanced {
        Status::Advanced
    } else {
        Status::Stopped
    }
}

pub fn add_fixed_line_with_target(
    answer: &mut AnswerMethods<'_>,
    target: Position,
) -> Status {
    let mut advanced = false;
    if answer.is_line_edge(target) {
        let status = fixed_edge(answer, target);
        if status == Status::Broken {
            return status;
        }
        advanced |= status == Status::Advanced;
    } else if answer.has_white_cell(target) {
        let status = fixed_white(answer, target);
        if status == Status::Broken {
            return status;
        }
        advanced |= status == Status::Advanced;
    } else {
        let enables = answer.edge_around(target);
        let mut target_advanced = false;
        if enables.len() <= 1 {
            let flag = answer.add_black_cell(target, UNREACHABLE_BLACK);
            advanced |= flag;
            target_advanced |= flag;
        } else if enables.len() == 2
            && !answer.is_single_line()
            && answer.is_same_line(enables[0].0, enables[1].0)
        {
            let flag = answer.add_black_cell(target, SMALL_LOOP_BAN_BLACK);
            advanced |= flag;
            target_advanced |= flag;
        }
        if !target_advanced {
            for (pos, dir) in enables.iter().copied() {
                if answer.is_line_edge(pos) {
                    continue;
                }
                let enables2 = answer.edge_around(pos);
                if enables2.len() == 2 {
                    let flag = answer.add_white_cell(target, EXIT_TECHNIQUE);
                    advanced |= flag;
                    target_advanced |= flag;
                } else if enables2.len() == 3 {
                    let others: Vec<_> = enables2
                        .iter()
                        .copied()
                        .filter(|(_, dir2)| dir.x + dir2.x != 0 || dir.y + dir2.y != 0)
                        .collect();
                    if !answer.is_single_line()
                        && answer.is_same_line(add(pos, others[0].1), add(pos, others[1].1))
                    {
                        let flag = answer.add_white_cell(target, SMALL_LOOP_BAN_WHITE);
                        advanced |= flag;
                        target_advanced |= flag;
                    }
                }
            }
        }
        if !target_advanced {
            for dir in [
                Position { x: 1, y: 1 },
                Position { x: 1, y: -1 },
                Position { x: -1, y: 1 },
                Position { x: -1, y: -1 },
            ] {
                if !answer.is_line_edge(Position {
                    x: target.x + dir.x,
                    y: target.y + dir.y,
                }) {
                    continue;
                }
                let h = Position {
                    x: target.x + dir.x,
                    y: target.y,
                };
                let v = Position {
                    x: target.x,
                    y: target.y + dir.y,
                };
                if answer.forbidden(h) || answer.forbidden(v) {
                    continue;
                }
                let eh = DIR_LIST
                    .iter()
                    .filter(|d| {
                        !answer.forbidden(Position {
                            x: h.x + d.x,
                            y: h.y + d.y,
                        })
                    })
                    .count();
                let ev = DIR_LIST
                    .iter()
                    .filter(|d| {
                        !answer.forbidden(Position {
                            x: v.x + d.x,
                            y: v.y + d.y,
                        })
                    })
                    .count();
                if (eh == 2 || (!answer.is_line_edge(h) && eh == 3))
                    && (ev == 2 || (!answer.is_line_edge(v) && ev == 3))
                {
                    advanced |= answer.add_white_cell(target, BRANCH_BAN_WHITE);
                }
            }
        }
    }
    if advanced {
        Status::Advanced
    } else {
        Status::Stopped
    }
}

pub fn add_fixed_line(answer: &mut AnswerMethods<'_>) -> Status {
    let board = answer.board;
    let mut advanced = false;
    for i in 0..board.cell.len() {
        let target = Position {
            x: i as i32 % board.cols,
            y: i as i32 / board.cols,
        };
        if answer.forbidden(target) {
            continue;
        }
        let status = add_fixed_line_with_target(answer, target);
        if status == Status::Broken {
            return status;
        }
        advanced |= status == Status::Advanced;
    }
    if advanced {
        Status::Advanced
    } else {
        Status::Stopped
    }
}

