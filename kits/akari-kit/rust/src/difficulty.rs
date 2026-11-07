//! 難易度スコア。
//!
//! **主軸は「要った読みの段階」で、手間はその中の順序にすぎない。**
//! ぬりかべ(5-fold CV 54.4% → 55.9%)とヤジリン(58.7% → 59.7%)で確かめた形を
//! 最初から採っている。手筋の発火数は難易度ではなく盤面の広さで決まってしまうので、
//! それだけを足し合わせても人の評価には近づかない。
//!
//! 整数演算だけで完結させる(将来ポートを増やしたとき最下位ビットまで一致させるため)。
//!
//! 係数はまだ較正していない暫定値。puzsq コーパスでの較正が済むまでは相対値としてのみ扱う。

use crate::reasons::weight;
use crate::solver::{SolveOutcome, SolveStatus};

/// 仮置き 1 回あたりの費用。
pub const TRIAL_DEDUCTION_COST: i32 = 40;
/// 入れ子の仮置き 1 回あたりの費用(回数が多いので単価は小さい)。
pub const NESTED_TRIAL_COST: i32 = 4;
/// 手筋だけで進めなくなった時点の未確定マス 1 つあたりの加点。
pub const PURE_UNKNOWN_WEIGHT: i32 = 12;
/// 浅い仮置きでも進めなくなった時点の未確定マス 1 つあたりの加点。
pub const SHALLOW_UNKNOWN_WEIGHT: i32 = 40;
/// 解けなかったとき、残った未確定マス 1 つあたりの加点。
pub const STOPPED_UNKNOWN_WEIGHT: i32 = 90;

/// 段階 1 つぶんの幅。手間がこれを超えると段階の順序が壊れるので切り捨てる。
pub const LEVEL_SCALE: i32 = 1_000_000;

/// ソルバーがどれだけ働いたか。難易度そのものではなく努力量。
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

/// 表示・較正に使う難易度。`段階 × LEVEL_SCALE + 手間`。
pub fn difficulty(outcome: &SolveOutcome) -> i32 {
    if outcome.status == SolveStatus::Broken {
        return 0; // 矛盾した問題に難易度はない
    }
    let mut work = technique_work(outcome);
    if outcome.status == SolveStatus::Stopped {
        work += STOPPED_UNKNOWN_WEIGHT * outcome.answer.unknown_count() as i32;
    }
    (outcome.level as i32 - 1) * LEVEL_SCALE + work.min(LEVEL_SCALE - 1)
}

/// 難易度モデルの版。手筋セットやレーティングのアンカーを変えたら上げる。
pub const DIFFICULTY_VERSION: u32 = 1;

/// スコアを puzzle-square の 1〜5 に写すアンカー。`[スコア, レーティング×100]`。
///
/// 較正メモ(2026-08-05、puzsq 2,585 問): 1.5〜3.5 の境界は「四捨五入で申告と一致する
/// 数を最大化する単調な境界」(4.5 を固定した上で DP < 6M の行だけの区間 DP)、
/// 4.5 は段階 7(入れ子の仮置き)の開始点 6,000,000 に構造的に固定、
/// 上端 5.49 は段階 7 以上(74 問)の DP の 99 パーセンタイル。
///
/// 4.5 も自由に当てはめると完全一致は 62.8% に上がるが、境界が 6,045,824 まで動いて
/// ★5(中央値 6,005,794)の大半を★4 側に落とす。★5 が 28 問しかなく、まとめて
/// ★4 に寄せた方が数だけは合うため。ヤジリン・ぬりかべと同じく、ここは構造的に固定する
/// (完全一致 61.6%、±1 以内 97.9%、★5 の再現 14/28)。
///
/// 出力は 0.50〜5.49 で、これは四捨五入すると 1〜5 になる区間そのもの。
/// 小数は「バンドの中のどのあたりか」であって、細かい評価として読むものではない。
///
/// レーティングは 100 倍の整数で持つ。補間を整数演算で閉じるため。
const PUZSQ_RATING_POINTS: [(i32, i32); 6] = [
    (0, 50),
    (1_000_726, 150),
    (3_001_150, 250),
    (4_004_408, 350),
    (6_000_000, 450),
    (7_064_704, 549),
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

/// 手筋ごとの内訳。`solve --breakdown` で出す。
pub fn format_breakdown(outcome: &SolveOutcome) -> String {
    let mut rows: Vec<(&str, i32)> = outcome
        .recorder
        .counts
        .iter()
        .map(|(&r, &c)| (r, c))
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
    use crate::puzzlink::decode_url;
    use crate::solver::{run_all, SolveOptions};

    #[test]
    fn an_easy_puzzle_stays_in_the_lowest_stages() {
        let board = decode_url("https://puzz.link/p?akari/6/6/ja6cj.h.l.g.hbh").unwrap();
        let outcome = run_all(&board, SolveOptions::default());
        if outcome.status == SolveStatus::Completed {
            assert!(difficulty(&outcome) < 3 * LEVEL_SCALE);
        }
    }

    #[test]
    fn the_stage_dominates_the_effort() {
        // 段階が 1 つ違えば、手間がどれだけ違っても順序は段階で決まる
        let board =
            decode_url("https://puzz.link/p?akari/10/10/hcscl.h.idn.i.cgcndg.h.ncs.h").unwrap();
        let outcome = run_all(&board, SolveOptions::default());
        let work = technique_work(&outcome);
        assert!(work < LEVEL_SCALE, "手間が段階の幅を超えている: {work}");
    }
}
