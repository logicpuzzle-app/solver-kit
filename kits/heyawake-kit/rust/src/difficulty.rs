//! 難易度スコア。整数演算だけで `段階 × LEVEL_SCALE + 手間` を作る。
//!
//! 係数は puzsq 6,890 問で較正(2026-08-07)。1 つずつ走査して 5-fold CV で
//! 採否を決めた(多パラメータの降下は過学習するのでしない)。
//! すべて 1 の暫定値から CV 59.38% → 59.97%。

use crate::reasons::weight;
use crate::solver::{SolveOutcome, SolveStatus};

pub const TRIAL_DEDUCTION_COST: i32 = 10;

/// 入れ子の仮置きの回数は難易度を説明しない。走査すると 0 が最良で、
/// 上げるほど CV が落ちた(16 以上で 58.6%)。「入れ子まで要った」ことは
/// 段階(`LEVEL_DEEP_TRIAL`)が既に表しているので、手間としては数えない。
pub const NESTED_TRIAL_COST: i32 = 0;

/// 手筋だけで進めなくなった時点の未確定マス数。**これがいちばん効く。**
/// 0 にすると CV が 57.8% まで落ちる(他はどれも 59% 台)。
/// ぬりかべ・美術館と同じ結論。
pub const PURE_UNKNOWN_WEIGHT: i32 = 20;

pub const SHALLOW_UNKNOWN_WEIGHT: i32 = 60;
pub const STOPPED_UNKNOWN_WEIGHT: i32 = 60;

pub const LEVEL_SCALE: i32 = 1_000_000;

/// 難易度モデルの版。手筋セットやレーティングのアンカーを変えたら上げる。
pub const DIFFICULTY_VERSION: u32 = 1;

/// スコアを puzzle-square の 1〜5 に写すアンカー。`[スコア, レーティング×100]`。
///
/// 較正(2026-08-07、puzsq 6,888 問)。下 3 境界は「四捨五入で申告と一致する数を
/// 最大化する単調な境界」を区間 DP で求めたもの。
///
/// **4.5 だけは他の kit と違い、構造点に固定できない。** ヤジリン・ぬりかべ・美術館は
/// 「解けない」段階の開始点に 4.5 を置いているが、へやわけの段階 7 は 1,337 問もあり、
/// その内訳は★3 が 36% / ★4 が 47% / ★5 が 11%。ここを丸ごと★5 扱いにすると
/// **★4 の 1,274/1,360 が★5 と表示され**、完全一致 52.1%・±1 以内 90.4% まで落ちる。
///
/// 逆に 4.5 も自由に当てはめると 6,056,000 まで動き、完全一致は 59.2% に上がるが
/// **★5 の再現が 1/209 に潰れる**(★5 は段階 7 の中でも少数派なので、まとめて★4 に
/// 寄せた方が数だけは合う)。
///
/// そこで中間の 6,015,000 を採る。完全一致 58.2%(自由から −1.0)、±1 以内 96.9%、
/// ★5 の再現 63/209、★4 の再現 595/1,360。トレードオフ表は README_JA.md に載せた。
///
/// 上端 5.49 は段階 7 の DP の 99 パーセンタイル。
///
/// 出力は 0.50〜5.49 で、これは四捨五入すると 1〜5 になる区間そのもの。
/// 小数は「バンドの中のどのあたりか」であって、細かい評価として読むものではない。
///
/// レーティングは 100 倍の整数で持つ。補間を整数演算で閉じるため。
const PUZSQ_RATING_POINTS: [(i32, i32); 6] = [
    (0, 50),
    (3_000_072, 150),
    (4_000_843, 250),
    (5_010_027, 350),
    (6_015_000, 450),
    (6_040_460, 549),
];

/// puzzle-square の 1〜5 での評価。100 倍の整数なので、273 は 2.73。
pub fn puzsq_rating_hundredths(score: i32) -> i32 {
    let points = PUZSQ_RATING_POINTS;
    if score <= points[0].0 {
        return points[0].1;
    }
    let last = points[points.len() - 1];
    if score >= last.0 {
        return last.1;
    }
    for i in 1..points.len() {
        let (x1, y1) = points[i];
        if score < x1 {
            let (x0, y0) = points[i - 1];
            let span = x1 - x0;
            if span <= 0 {
                return y1;
            }
            return y0 + ((score - x0) * (y1 - y0) * 2 + span) / (2 * span);
        }
    }
    last.1
}

pub fn technique_work(outcome: &SolveOutcome) -> i32 {
    let base: i32 = outcome
        .recorder
        .counts
        .iter()
        .map(|(reason, count)| weight(reason) * count)
        .sum();
    base + TRIAL_DEDUCTION_COST * outcome.stats.deductions
        + NESTED_TRIAL_COST * outcome.stats.nested_deductions
        + PURE_UNKNOWN_WEIGHT * outcome.stats.pure_unknown
        + SHALLOW_UNKNOWN_WEIGHT * outcome.stats.shallow_unknown
}

pub fn difficulty(outcome: &SolveOutcome) -> i32 {
    if outcome.status == SolveStatus::Broken {
        return 0;
    }
    let mut work = technique_work(outcome);
    if outcome.status == SolveStatus::Stopped {
        work += STOPPED_UNKNOWN_WEIGHT * outcome.answer.unknown_count() as i32;
    }
    (outcome.level as i32 - 1) * LEVEL_SCALE + work.min(LEVEL_SCALE - 1)
}

pub fn format_breakdown(outcome: &SolveOutcome) -> String {
    let mut rows: Vec<(&str, i32)> = outcome
        .recorder
        .counts
        .iter()
        .map(|(&reason, &count)| (reason, count))
        .collect();
    rows.sort_by_key(|&(reason, _)| reason);
    let mut out = format!("BREAKDOWN\n  要った読みの段階\t{}\n", outcome.level);
    for (reason, count) in rows {
        out.push_str(&format!(
            "  {reason}\tx{count}\tweight {}\tsubtotal {}\n",
            weight(reason),
            weight(reason) * count
        ));
    }
    out.push_str(&format!(
        "  仮置き\t{} 回(入れ子 {} 回)\tsubtotal {}\n",
        outcome.stats.deductions,
        outcome.stats.nested_deductions,
        TRIAL_DEDUCTION_COST * outcome.stats.deductions
            + NESTED_TRIAL_COST * outcome.stats.nested_deductions
    ));
    out.push_str(&format!(
        "  手筋だけで残った\t{} マス\tweight {PURE_UNKNOWN_WEIGHT}\tsubtotal {}\n",
        outcome.stats.pure_unknown,
        PURE_UNKNOWN_WEIGHT * outcome.stats.pure_unknown
    ));
    out.push_str(&format!(
        "  浅い仮置きで残った\t{} マス\tweight {SHALLOW_UNKNOWN_WEIGHT}\tsubtotal {}\n",
        outcome.stats.shallow_unknown,
        SHALLOW_UNKNOWN_WEIGHT * outcome.stats.shallow_unknown
    ));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::board::Board;
    use crate::solver::{run_all, SolveOptions};

    #[test]
    fn tier_one_score_stays_below_one_level() {
        let board = Board::new(2, 1, vec![false], vec![], vec![Some(0)]).unwrap();
        let outcome = run_all(&board, SolveOptions::default());
        assert!(difficulty(&outcome) < LEVEL_SCALE);
    }
}
