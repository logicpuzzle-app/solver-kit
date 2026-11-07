use crate::answer_methods::{AnswerMethods, Recorder};
use crate::answer_model::{AnswerModel, LINE_NONE};
use crate::board::{to_id, to_pos, Board};
use crate::position::Position;
use crate::reasons::{TRIAL_ANY_CASE, TRIAL_CONTRADICTION, TRIAL_LINE_CONTRADICTION};
use crate::status::Status;
use crate::techniques::add_black_cell_with_number::add_black_cell_with_number;
use crate::techniques::add_fixed_line::add_fixed_line;
use crate::techniques::add_white_around_black::add_white_around_black;
use crate::techniques::add_white_cell_with_zero::add_white_cell_with_zero;
use crate::techniques::cut_parity::cut_parity;
use crate::techniques::line_number_theory::line_number_theory;
use crate::techniques::row_col_line_number_theory::row_col_line_number_theory;

#[derive(Clone, Debug, Default)]
pub struct TrialStats {
    pub trial_deductions: i32,
    pub max_trial_count: i32,
    pub passes: i32,
    /// Cells still undecided the first time the techniques ran out, before any trial.
    ///
    /// Ported from nurikabe-kit, where this turned out to be the single most useful
    /// difficulty feature: technique fire counts track board size rather than difficulty,
    /// but "how far pure deduction got you" separates the ratings cleanly.
    pub pure_undecided: i32,
    /// The deepest stage of reasoning the puzzle actually needed (see `LEVEL_*`).
    ///
    /// `solve` is already a cascade: each stage only runs when every cheaper stage has
    /// stalled, so the deepest stage that ever fired is exactly "the minimum set of
    /// techniques that solves this puzzle". Humans rate puzzles the same way — by how far
    /// down the list of techniques they had to go, not by how many deductions they made.
    pub level: u8,
}

/// Stages of reasoning, cheapest first. The number is the difficulty model's main axis.
pub const LEVEL_BASIC: u8 = 1;
pub const LEVEL_ROW_COL: u8 = 2;
pub const LEVEL_CUT_PARITY: u8 = 3;
pub const LEVEL_LINE_THEORY: u8 = 4;
pub const LEVEL_TRIAL: u8 = 5;
pub const LEVEL_UNSOLVED: u8 = 6;

pub fn solve(answer: &mut AnswerMethods<'_>) -> Status {
    solve_at(answer, &mut 0)
}

/// `solve`, recording the deepest stage that fired into `level`.
pub fn solve_at(answer: &mut AnswerMethods<'_>, level: &mut u8) -> Status {
    let mut reached = |stage: u8, status: Status| {
        if status == Status::Advanced {
            *level = (*level).max(stage);
        }
        status
    };
    add_white_around_black(answer);
    let status1 = reached(LEVEL_BASIC, add_black_cell_with_number(answer));
    if status1 == Status::Broken {
        return Status::Broken;
    }
    let status2 = reached(LEVEL_BASIC, add_white_cell_with_zero(answer));
    let status4 = reached(LEVEL_BASIC, add_fixed_line(answer));
    if status4 == Status::Broken {
        return Status::Broken;
    }
    if answer.has_small_loop() {
        return Status::Broken;
    }
    if status1 == Status::Stopped && status2 == Status::Stopped && status4 == Status::Stopped {
        let status5 = reached(LEVEL_ROW_COL, row_col_line_number_theory(answer));
        if status5 == Status::Stopped {
            let status6 = reached(LEVEL_CUT_PARITY, cut_parity(answer));
            if status6 == Status::Stopped {
                return reached(LEVEL_LINE_THEORY, line_number_theory(answer));
            }
            return status6;
        }
        return status5;
    }
    Status::Advanced
}

#[derive(Clone)]
enum Broken {
    Cell {
        count: i32,
        target: Position,
        black: bool,
        any_case: bool,
    },
    Edge {
        count: i32,
        line: [Position; 2],
        line_value: bool,
    },
}

fn propagate_trial(board: &Board, model: &mut AnswerModel, min_count: i32, ge: bool) -> (Status, i32, crate::ordered::OrderedSet, crate::ordered::OrderedSet) {
    let mut methods = AnswerMethods::new(board, model, None);
    let mut status = Status::Advanced;
    let mut count = 0;
    while status == Status::Advanced {
        status = solve(&mut methods);
        count += 1;
        if (ge && count >= min_count) || (!ge && count > min_count) {
            status = Status::Stopped;
        }
    }
    (status, count, methods.new_blacks, methods.new_whites)
}

