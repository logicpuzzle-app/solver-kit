//! 手筋ソルバーのドライバ。
//!
//! 安い段階から始め、止まったときだけ仮置きへ進む。現時点の手筋は段階 1 だけだが、
//! 段階番号を軸にする構造は手筋追加後も変えない。

use crate::answer_methods::{merge_status, AnswerMethods, Recorder};
use crate::answer_model::{AnswerModel, CellState};
use crate::board::Board;
use crate::reasons::{TRIAL_ANY_CASE, TRIAL_CONTRADICTION};
use crate::solution::validate_solution;
use crate::status::Status;
use crate::techniques::black_adjacent::black_adjacent;
use crate::techniques::clue::clue;
use crate::techniques::cut_white::cut_white;
use crate::techniques::room_patterns::room_patterns;
use crate::techniques::three_in_line::three_in_line;

type Technique = fn(&mut AnswerMethods<'_>) -> Status;

pub const TIER_COUNT: u8 = 4;
pub const LEVEL_SHALLOW_TRIAL: u8 = TIER_COUNT + 1;
pub const LEVEL_DEEP_TRIAL: u8 = TIER_COUNT + 2;
pub const LEVEL_UNSOLVED: u8 = TIER_COUNT + 3;

/// 仮置きの中で回す手筋。大域手筋(cut_white)を外すと仮置きが破綻を検出できず
/// 効かなくなる(ましゅで実測)。「置くと破綻」系を足す案は計測で却下した
/// (README の「計測で却下したもの」)。
const FAST_TECHNIQUES: [Technique; 4] = [clue, black_adjacent, three_in_line, cut_white];

fn techniques_for_tier(tier: u8) -> &'static [Technique] {
    const T1: [Technique; 2] = [clue, black_adjacent];
    const T2: [Technique; 3] = [clue, black_adjacent, room_patterns];
    const T3: [Technique; 4] = [clue, black_adjacent, room_patterns, three_in_line];
    const T4: [Technique; 5] = [
        clue,
        black_adjacent,
        room_patterns,
        three_in_line,
        cut_white,
    ];
    match tier {
        0 | 1 => &T1,
        2 => &T2,
        3 => &T3,
        _ => &T4,
    }
}

