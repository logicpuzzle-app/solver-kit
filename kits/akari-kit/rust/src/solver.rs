//! 手筋ソルバーのドライバ。
//!
//! **安い段階から始めて、止まったら 1 段ずつ上げる。** 到達した最大の段階が、
//! その問題に要った読みの深さで、それが難易度の主軸になる
//! (ぬりかべ・ヤジリンで確立した形。人は「どこまでの読みが要る問題か」で難しさを言う)。
//!
//! 段階を上げる順にすることには実利もある。易しい問題では重い手筋を一度も回さずに済む。

use crate::answer_methods::{merge_status, AnswerMethods, Recorder};
use crate::answer_model::{AnswerModel, CellState};
use crate::board::Board;
use crate::reasons::{TRIAL_ANY_CASE, TRIAL_CONTRADICTION};
use crate::solution::validate_solution;
use crate::status::Status;
use crate::techniques::clue::clue;
use crate::techniques::clue_cases::clue_cases;
use crate::techniques::lamp_conflict::lamp_conflict;
use crate::techniques::lamp_ray::lamp_ray;
use crate::techniques::only_source::only_source;
use crate::techniques::source_cases::source_cases;

type Technique = fn(&mut AnswerMethods<'_>) -> Status;

/// 読みの段階。人が「どこまでの読みが要るか」で難しさを言うのに合わせた区分。
///
/// 1. 数字まわりと相互照射禁。目で見てすぐ分かるもの
/// 2. 救出。まだ照らされていないマスから逆に決める
/// 3. 置いてみて破綻するか。カタログの「数字どうしの相互作用」はここに畳んである
/// 4. 数字まわりの場合分け。置き方を全部並べて、共通するマスを取る
/// 5. 照らし手の場合分け。「このマスを照らすのは誰か」で分けて共通部分を取る
pub const TIER_COUNT: u8 = 5;
pub const LEVEL_SHALLOW_TRIAL: u8 = TIER_COUNT + 1;
pub const LEVEL_DEEP_TRIAL: u8 = TIER_COUNT + 2;
pub const LEVEL_UNSOLVED: u8 = TIER_COUNT + 3;

/// 仮置きの中で回す手筋。仮置きは何百回も走るので、重いものは外す。
const FAST_TECHNIQUES: [Technique; 3] = [clue, lamp_ray, only_source];

fn techniques_for_tier(tier: u8) -> &'static [Technique] {
    const T1: [Technique; 2] = [clue, lamp_ray];
    const T2: [Technique; 3] = [clue, lamp_ray, only_source];
    const T3: [Technique; 4] = [clue, lamp_ray, only_source, lamp_conflict];
    const T4: [Technique; 5] = [clue, lamp_ray, only_source, lamp_conflict, clue_cases];
    const T5: [Technique; 6] = [
        clue,
        lamp_ray,
        only_source,
        lamp_conflict,
        clue_cases,
        source_cases,
    ];
    match tier {
        1 => &T1,
        2 => &T2,
        3 => &T3,
        4 => &T4,
        _ => &T5,
    }

}

