use crate::engine::EdgeState;
use crate::reasons::{weight, DIFFICULTY_REASONS};
use crate::solver::{SolveOutcome, SolveStatus};

/// 係数は reasons.rs の重みと同じ較正で得た値である（testdata/CALIBRATION_JA.md）。
/// 較正が最も強く重みを与えたのがこの2つ、すなわち「どれだけ先読みを強いられるか」だった。
pub const TRIAL_DEDUCTION_WEIGHT: i32 = 47;
pub const MAX_TRIAL_COUNT_WEIGHT: i32 = 597;
/// 手筋切れ自体と、停止時に残った未確定辺へ与える較正済みの重み。
/// 実際の難易度表示と較正の初期値がずれないよう、このモジュールだけで定義する。
pub const STOPPED_PENALTY: i32 = 6;
pub const STOPPED_UNKNOWN_WEIGHT: i32 = 102;

/// DP がセル数に従って増える度合いを、人手評価つきコーパス 1,585 問で実測した指数。
/// DPN は `DP / セル数^指数`。対数上では `log(DP) - 指数 × log(セル数)` にあたる。
///
/// 0 ヒント率の補正と STOPPED 項を実表示へ揃えたうえで、重みと境界を
/// 同じ固定指数 0.1929 で較正する。指数を較正中に動かすと、表示時の
/// DPN と目的関数が再びずれるため、診断用の指数探索とは分離する。
pub const DPN_SIZE_EXPONENT: f64 = 0.1929;

/// STOPPED の追加点を実表示と較正で共有する。
/// 較正中は候補重みが大きくなるため、積を i64 のまま返して桁あふれを防ぐ。
pub fn stopped_adjustment(
    stopped: bool,
    unknown_edges: i32,
    stopped_penalty: i32,
    stopped_unknown_weight: i32,
) -> i64 {
    if stopped {
        i64::from(stopped_penalty)
            + i64::from(unknown_edges) * i64::from(stopped_unknown_weight)
    } else {
        0
    }
}

/// 最終盤面から未確定辺を数え、較正用の特徴量と実表示で同じ値を使う。
pub fn unknown_edge_count(outcome: &SolveOutcome) -> i32 {
    outcome
        .answer
        .edges()
        .iter()
        .filter(|&&state| state == EdgeState::Unknown)
        .count()
        .min(i32::MAX as usize) as i32
}

pub fn difficulty(outcome: &SolveOutcome) -> i32 {
    let base: i64 = outcome
        .recorder
        .counts
        .iter()
        .map(|(reason, count)| i64::from(weight(reason)) * i64::from(*count))
        .sum();
    let score = base
        + i64::from(TRIAL_DEDUCTION_WEIGHT)
            * i64::from(outcome.stats.trial_deductions)
        + i64::from(MAX_TRIAL_COUNT_WEIGHT)
            * i64::from(outcome.stats.max_trial_count)
            * i64::from(outcome.stats.max_trial_count)
        + stopped_adjustment(
            outcome.status == SolveStatus::Stopped,
            unknown_edge_count(outcome),
            STOPPED_PENALTY,
            STOPPED_UNKNOWN_WEIGHT,
        );
    // 公開APIの i32 は維持しつつ、途中計算は i64 にして STOPPED 項の積で
    // 符号反転した難易度を返さないようにする。
    i32::try_from(score).expect("DP が i32 の範囲を超えました")
}

