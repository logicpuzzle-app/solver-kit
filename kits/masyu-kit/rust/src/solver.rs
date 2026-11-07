//! 段階エスカレーション + 仮置き。
//!
//! 安い段階から始めて、止まったら 1 段ずつ上げる。到達した最大の段階が
//! 「その問題を解くのに最低限必要な手筋の集合」になり、難易度の主軸になる。

use crate::answer_methods::{merge_status, AnswerMethods, Recorder};
use crate::answer_model::{AnswerModel, EdgeState};
use crate::board::Board;
use crate::reasons::{TRIAL_ANY_CASE, TRIAL_CONTRADICTION};
use crate::solution::validate_solution;
use crate::status::Status;
use crate::techniques::connectivity::connectivity;
use crate::techniques::cut_parity::cut_parity;
use crate::techniques::degree::degree;
use crate::techniques::pearl_basic::pearl_basic;
use crate::techniques::pearl_cases::pearl_cases;
use crate::techniques::region_parity::region_parity;
use crate::techniques::small_loop_ban::small_loop_ban;
use crate::techniques::white_neighbours::white_neighbours;

type Technique = fn(&mut AnswerMethods<'_>) -> Status;

pub const TIER_COUNT: u8 = 4;
pub const LEVEL_SHALLOW_TRIAL: u8 = TIER_COUNT + 1;
pub const LEVEL_DEEP_TRIAL: u8 = TIER_COUNT + 2;
pub const LEVEL_UNSOLVED: u8 = TIER_COUNT + 3;

/// 仮置きの中で回す手筋。大域 3 種(連結性・カット偶奇・領域の出入り)も
/// 入れてある。ましゅの終盤は大域の読みで矛盾が出ることが多く、
/// これを外すと仮置きの反証力が大きく落ちる(v2→v3 の計測で確認)。
const FAST_TECHNIQUES: [Technique; 7] = [
    degree,
    pearl_basic,
    white_neighbours,
    small_loop_ban,
    connectivity,
    cut_parity,
    region_parity,
];

const TIER1: [Technique; 2] = [degree, pearl_basic];
const TIER2: [Technique; 4] = [degree, pearl_basic, white_neighbours, small_loop_ban];
const TIER3: [Technique; 7] = [
    degree,
    pearl_basic,
    white_neighbours,
    small_loop_ban,
    connectivity,
    cut_parity,
    region_parity,
];
const TIER4: [Technique; 8] = [
    degree,
    pearl_basic,
    white_neighbours,
    small_loop_ban,
    connectivity,
    cut_parity,
    region_parity,
    pearl_cases,
];

fn techniques_for_tier(tier: u8) -> &'static [Technique] {
    match tier {
        0 | 1 => &TIER1,
        2 => &TIER2,
        3 => &TIER3,
        _ => &TIER4,
    }
}

