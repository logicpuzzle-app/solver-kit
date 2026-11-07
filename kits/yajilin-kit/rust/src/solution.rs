use std::collections::HashSet;

use crate::answer_model::{AnswerModel, LINE_LINE};
use crate::board::{to_id, to_pos, Board};
use crate::position::{Position, DIRS};

#[derive(Clone, Debug, Default)]
pub struct Solution {
    pub blacks: HashSet<i64>,
    pub horizontal: HashSet<i64>,
    pub vertical: HashSet<i64>,
}

pub fn extract_solution(answer: &AnswerModel) -> Solution {
    let mut solution = Solution::default();
    solution.blacks.extend(answer.black_cells.iter());
    for (id, state) in answer.horizontal.iter() {
        if *state == LINE_LINE {
            solution.horizontal.insert(id);
        }
    }
    for (id, state) in answer.vertical.iter() {
        if *state == LINE_LINE {
            solution.vertical.insert(id);
        }
    }
    solution
}

pub fn count_blacks_along_arrow(
    board: &Board,
    solution: &Solution,
    origin: Position,
    dir: i32,
) -> i32 {
    let delta = DIRS[dir as usize];
    let mut x = origin.x + delta.x;
    let mut y = origin.y + delta.y;
    let mut count = 0;
    while board.in_board(Position { x, y }) {
        if solution.blacks.contains(&to_id(Position { x, y })) {
            count += 1;
        }
        x += delta.x;
        y += delta.y;
    }
    count
}

fn neighbours(board: &Board, solution: &Solution, pos: Position) -> Vec<Position> {
    let candidates = [
        (
            solution.vertical.contains(&to_id(Position {
                x: pos.x,
                y: pos.y - 1,
            })),
            Position {
                x: pos.x,
                y: pos.y - 1,
            },
        ),
        (
            solution.vertical.contains(&to_id(pos)),
            Position {
                x: pos.x,
                y: pos.y + 1,
            },
        ),
        (
            solution.horizontal.contains(&to_id(Position {
                x: pos.x - 1,
                y: pos.y,
            })),
            Position {
                x: pos.x - 1,
                y: pos.y,
            },
        ),
        (
            solution.horizontal.contains(&to_id(pos)),
            Position {
                x: pos.x + 1,
                y: pos.y,
            },
        ),
    ];
    candidates
        .into_iter()
        .filter_map(|(line, p)| (line && board.in_board(p)).then_some(p))
        .collect()
}

#[derive(Clone, Debug)]
pub enum ValidationError {
    BlackOnClue(Position),
    AdjacentBlacks(Position, Position),
    LineOnBlocked(Position),
    CellNotCovered(Position),
    Degree(Position, usize),
    NotSingleLoop,
    ArrowCount(Position, i32, i32),
}

pub fn validate_solution(board: &Board, solution: &Solution) -> Vec<ValidationError> {
    let mut errors = Vec::new();
    let blocked = |pos: Position| {
        !board.in_board(pos)
            || solution.blacks.contains(&to_id(pos))
            || board.at(pos).qnum != -1
    };
    for &id in &solution.horizontal {
        let pos = to_pos(id);
        let right = Position {
            x: pos.x + 1,
            y: pos.y,
        };
        if blocked(pos) {
            errors.push(ValidationError::LineOnBlocked(pos));
        }
        if blocked(right) {
            errors.push(ValidationError::LineOnBlocked(right));
        }
    }
    for &id in &solution.vertical {
        let pos = to_pos(id);
        let down = Position {
            x: pos.x,
            y: pos.y + 1,
        };
        if blocked(pos) {
            errors.push(ValidationError::LineOnBlocked(pos));
        }
        if blocked(down) {
            errors.push(ValidationError::LineOnBlocked(down));
        }
    }
    let mut loop_cells = Vec::new();
    for (i, cell) in board.cell.iter().enumerate() {
        let pos = Position {
            x: i as i32 % board.cols,
            y: i as i32 / board.cols,
        };
        let black = solution.blacks.contains(&to_id(pos));
        let clue = cell.qnum != -1;
        if black && clue {
            errors.push(ValidationError::BlackOnClue(pos));
            continue;
        }
        if black {
            for other in [
                Position {
                    x: pos.x + 1,
                    y: pos.y,
                },
                Position {
                    x: pos.x,
                    y: pos.y + 1,
                },
            ] {
                if board.in_board(other) && solution.blacks.contains(&to_id(other)) {
                    errors.push(ValidationError::AdjacentBlacks(pos, other));
                }
            }
            continue;
        }
        if clue {
            continue;
        }
        let degree = neighbours(board, solution, pos).len();
        if degree == 0 {
            errors.push(ValidationError::CellNotCovered(pos));
        } else if degree != 2 {
            errors.push(ValidationError::Degree(pos, degree));
        } else {
            loop_cells.push(pos);
        }
    }
    if !errors.is_empty() {
        return errors;
    }
    if let Some(&first) = loop_cells.first() {
        let mut seen = HashSet::new();
        let mut stack = vec![first];
        seen.insert(to_id(first));
        while let Some(pos) = stack.pop() {
            for next in neighbours(board, solution, pos) {
                if seen.insert(to_id(next)) {
                    stack.push(next);
                }
            }
        }
        if seen.len() != loop_cells.len() {
            errors.push(ValidationError::NotSingleLoop);
        }
    }
    for (i, cell) in board.cell.iter().enumerate() {
        if cell.qdir <= 0 || cell.qnum < 0 {
            continue;
        }
        let pos = Position {
            x: i as i32 % board.cols,
            y: i as i32 / board.cols,
        };
        let actual = count_blacks_along_arrow(board, solution, pos, cell.qdir);
        if actual != cell.qnum {
            errors.push(ValidationError::ArrowCount(pos, cell.qnum, actual));
        }
    }
    errors
}

pub fn describe_validation_error(error: &ValidationError) -> String {
    let at = |p: Position| format!("({},{})", p.x + 1, p.y + 1);
    match *error {
        ValidationError::BlackOnClue(p) => format!("black cell on a clue at {}", at(p)),
        ValidationError::AdjacentBlacks(a, b) => {
            format!("adjacent black cells at {} and {}", at(a), at(b))
        }
        ValidationError::LineOnBlocked(p) => {
            format!("line runs through a blocked cell at {}", at(p))
        }
        ValidationError::CellNotCovered(p) => {
            format!("cell not covered by the loop at {}", at(p))
        }
        ValidationError::Degree(p, degree) => {
            format!("cell at {} has {} line ends", at(p), degree)
        }
        ValidationError::NotSingleLoop => "the line forms more than one loop".to_string(),
        ValidationError::ArrowCount(p, expected, actual) => format!(
            "arrow at {} expects {} black cells but sees {}",
            at(p),
            expected,
            actual
        ),
    }
}