/// 従来の DP を変えず、盤面サイズによる増加分だけを除いた正規化難易度を返す。
/// 0 点は 0 のままとし、空でない盤面だけを受け付けることで常に有限値にする。
/// 0 のヒントが多い盤面ほど、スコアが人手評価より高く出る。人手評価つき 1,575 問で
/// 測ると、0 がヒントの 30% 以上を占める問題では過大評価率が 8.8% と、全体の倍以上あった。
///
/// 0 は周囲 4 辺を一度に × にでき、隣り合うと効果が連鎖する。人はこれを一目で片付けるが、
/// ソルバーは zero_cell を 1 回、頂点の次数を 4 回…と発火回数を積み上げてスコアに計上する。
/// **視覚的に一瞬で終わる操作ほど、発火回数としては膨らむ**。その乖離を補正する。
///
/// 補正は `exp(-0.70 × 0の割合)`。係数は 5-fold 交差検証で確認しており、
/// 訓練 0.728 に対し検証 0.725（差 0.003）と過学習していない。
/// 補正なしの検証相関 0.717 から 0.725 へ改善する。
pub const ZERO_CLUE_DISCOUNT: f64 = 0.70;

/// ヒントに占める 0 の割合から、上記の補正倍率を返す。
pub fn zero_clue_factor(zero_clues: usize, total_clues: usize) -> f64 {
    if total_clues == 0 {
        return 1.0;
    }
    let ratio = zero_clues as f64 / total_clues as f64;
    (-ZERO_CLUE_DISCOUNT * ratio).exp()
}

/// 盤面のヒント数と、そのうち 0 であるヒント数を数える。
/// 負の値はヒントなしを表すため、分母へ含めない。
pub fn clue_counts(clues: &[i8]) -> (usize, usize) {
    let total_clues = clues.iter().filter(|&&clue| clue >= 0).count();
    let zero_clues = clues.iter().filter(|&&clue| clue == 0).count();
    (zero_clues, total_clues)
}

/// 従来の DP を変えず、サイズと 0 ヒント率を補正した DPN を返す。
/// 実表示・生成・較正はすべてこの関数を通し、補正式の分岐を防ぐ。
pub fn normalized_difficulty(
    score: i64,
    cell_count: usize,
    zero_clues: usize,
    total_clues: usize,
) -> f64 {
    normalized_difficulty_with_exponent(
        score,
        cell_count,
        DPN_SIZE_EXPONENT,
        zero_clues,
        total_clues,
    )
}

/// 指数候補の分析でも、実 DPN と同じ 0 ヒント補正を共有する。
pub(crate) fn normalized_difficulty_with_exponent(
    score: i64,
    cell_count: usize,
    exponent: f64,
    zero_clues: usize,
    total_clues: usize,
) -> f64 {
    assert!(cell_count > 0, "DPN の計算には1セル以上必要");
    score as f64 / (cell_count as f64).powf(exponent)
        * zero_clue_factor(zero_clues, total_clues)
}

pub fn format_breakdown(outcome: &SolveOutcome) -> String {
    let mut output = String::from("BREAKDOWN\n");
    for spec in DIFFICULTY_REASONS {
        let count = outcome
            .recorder
            .counts
            .get(spec.reason)
            .copied()
            .unwrap_or(0);
        if count == 0 {
            continue;
        }
        let reason_weight = weight(spec.reason);
        output.push_str(&format!(
            "  {}: count={} weight={} subtotal={}\n",
            spec.reason,
            count,
            reason_weight,
            reason_weight * count
        ));
    }
    output.push_str(&format!(
        "  仮置き手数: count={} weight={} subtotal={}\n",
        outcome.stats.trial_deductions,
        TRIAL_DEDUCTION_WEIGHT,
        outcome.stats.trial_deductions * TRIAL_DEDUCTION_WEIGHT
    ));
    output.push_str(&format!(
        "  最深仮置き伝播²: value={}² weight={} subtotal={}\n",
        outcome.stats.max_trial_count,
        MAX_TRIAL_COUNT_WEIGHT,
        outcome.stats.max_trial_count
            * outcome.stats.max_trial_count
            * MAX_TRIAL_COUNT_WEIGHT
    ));
    if outcome.status == SolveStatus::Stopped {
        let unknown_edges = unknown_edge_count(outcome);
        output.push_str(&format!(
            "  手詰まり罰点: weight={} subtotal={}\n",
            STOPPED_PENALTY, STOPPED_PENALTY
        ));
        output.push_str(&format!(
            "  未確定辺 {} 本 × {}: subtotal={}\n",
            unknown_edges,
            STOPPED_UNKNOWN_WEIGHT,
            unknown_edges * STOPPED_UNKNOWN_WEIGHT
        ));
    }
    output.push_str(&format!("  TOTAL: {}\n", difficulty(outcome)));
    output
}