fn try_solve(answer: &mut AnswerMethods<'_>, stats: &mut TrialStats) -> Status {
    let board = answer.board;
    let mut broken_list = Vec::new();
    let mut min_count_flag = false;
    let mut min_count = 100;

    if !min_count_flag {
        for i in 0..board.cell.len() {
            let target = Position {
                x: i as i32 % board.cols,
                y: i as i32 / board.cols,
            };
            if board.cell[i].qnum != -1
                || answer.answer.black_cells.contains(to_id(target))
                || answer.answer.white_cells.contains(to_id(target))
                || answer.answer.inner_line.contains(to_id(target))
                || answer.answer.edge.contains_key(to_id(target))
            {
                continue;
            }
            let mut black_model = answer.answer.clone_for_trial();
            black_model.black_cells.insert(to_id(target));
            let (black_status, black_count, black_new, black_whites) =
                propagate_trial(board, &mut black_model, min_count, false);
            if black_status == Status::Broken {
                broken_list.push(Broken::Cell {
                    count: black_count,
                    target,
                    black: false,
                    any_case: false,
                });
                if black_count == 1 {
                    min_count_flag = true;
                    break;
                }
                min_count = min_count.min(black_count);
            }

            let mut white_model = answer.answer.clone_for_trial();
            white_model.white_cells.insert(to_id(target));
            let (white_status, white_count, white_new_black, white_new) =
                propagate_trial(board, &mut white_model, min_count, false);
            if white_status == Status::Broken {
                broken_list.push(Broken::Cell {
                    count: white_count,
                    target,
                    black: true,
                    any_case: false,
                });
                if white_count == 1 {
                    min_count_flag = true;
                    break;
                }
                min_count = min_count.min(white_count);
            }
            if let Some(id) = black_new.iter().find(|id| white_new_black.contains(*id)) {
                let count = black_count.max(white_count);
                min_count = min_count.min(count);
                broken_list.push(Broken::Cell {
                    count,
                    target: to_pos(id),
                    black: true,
                    any_case: true,
                });
            }
            if let Some(id) = black_whites.iter().find(|id| white_new.contains(*id)) {
                let count = black_count.max(white_count);
                min_count = min_count.min(count);
                broken_list.push(Broken::Cell {
                    count,
                    target: to_pos(id),
                    black: false,
                    any_case: true,
                });
            };
        }
    }

    for y in 0..board.rows {
        for x in 0..board.cols - 1 {
            let target = Position { x, y };
            let other = Position { x: x + 1, y };
            if answer
                .answer
                .horizontal
                .get(to_id(target))
                .copied()
                .unwrap_or(LINE_NONE)
                != LINE_NONE
                || answer.forbidden(target)
                || answer.forbidden(other)
            {
                continue;
            }
            let mut line_model = answer.answer.clone_for_trial();
            line_model.add_line(&[target, other]);
            let (line_status, line_count, line_blacks, line_whites) =
                propagate_trial(board, &mut line_model, min_count, false);
            if line_status == Status::Broken {
                broken_list.push(Broken::Edge {
                    count: line_count,
                    line: [target, other],
                    line_value: false,
                });
                if line_count == 1 {
                    min_count_flag = true;
                    min_count = line_count;
                    break;
                }
                min_count = min_count.min(line_count);
            }
            let mut bar_model = answer.answer.clone_for_trial();
            bar_model.set_line_bar(target, other);
            let (bar_status, bar_count, bar_blacks, bar_whites) =
                propagate_trial(board, &mut bar_model, min_count, false);
            if bar_status == Status::Broken {
                broken_list.push(Broken::Edge {
                    count: bar_count,
                    line: [target, other],
                    line_value: true,
                });
                if bar_count == 1 {
                    min_count_flag = true;
                    break;
                }
                min_count = min_count.min(bar_count);
            }
            if let Some(id) = line_blacks.iter().find(|id| bar_blacks.contains(*id)) {
                let count = line_count.max(bar_count);
                min_count = min_count.min(count);
                broken_list.push(Broken::Cell {
                    count,
                    target: to_pos(id),
                    black: true,
                    any_case: true,
                });
            }
            if let Some(id) = line_whites.iter().find(|id| bar_whites.contains(*id)) {
                let count = line_count.max(bar_count);
                min_count = min_count.min(count);
                broken_list.push(Broken::Cell {
                    count,
                    target: to_pos(id),
                    black: false,
                    any_case: true,
                });
            };
        }
    }

    for y in 0..board.rows - 1 {
        for x in 0..board.cols {
            let target = Position { x, y };
            let other = Position { x, y: y + 1 };
            if answer
                .answer
                .vertical
                .get(to_id(target))
                .copied()
                .unwrap_or(LINE_NONE)
                != LINE_NONE
                || answer.forbidden(target)
                || answer.forbidden(other)
            {
                continue;
            }
            let mut line_model = answer.answer.clone_for_trial();
            line_model.add_line(&[target, other]);
            let (line_status, line_count, _, _) =
                propagate_trial(board, &mut line_model, min_count, true);
            if line_status == Status::Broken {
                broken_list.push(Broken::Edge {
                    count: line_count,
                    line: [target, other],
                    line_value: false,
                });
                if line_count == 1 {
                    min_count_flag = true;
                    break;
                }
                min_count = min_count.min(line_count);
            }
            let mut bar_model = answer.answer.clone_for_trial();
            bar_model.set_line_bar(target, other);
            let (bar_status, bar_count, _, _) =
                propagate_trial(board, &mut bar_model, min_count, true);
            if bar_status == Status::Broken {
                broken_list.push(Broken::Edge {
                    count: bar_count,
                    line: [target, other],
                    line_value: true,
                });
                if bar_count == 1 {
                    min_count_flag = true;
                    break;
                }
                min_count = min_count.min(bar_count);
            }
        }
    }
    let _ = min_count_flag;
    if broken_list.is_empty() {
        return Status::Stopped;
    }
    for broken in broken_list {
        let count = match broken {
            Broken::Cell { count, .. } | Broken::Edge { count, .. } => count,
        };
        stats.trial_deductions += 1;
        stats.max_trial_count = stats.max_trial_count.max(count);
        match broken {
            Broken::Cell {
                target,
                black,
                any_case,
                ..
            } => {
                let reason = if any_case {
                    TRIAL_ANY_CASE
                } else {
                    TRIAL_CONTRADICTION
                };
                if black {
                    answer.add_black_cell(target, reason);
                } else {
                    answer.add_white_cell(target, reason);
                }
            }
            Broken::Edge {
                line, line_value, ..
            } => {
                if line_value {
                    answer.answer.add_line(&line);
                    if let Some(recorder) = &mut answer.recorder {
                        recorder.add("line", line.to_vec(), TRIAL_LINE_CONTRADICTION);
                    }
                } else {
                    answer.answer.set_line_bar(line[0], line[1]);
                    if let Some(recorder) = &mut answer.recorder {
                        recorder.add("bar", line.to_vec(), TRIAL_LINE_CONTRADICTION);
                    }
                }
            }
        }
    }
    Status::Advanced
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SolveStatus {
    Completed,
    Stopped,
    Broken,
}

pub struct SolveOutcome {
    pub status: SolveStatus,
    pub answer: AnswerModel,
    pub recorder: Recorder,
    pub stats: TrialStats,
}

pub struct SolveOptions {
    pub no_trial: bool,
    pub max_passes: i32,
}

pub fn run_all(board: &Board, initial: Option<AnswerModel>, options: SolveOptions) -> SolveOutcome {
    let mut answer = initial.unwrap_or_default();
    let mut recorder = Recorder::default();
    let mut stats = TrialStats::default();
    let mut status = Status::Advanced;
    let mut stalled = false;
    let clue_cells = board
        .cell
        .iter()
        .filter(|cell| cell.qnum >= 0)
        .count() as i32;
    while status == Status::Advanced {
        let mut methods = AnswerMethods::new(board, &mut answer, Some(&mut recorder));
        stats.passes += 1;
        let mut level = stats.level;
        status = solve_at(&mut methods, &mut level);
        stats.level = level;
        if status == Status::Stopped && !methods.answer.is_single_line() && !stalled {
            let decided =
                (methods.answer.black_cells.len() + methods.answer.white_cells.len()) as i32;
            stats.pure_undecided = (board.cols * board.rows - clue_cells) - decided;
            stalled = true;
        }
        if !options.no_trial && status == Status::Stopped && !methods.answer.is_single_line() {
            status = try_solve(&mut methods, &mut stats);
            if status == Status::Advanced {
                stats.level = stats.level.max(LEVEL_TRIAL);
            }
        }
        if options.max_passes > 0 && stats.passes >= options.max_passes {
            break;
        }
    }
    let final_status = match status {
        Status::Broken => SolveStatus::Broken,
        Status::Stopped if answer.is_single_line() => SolveStatus::Completed,
        _ => SolveStatus::Stopped,
    };
    if final_status == SolveStatus::Stopped {
        stats.level = LEVEL_UNSOLVED;
    } else if stats.level == 0 {
        stats.level = LEVEL_BASIC;
    }
    SolveOutcome {
        status: final_status,
        answer,
        recorder,
        stats,
    }
}

impl Default for SolveOptions {
    fn default() -> Self {
        Self {
            no_trial: false,
            max_passes: 0,
        }
    }
}