pub fn technique_list() -> Vec<(&'static str, Technique)> {
    vec![
        ("clue", clue as Technique),
        ("black_adjacent", black_adjacent),
        ("room_patterns", room_patterns),
        ("three_in_line", three_in_line),
        ("cut_white", cut_white),
    ]
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SolveStatus {
    Completed,
    Stopped,
    Broken,
}

#[derive(Clone, Debug)]
pub struct SolveOptions {
    /// 0 なら無制限。
    pub max_passes: i32,
    pub no_trial: bool,
    /// 使う手筋の段階(現在は 1 のみ)。
    pub tier: u8,
    /// 仮置きの入れ子の深さ。
    pub trial_depth: i32,
}

impl Default for SolveOptions {
    fn default() -> Self {
        Self {
            max_passes: 0,
            no_trial: false,
            tier: TIER_COUNT,
            trial_depth: 1,
        }
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct TrialStats {
    pub deductions: i32,
    pub nested_deductions: i32,
    pub pure_unknown: i32,
    pub shallow_unknown: i32,
}

pub struct SolveOutcome {
    pub status: SolveStatus,
    pub level: u8,
    pub answer: AnswerModel,
    pub recorder: Recorder,
    pub passes: i32,
    pub stats: TrialStats,
}

fn run(answer: &mut AnswerMethods<'_>, techniques: &[Technique]) -> Status {
    let mut result = Status::Stopped;
    for &technique in techniques {
        match technique(answer) {
            Status::Broken => return Status::Broken,
            Status::Advanced => result = Status::Advanced,
            Status::Stopped => {}
        }
    }
    result
}

pub fn solve_tier(answer: &mut AnswerMethods<'_>, tier: u8) -> Status {
    run(answer, techniques_for_tier(tier))
}

/// 仮置き内の全確定盤面も独立検証する。最小手筋には連結・3 部屋禁の検出がないため、
/// これをしないとルール違反の枝を「生存」と誤認する。
fn completed_status(board: &Board, answer: &AnswerModel) -> Option<Status> {
    answer.is_complete().then(|| {
        if validate_solution(board, answer).is_empty() {
            Status::Stopped
        } else {
            Status::Broken
        }
    })
}

fn propagate_trial(
    board: &Board,
    answer: &mut AnswerModel,
    depth: i32,
    stats: &mut TrialStats,
) -> Status {
    loop {
        if let Some(status) = completed_status(board, answer) {
            return status;
        }
        let before = answer.unknown_count();
        let status = {
            let mut methods = AnswerMethods::new(board, answer, None);
            run(&mut methods, &FAST_TECHNIQUES)
        };
        if status == Status::Broken {
            return Status::Broken;
        }
        if status == Status::Stopped || answer.unknown_count() == before {
            if depth > 0 && answer.unknown_count() > 0 {
                let mut nested = TrialStats::default();
                let inner = try_solve(board, answer, &mut nested, depth - 1);
                stats.nested_deductions += nested.deductions + nested.nested_deductions;
                match inner {
                    Status::Broken => return Status::Broken,
                    Status::Advanced => continue,
                    Status::Stopped => {}
                }
            }
            return completed_status(board, answer).unwrap_or(Status::Stopped);
        }
    }
}

/// 未確定マスを黒・白の両方で試す。片方の破綻と、両方に共通する確定を取り込む。
fn try_solve(
    board: &Board,
    answer: &mut AnswerModel,
    stats: &mut TrialStats,
    depth: i32,
) -> Status {
    let targets: Vec<usize> = (0..board.cell_count())
        .filter(|&index| answer.is_unknown(index))
        .collect();
    for index in targets {
        if !answer.is_unknown(index) {
            continue;
        }
        let mut outcomes = Vec::new();
        for state in [CellState::Black, CellState::White] {
            let mut trial = answer.clone_for_trial();
            if trial.set(index, state).is_err() {
                continue;
            }
            let status = propagate_trial(board, &mut trial, depth, stats);
            outcomes.push((state, status, trial));
        }
        if outcomes.len() < 2 {
            continue;
        }
        let broken: Vec<bool> = outcomes
            .iter()
            .map(|(_, status, _)| *status == Status::Broken)
            .collect();
        if broken.iter().all(|&is_broken| is_broken) {
            return Status::Broken;
        }
        if let Some(at) = broken.iter().position(|&is_broken| is_broken) {
            let other = outcomes[1 - at].0;
            stats.deductions += 1;
            let mut methods = AnswerMethods::new(board, answer, None);
            return methods.set(index, other, TRIAL_CONTRADICTION);
        }
        let agreed: Vec<(usize, CellState)> = (0..board.cell_count())
            .filter_map(|cell| {
                if !answer.is_unknown(cell) {
                    return None;
                }
                let a = outcomes[0].2.state(cell);
                let b = outcomes[1].2.state(cell);
                (a == b && a != CellState::Unknown).then_some((cell, a))
            })
            .collect();
        if !agreed.is_empty() {
            stats.deductions += 1;
            let mut methods = AnswerMethods::new(board, answer, None);
            let mut result = Status::Stopped;
            for (cell, state) in agreed {
                result = merge_status(result, methods.set(cell, state, TRIAL_ANY_CASE));
            }
            return result;
        }
    }
    Status::Stopped
}

pub fn run_all(board: &Board, options: SolveOptions) -> SolveOutcome {
    let mut answer = AnswerModel::new(board);
    let mut recorder = Recorder::default();
    let mut passes = 0;
    let mut broken = false;
    let mut stats = TrialStats::default();
    let mut stalled = false;
    let mut deep_stalled = false;
    let mut level = 1u8;

    loop {
        passes += 1;
        let status = {
            let mut methods = AnswerMethods::new(board, &mut answer, Some(&mut recorder));
            solve_tier(&mut methods, level.min(options.tier))
        };
        if status == Status::Broken {
            broken = true;
            break;
        }
        if status == Status::Advanced {
            if options.max_passes > 0 && passes >= options.max_passes {
                break;
            }
            continue;
        }
        if answer.is_complete() {
            break;
        }
        if level < options.tier.min(TIER_COUNT) {
            level += 1;
            continue;
        }
        if !stalled {
            stats.pure_unknown = answer.unknown_count() as i32;
            stalled = true;
        }
        if options.no_trial {
            break;
        }
        level = level.max(LEVEL_SHALLOW_TRIAL);
        let shallow = try_solve(board, &mut answer, &mut stats, 0);
        if shallow == Status::Broken {
            broken = true;
            break;
        }
        if shallow == Status::Advanced {
            continue;
        }
        if !deep_stalled {
            stats.shallow_unknown = answer.unknown_count() as i32;
            deep_stalled = true;
        }
        if options.trial_depth == 0 {
            break;
        }
        level = LEVEL_DEEP_TRIAL;
        let deep = try_solve(board, &mut answer, &mut stats, options.trial_depth);
        if deep == Status::Broken {
            broken = true;
            break;
        }
        if deep == Status::Stopped {
            break;
        }
    }

    let status = if broken {
        SolveStatus::Broken
    } else if answer.is_complete() {
        if validate_solution(board, &answer).is_empty() {
            SolveStatus::Completed
        } else {
            SolveStatus::Broken
        }
    } else {
        SolveStatus::Stopped
    };
    let level = if status == SolveStatus::Stopped {
        LEVEL_UNSOLVED
    } else {
        level
    };
    SolveOutcome {
        status,
        level,
        answer,
        recorder,
        passes,
        stats,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_zero_room_is_solved_at_tier_one() {
        let board = Board::new(2, 1, vec![false], vec![], vec![Some(0)]).unwrap();
        let outcome = run_all(&board, SolveOptions::default());
        assert_eq!(outcome.status, SolveStatus::Completed);
        assert_eq!(outcome.level, 1);
    }
}