/// DPN の境界は、**推定の分布が人手評価の分布に一致する分位点**として引いてある。
/// 隣接クラスの誤分類を最小にする引き方（一致 60.5%）も試したが、それだと ★5 の出力が
/// 1,575 問中 1 件しか出ず、最上位の評価が事実上使えなくなる。分位点で引くと
/// 一致 58.5% とほぼ同等のまま、★1〜★5 の件数が実データと一致する（分布のずれ 0.000）。
///
/// パズルスクエアの人手評価（★1〜★5）との対応は
/// easy=★1 / medium=★2 / hard=★3 / expert=★4 / fiendish=★5。
/// intro は ★1 の中でも特に易しい側を切り出したもので、人手評価には対応する階級がない。
/// ★5 は 36 問しかないため、最上位の境界は根拠が薄い。
///
/// バンドの上限と名前。値を2箇所に書くと必ずずれる（実際、分析スクリプトが古い境界を
/// 使って一致率を誤って集計する事故が起きた）ので、ここを唯一の定義とする。
pub const BAND_THRESHOLDS: [(f64, &str); 6] = [
    (132.0, "intro"),
    (396.0, "easy"),
    (1145.0, "medium"),
    (2412.0, "hard"),
    (7948.0, "expert"),
    (f64::INFINITY, "fiendish"),
];

pub fn band(score: f64) -> &'static str {
    for &(upper_bound, name) in &BAND_THRESHOLDS {
        if score < upper_bound {
            return name;
        }
    }
    BAND_THRESHOLDS[BAND_THRESHOLDS.len() - 1].1
}

/// 移行時の比較用に、旧来の絶対 DP バンドをそのまま残す。
pub fn band_absolute(score: i32) -> &'static str {
    match score {
        ..513 => "intro",
        513..1704 => "easy",
        1704..3363 => "medium",
        3363..5335 => "hard",
        5335..15590 => "expert",
        _ => "fiendish",
    }
}

pub fn is_band_name(name: &str) -> bool {
    matches!(
        name,
        "intro" | "easy" | "medium" | "hard" | "expert" | "fiendish"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn absolute_band_keeps_the_previous_boundaries() {
        assert_eq!(band_absolute(512), "intro");
        assert_eq!(band_absolute(513), "easy");
        assert_eq!(band_absolute(15_590), "fiendish");
    }

    #[test]
    fn normalized_score_is_zero_when_dp_is_zero() {
        assert_eq!(normalized_difficulty(0, 100, 3, 10), 0.0);
    }

    #[test]
    fn clue_counts_ignore_cells_without_clues() {
        assert_eq!(clue_counts(&[0, 1, -1, 0, -2, 3]), (2, 4));
    }

    #[test]
    fn normalized_score_applies_zero_clue_factor() {
        let without_zeroes = normalized_difficulty(1_000, 100, 0, 10);
        let with_zeroes = normalized_difficulty(1_000, 100, 5, 10);
        assert!(
            (with_zeroes / without_zeroes - zero_clue_factor(5, 10)).abs()
                < 1e-12
        );
    }

    #[test]
    fn normalized_band_uses_calibrated_boundaries() {
        assert_eq!(band(131.999), "intro");
        assert_eq!(band(132.0), "easy");
        assert_eq!(band(395.999), "easy");
        assert_eq!(band(396.0), "medium");
        assert_eq!(band(7_948.0), "fiendish");
    }

    #[test]
    fn stopped_adjustment_adds_penalty_and_unknown_edges() {
        assert_eq!(stopped_adjustment(true, 13, 100, 3), 139);
        assert_eq!(stopped_adjustment(false, 13, 100, 3), 0);
    }
}
