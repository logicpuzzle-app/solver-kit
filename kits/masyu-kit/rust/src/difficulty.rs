//! 難易度。主軸は「その問題を解くのに要った読みの段階」で、
//! 手間(手筋の発火数)は同じ段階の中で順序をつけるためだけに使う。
//! 整数演算だけで閉じる(将来のポート間ビット一致のため)。
//!
//! 係数は 2026-08-05 の走査(fit_weights.py、2,713 問)で確認済み。
//! どの係数も CV が ±0.5pt の平坦な高原で、動かす根拠がなかったので
//! 初期値のまま。詳細は README_JA.md。

use crate::reasons::weight;
use crate::solver::{SolveOutcome, SolveStatus};

pub const TRIAL_DEDUCTION_COST: i32 = 40;
pub const NESTED_TRIAL_COST: i32 = 4;
pub const PURE_UNKNOWN_WEIGHT: i32 = 12;
pub const SHALLOW_UNKNOWN_WEIGHT: i32 = 40;
pub const STOPPED_UNKNOWN_WEIGHT: i32 = 90;
pub const LEVEL_SCALE: i32 = 1_000_000;
/// v2 = 仮置きの入れ子を深さ 2 に(手詰まり 11 問 → 0 問)。2,704 問で再較正。
pub const DIFFICULTY_VERSION: u32 = 2;

pub fn technique_work(outcome: &SolveOutcome) -> i32 {
    let mut work = 0;
    for (&reason, &count) in &outcome.recorder.counts {
        work += weight(reason) * count;
    }
    work += TRIAL_DEDUCTION_COST * outcome.stats.deductions;
    work += NESTED_TRIAL_COST * outcome.stats.nested_deductions;
    work += PURE_UNKNOWN_WEIGHT * outcome.stats.pure_unknown;
    work += SHALLOW_UNKNOWN_WEIGHT * outcome.stats.shallow_unknown;
    work
}

pub fn difficulty(outcome: &SolveOutcome) -> i32 {
    if outcome.status == SolveStatus::Broken {
        return 0;
    }
    let mut work = technique_work(outcome);
    if outcome.status == SolveStatus::Stopped {
        work += STOPPED_UNKNOWN_WEIGHT * outcome.answer.unknown_count() as i32;
    }
    (i32::from(outcome.level) - 1) * LEVEL_SCALE + work.min(LEVEL_SCALE - 1)
}

/// (スコア, レーティング×100)。
///
/// 中間 3 点は 2026-08-05 の較正(v2、2,704 問)で一致数を最大化したバンド閾値。
/// ★4.5 のアンカーは「解けない」段階の開始点 6,000,000 に構造的に固定する
/// (美術館と同じ理屈。自由に当てはめると ★5 の再現が縮退する。実際 v2 の
/// 自由な当てはめは ★4|5 境界を 5,047,136 に置き、★5 の 14 問中 13 問を
/// ★4 側に飲み込んだ)。
const PUZSQ_RATING_POINTS: [(i32, i32); 6] = [
    (0, 50),
    (1_000_075, 150),
    (4_001_457, 250),
    (5_006_869, 350),
    (6_000_000, 450),
    (7_000_000, 549),
];

/// レーティングを 1/100 単位の整数で返す(50〜549)。
pub fn puzsq_rating_hundredths(score: i32) -> i32 {
    let points = &PUZSQ_RATING_POINTS;
    if score <= points[0].0 {
        return points[0].1;
    }
    for pair in points.windows(2) {
        let (x0, y0) = pair[0];
        let (x1, y1) = pair[1];
        if score <= x1 {
            let span = x1 - x0;
            let num = (score - x0) as i64 * (y1 - y0) as i64 * 2 + span as i64;
            return y0 + (num / (2 * span as i64)) as i32;
        }
    }
    points[points.len() - 1].1
}

pub fn format_breakdown(outcome: &SolveOutcome) -> String {
    let mut lines = vec!["BREAKDOWN".to_string()];
    let mut reasons: Vec<(&str, i32)> = outcome
        .recorder
        .counts
        .iter()
        .map(|(&reason, &count)| (reason, count))
        .collect();
    reasons.sort();
    for (reason, count) in reasons {
        lines.push(format!(
            "  {} x{} / {} / {}",
            reason,
            count,
            weight(reason),
            weight(reason) * count
        ));
    }
    lines.push(format!(
        "  仮置き x{} / {} / {}",
        outcome.stats.deductions,
        TRIAL_DEDUCTION_COST,
        TRIAL_DEDUCTION_COST * outcome.stats.deductions
    ));
    lines.push(format!(
        "  入れ子仮置き x{} / {} / {}",
        outcome.stats.nested_deductions,
        NESTED_TRIAL_COST,
        NESTED_TRIAL_COST * outcome.stats.nested_deductions
    ));
    lines.push(format!(
        "  手筋切れ残り {} / {} / {}",
        outcome.stats.pure_unknown,
        PURE_UNKNOWN_WEIGHT,
        PURE_UNKNOWN_WEIGHT * outcome.stats.pure_unknown
    ));
    lines.push(format!(
        "  浅い仮置き切れ残り {} / {} / {}",
        outcome.stats.shallow_unknown,
        SHALLOW_UNKNOWN_WEIGHT,
        SHALLOW_UNKNOWN_WEIGHT * outcome.stats.shallow_unknown
    ));
    lines.join("\n")
}