/// `trace` 用の名前つき一覧。
pub fn technique_list() -> Vec<(&'static str, Technique)> {
    vec![
        ("clue", clue as Technique),
        ("lamp_ray", lamp_ray),
        ("only_source", only_source),
        ("lamp_conflict", lamp_conflict),
        ("clue_cases", clue_cases),
        ("source_cases", source_cases),
    ]
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SolveStatus {
    /// 全マスが確定し、ルール検証も通った。
    Completed,
    /// 手が尽きた。
    Stopped,
    /// 矛盾が見つかった。
    Broken,
}

#[derive(Clone, Debug)]
pub struct SolveOptions {
    /// 0 なら無制限。
    pub max_passes: i32,
    /// 仮置きを使わない。
    pub no_trial: bool,
    /// 使う手筋の段階(1..=TIER_COUNT)。
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

/// 仮置きで測った手間。難易度スコアに使う。
#[derive(Clone, Copy, Debug, Default)]
pub struct TrialStats {
    /// 仮置きで確定させた回数。
    pub deductions: i32,
    /// 入れ子の仮置きで確定させた回数(捨てた枝のぶんも含む努力量)。
    pub nested_deductions: i32,
    /// 手筋だけで進めなくなった時点の未確定マス数。
    pub pure_unknown: i32,
    /// 浅い仮置きでも進めなくなった時点の未確定マス数。
    pub shallow_unknown: i32,
}

pub struct SolveOutcome {
    pub status: SolveStatus,
    /// 要った読みの段階(1..=LEVEL_UNSOLVED)。
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

/// 段階を絞って 1 巡する。
pub fn solve_tier(answer: &mut AnswerMethods<'_>, tier: u8) -> Status {
    run(answer, techniques_for_tier(tier))
}

/// 仮置きした盤面を、手筋だけで収束するまで進める。Recorder は渡さない
/// (仮置きの中で発火した手筋は難易度に数えない)。
fn propagate_trial(
    board: &Board,
    answer: &mut AnswerModel,
    depth: i32,
    stats: &mut TrialStats,
) -> Status {
    loop {
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
            return Status::Stopped;
        }
    }
}

/// 未確定マスを 1 つずつ両方の状態で試す。
/// 片方が矛盾すれば他方が確定、両方生き残っても一致する確定は取り込める。
fn try_solve(board: &Board, answer: &mut AnswerModel, stats: &mut TrialStats, depth: i32) -> Status {
    // 確定済みマスかかべに接している未確定マスだけを試す。情報のない場所を
    // 試しても伝播が起きず、時間だけ食う。
    let targets: Vec<usize> = (0..board.cell_count())
        .filter(|&i| {
            answer.is_unknown(i)
                && board
                    .neighbours(i)
                    .iter()
                    .any(|&n| board.is_wall(n) || !answer.is_unknown(n))
        })
        .collect();

    for index in targets {
        if !answer.is_unknown(index) {
            continue;
        }
        let mut outcomes = Vec::new();
        for state in [CellState::Lamp, CellState::Empty] {
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
        if broken.iter().all(|&b| b) {
            return Status::Broken;
        }
        if let Some(at) = broken.iter().position(|&b| b) {
            // 片方が矛盾 → 他方が確定
            let other = outcomes[1 - at].0;
            stats.deductions += 1;
            let mut methods = AnswerMethods::new(board, answer, None);
            return methods.set(index, other, TRIAL_CONTRADICTION);
        }
        // 両方生き残った。どちらでも同じになったマスは取り込める。
        let agreed: Vec<(usize, CellState)> = (0..board.cell_count())
            .filter_map(|i| {
                if !answer.is_unknown(i) {
                    return None;
                }
                let a = outcomes[0].2.state(i);
                let b = outcomes[1].2.state(i);
                (a == b && a != CellState::Unknown).then_some((i, a))
            })
            .collect();
        if !agreed.is_empty() {
            stats.deductions += 1;
            let mut methods = AnswerMethods::new(board, answer, None);
            let mut result = Status::Stopped;
            for (i, state) in agreed {
                result = merge_status(result, methods.set(i, state, TRIAL_ANY_CASE));
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
    let mut level: u8 = 1;

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
        // 全部埋まっているなら段階を上げる必要はない。
        // (埋まった盤面はどの手筋も Stopped を返すので、これが無いと
        //  易しい問題まで最上段まで登ってしまう)
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
        // 全確定でもルールを満たしていなければ矛盾。検証は独立実装を使う。
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
    fn the_cspuz_fixture_is_solved() {
        let board =
            decode_url("https://puzz.link/p?akari/10/10/hcscl.h.idn.i.cgcndg.h.ncs.h").unwrap();
        let outcome = run_all(&board, SolveOptions::default());
        assert_eq!(outcome.status, SolveStatus::Completed);
        assert!(validate_solution(&board, &outcome.answer).is_empty());
    }

    #[test]
    fn an_easy_puzzle_does_not_climb_to_the_top_tier() {
        // 1x2: [白][1のかべ] — 数字まわりだけで決まる。
        // (1x3 の [白][1][白] は解が無い。両端とも自分でしか照らせないので
        //  照明が 2 つ要るのに数字が 1。最小例を作るときの落とし穴)
        let board = crate::board::Board::new(2, 1, vec![crate::board::OPEN, 1]).unwrap();
        let outcome = run_all(&board, SolveOptions::default());
        assert_eq!(outcome.status, SolveStatus::Completed);
        assert!(outcome.level <= 2, "段階 {} まで登ってしまった", outcome.level);
    }
}