/// trace 用の名前つき一覧。
pub fn technique_list() -> Vec<(&'static str, Technique)> {
    vec![
        ("degree", degree),
        ("pearl_basic", pearl_basic),
        ("white_neighbours", white_neighbours),
        ("small_loop_ban", small_loop_ban),
        ("connectivity", connectivity),
        ("cut_parity", cut_parity),
        ("region_parity", region_parity),
        ("pearl_cases", pearl_cases),
    ]
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SolveStatus {
    Completed,
    Stopped,
    Broken,
}

pub struct SolveOptions {
    /// 0 は無制限。
    pub max_passes: i32,
    pub no_trial: bool,
    pub tier: u8,
    pub trial_depth: i32,
}

impl Default for SolveOptions {
    fn default() -> Self {
        SolveOptions {
            max_passes: 0,
            no_trial: false,
            tier: TIER_COUNT,
            // 深さ 1 では手詰まり 10 問が残り、2 に上げると全部解ける
            // (0.1〜35 秒)。testdata/STUCK_JA.md 参照。
            trial_depth: 2,
        }
    }
}

#[derive(Default, Clone, Copy)]
pub struct TrialStats {
    /// 仮置きで矛盾を見つけて確定した回数。
    pub deductions: i32,
    /// 入れ子の仮置きで確定した回数。
    pub nested_deductions: i32,
    /// 手筋が最初に尽きた時点の未確定辺数。
    pub pure_unknown: i32,
    /// 浅い仮置きも尽きた時点の未確定辺数。
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
    for technique in techniques {
        result = merge_status(result, technique(answer));
        if result == Status::Broken {
            return result;
        }
    }
    result
}

pub fn solve_tier(answer: &mut AnswerMethods<'_>, tier: u8) -> Status {
    run(answer, techniques_for_tier(tier))
}

/// 仮置き盤面を軽い手筋だけで収束させる。確定は記録しない。
fn propagate_trial(
    board: &Board,
    answer: &mut AnswerModel,
    depth: i32,
    stats: &mut TrialStats,
) -> Status {
    loop {
        let mut methods = AnswerMethods::new(board, answer, None);
        match run(&mut methods, &FAST_TECHNIQUES) {
            Status::Broken => return Status::Broken,
            Status::Advanced => continue,
            Status::Stopped => {}
        }
        if depth > 0 {
            match try_solve(board, answer, stats, depth - 1, true) {
                Status::Broken => return Status::Broken,
                Status::Advanced => continue,
                Status::Stopped => {}
            }
        }
        return Status::Stopped;
    }
}

/// 仮置き。線の近くの未定辺だけを対象に、線と × の両方を試す。
/// 片方が破綻すればもう片方に確定、両方生き残れば一致する辺を取り込む。
/// 1 つ決まったら即 return する(次のパスでまた安い手筋から回すため)。
fn try_solve(
    board: &Board,
    answer: &mut AnswerModel,
    stats: &mut TrialStats,
    depth: i32,
    nested: bool,
) -> Status {
    let mut candidates: Vec<usize> = (0..board.edge_count())
        .filter(|&e| answer.is_unknown(e))
        .filter(|&e| {
            let [a, b] = board.edge_cells(e);
            answer.line_count(a) > 0
                || answer.line_count(b) > 0
                || board.is_pearl(a)
                || board.is_pearl(b)
        })
        .collect();
    // 丸も線もない盤面(丸ゼロの問題)では候補が空になる。任意の未定辺で始める。
    if candidates.is_empty() {
        candidates.extend((0..board.edge_count()).find(|&e| answer.is_unknown(e)));
    }

    for edge in candidates {
        if !answer.is_unknown(edge) {
            continue;
        }
        let mut as_line = answer.clone_for_trial();
        let line_status = match as_line.set(board, edge, EdgeState::Line) {
            Ok(_) => propagate_trial(board, &mut as_line, depth, stats),
            Err(_) => Status::Broken,
        };
        let mut as_bar = answer.clone_for_trial();
        let bar_status = match as_bar.set(board, edge, EdgeState::Bar) {
            Ok(_) => propagate_trial(board, &mut as_bar, depth, stats),
            Err(_) => Status::Broken,
        };

        match (line_status, bar_status) {
            (Status::Broken, Status::Broken) => return Status::Broken,
            (Status::Broken, _) => {
                let mut methods = AnswerMethods::new(board, answer, None);
                let status = methods.set(edge, EdgeState::Bar, TRIAL_CONTRADICTION);
                bump(stats, nested);
                return status;
            }
            (_, Status::Broken) => {
                let mut methods = AnswerMethods::new(board, answer, None);
                let status = methods.set(edge, EdgeState::Line, TRIAL_CONTRADICTION);
                bump(stats, nested);
                return status;
            }
            _ => {
                // 両方生き残った。どちらでも同じに決まる辺を取り込む。
                let mut agreed: Vec<(usize, EdgeState)> = Vec::new();
                for e in 0..board.edge_count() {
                    if !answer.is_unknown(e) {
                        continue;
                    }
                    let s1 = as_line.edge(e);
                    if s1 != EdgeState::Unknown && s1 == as_bar.edge(e) {
                        agreed.push((e, s1));
                    }
                }
                if !agreed.is_empty() {
                    let mut methods = AnswerMethods::new(board, answer, None);
                    let mut status = Status::Stopped;
                    for (e, state) in agreed {
                        status = merge_status(status, methods.set(e, state, TRIAL_ANY_CASE));
                        if status == Status::Broken {
                            return status;
                        }
                    }
                    bump(stats, nested);
                    return status;
                }
            }
        }
    }
    Status::Stopped
}

fn bump(stats: &mut TrialStats, nested: bool) {
    if nested {
        stats.nested_deductions += 1;
    } else {
        stats.deductions += 1;
    }
}

pub fn run_all(board: &Board, options: SolveOptions) -> SolveOutcome {
    let mut answer = AnswerModel::new(board);
    let mut recorder = Recorder::default();
    let mut stats = TrialStats::default();
    let mut passes = 0;
    let mut level: u8 = 1;
    let mut broken = false;
    let mut stalled = false;
    let mut deep_stalled = false;
    let tier_cap = options.tier.min(TIER_COUNT);

    loop {
        passes += 1;
        let status = {
            let mut methods = AnswerMethods::new(board, &mut answer, Some(&mut recorder));
            solve_tier(&mut methods, level.min(tier_cap))
        };
        match status {
            Status::Broken => {
                broken = true;
                break;
            }
            Status::Advanced => {
                if options.max_passes > 0 && passes >= options.max_passes {
                    break;
                }
                continue;
            }
            Status::Stopped => {}
        }
        // 段階を上げる前に完成を見る。解き終わった盤面はどの手筋も
        // Stopped を返すので、これがないと易しい問題が最上段まで登る。
        if answer.is_complete(board) {
            break;
        }
        if level < tier_cap {
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
        match try_solve(board, &mut answer, &mut stats, 0, false) {
            Status::Broken => {
                broken = true;
                break;
            }
            Status::Advanced => continue,
            Status::Stopped => {}
        }
        if !deep_stalled {
            stats.shallow_unknown = answer.unknown_count() as i32;
            deep_stalled = true;
        }
        if options.trial_depth == 0 {
            break;
        }
        level = LEVEL_DEEP_TRIAL;
        match try_solve(board, &mut answer, &mut stats, options.trial_depth, false) {
            Status::Broken => {
                broken = true;
                break;
            }
            Status::Advanced => continue,
            Status::Stopped => break,
        }
    }

    let status = if broken {
        SolveStatus::Broken
    } else if answer.is_complete(board) {
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
    use crate::puzzlink::decode_url;

    #[test]
    fn solves_the_pzprjs_sample() {
        let board = decode_url("mashu/6/6/1063000i3000").unwrap();
        let outcome = run_all(&board, SolveOptions::default());
        assert_eq!(outcome.status, SolveStatus::Completed);
    }

    #[test]
    fn a_solved_puzzle_is_not_marked_unsolved() {
        // 解けた問題の段階が UNSOLVED に化けないこと(完成判定の退行ガード)。
        let board = decode_url("mashu/6/6/1063000i3000").unwrap();
        let outcome = run_all(&board, SolveOptions::default());
        assert!(outcome.level < LEVEL_UNSOLVED, "level = {}", outcome.level);
    }
}
