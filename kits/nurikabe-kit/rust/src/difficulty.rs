//! 難易度スコア。
//!
//! 手筋の重みの合計に、仮置きの手間を足す。仮置きが支配的になるのは意図的で、
//! 「仮置きなしでは解けない問題」を人は難しいと呼ぶため。
//!
//! ヤジリン・スリザーリンクと同じ設計:
//! - 整数演算だけで完結させる(将来ポートを増やしたとき最下位ビットまで一致させるため)
//! - 手筋切れは別スケールへ持ち上げる(`unfinished_base`)。努力量で測ると、
//!   手が尽きてほとんど働かずに止まった最難問が最低スコアになってしまう
//!
//! 係数はまだ較正していない暫定値。puzsq コーパスでの較正が済むまでは相対値としてのみ扱う。

use crate::reasons::weight;
use crate::solver::{SolveOutcome, SolveStatus};

/// 仮置き 1 回あたりの費用。
pub const TRIAL_DEDUCTION_COST: i32 = 40;
/// 仮置きの深さの費用(深さの 2 乗にかかる)。
///
/// 難易度の主軸を「要った読みの段階」にしたことで、深さはそちらが表すようになった。
/// 較正でも 0 が最良だったので 0 にしてある(この項は事実上なくなった)。
pub const TRIAL_DEPTH_COST: i32 = 0;

/// 入れ子の仮置き 1 回あたりの費用。較正で 4 に落ち着いた
/// (回数が多いので単価は小さくてよい)。
pub const NESTED_TRIAL_COST: i32 = 4;

/// 浅い仮置き(入れ子なし)で進めなくなった時点の未確定マス 1 つあたりの加点。
///
/// `PURE_UNKNOWN_WEIGHT` の一段上。手筋 → 浅い仮置き → 深い仮置き の
/// どの段階でどこまで行けたか、という形で難易度を測っている。
pub const SHALLOW_UNKNOWN_WEIGHT: i32 = 40;

/// 段階 1 つぶんの幅。同じ段階の中の順序は手間の合計でつける。
///
/// **難易度の主軸は「要った読みの段階」で、手間はその中の順序にすぎない。**
/// これは人間の言い方に合わせた形で、較正でも裏づけが取れた
/// (puzsq 1,226 問の CV 一致率: 手間だけ 54.4% / 段階だけ 53.4% / 段階×手間 56.1%)。
///
/// 手間がこの幅を超えると段階の順序が壊れるので、超える分は切り捨てる。
pub const LEVEL_SCALE: i32 = 1_000_000;

/// 手筋も仮置きも尽きた問題のスケールの開始点。既定の深さ(2)なら段階 8。
pub fn unfinished_base(max_trial_depth: i32) -> i32 {
    (i32::from(crate::solver::level_unsolved(max_trial_depth)) - 1) * LEVEL_SCALE
}

/// 手筋切れのとき、残った未確定マス 1 つあたりの加点。
///
/// 較正(2026-08-04)で 60 → 120 に上げた。90〜320 が平坦な高原になっていたので、
/// その手前寄りの値を採っている。0 にすると CV 一致率が 2.4 ポイント落ちるので、
/// 「どれだけ残して止まったか」は手筋切れの中の順序づけとして確かに効いている。
pub const STOPPED_UNKNOWN_WEIGHT: i32 = 90;

/// 手筋だけで進めなくなった時点の未確定マス 1 つあたりの加点。
///
/// puzsq 1,229 問での較正(2026-08-04)で入れた項。手筋の発火数は申告★1〜3 で
/// ほとんど差がない(10x10 の完解問題で中央値がどれも ±10% 以内)が、この量は
/// ★1〜5 で 0 / 6 / 39 / 68 / 94 と分離する。5-fold CV の一致率は
/// 53.1% → 54.5%(5 シード平均)。係数 4〜25 が平坦なので、その中央の値を採った。
pub const PURE_UNKNOWN_WEIGHT: i32 = 12;

/// ソルバーがどれだけ働いたか。難易度そのものではなく努力量。
/// 生成の山登りはこちらを登る(階段関数を混ぜないため)。
pub fn technique_work(outcome: &SolveOutcome) -> i32 {
    let base: i32 = outcome
        .recorder
        .counts
        .iter()
        .map(|(reason, count)| weight(reason) * count)
        .sum();
    base + TRIAL_DEDUCTION_COST * outcome.stats.deductions
        + TRIAL_DEPTH_COST * outcome.stats.max_depth * outcome.stats.max_depth
        + PURE_UNKNOWN_WEIGHT * outcome.stats.pure_unknown
        + NESTED_TRIAL_COST * outcome.stats.nested_deductions
        + SHALLOW_UNKNOWN_WEIGHT * outcome.stats.shallow_unknown
}

/// 表示・較正に使う難易度。
///
/// `段階 × LEVEL_SCALE + 手間`。段階が主、手間が従。
pub fn difficulty(outcome: &SolveOutcome) -> i32 {
    if outcome.status == SolveStatus::Broken {
        return 0; // 矛盾した問題に難易度はない
    }
    let mut work = technique_work(outcome);
    if outcome.status == SolveStatus::Stopped {
        // 解けなかった問題は、どれだけ残して止まったかで順位をつける
        work += STOPPED_UNKNOWN_WEIGHT * outcome.answer.unknown_count() as i32;
    }
    (outcome.level as i32 - 1) * LEVEL_SCALE + work.min(LEVEL_SCALE - 1)
}

/// 難易度モデルの版。手筋セットやレーティングのアンカーを変えたら上げる。
pub const DIFFICULTY_VERSION: u32 = 1;

/// DP → puzsq の 1〜5 スケール(×100)の補間アンカー。
///
/// 較正(2026-08-05、puzsq 1,220 問、仮置きの深さ 2)。1.5〜3.5 の境界は
/// 「四捨五入で申告と一致する数を最大化する単調な境界」を区間 DP で求めたもの。
/// 4.5 は段階 8(手筋も仮置きも尽きた)の開始点に構造的に固定。上端 5.49 はその段階の最大値。
///
/// **アンカーの `.5` はそのまま★の分類境界**なので、四捨五入すれば分類が再現される。
///
/// 0.1 刻みのアンカーは、各バンドに入るコーパスの DP の分位点で 10 等分して置いてある。
/// 難易度の主軸が「要った読みの段階」で DP が段階ごとに 100 万ずつ飛ぶため、
/// 境界だけにアンカーを置くと段階の中で推定がまったく動かず(段階 2 がどれも ★1.75 など)、
/// 0.1 刻みで見ると値の入らない範囲ができてしまう。分位点で割ると
/// **50 の刻みすべてにコーパスの問題が入り、最も混む刻みでも全体の 7%** に収まる。
/// 異なる DP の等分割との混合も試したが、分位点そのままの方が平坦だった。
///
/// 4.5 を固定するのは、自由に当てはめると★5 の再現が 0/28 に縮退するため
/// (境界が段階 8 の内側に落ち、そこに 2 問しか残らない)。固定すると完全一致は
/// 58.0% → 56.5% と 1.5 ポイント落ちるが、★5 を 16/28 拾える。
/// 深さ 1 のときは同じ固定で 4.6 ポイント落ちたので採らなかったが、深さ 2 では代償が小さい。
///
/// 表は `rating_anchors.py` が作る。
const PUZSQ_RATING_POINTS: [(i32, i32); 51] = [
    (0, 50),
    (86, 60),
    (131, 70),
    (217, 80),
    (250, 90),
    (267, 100),
    (291, 110),
    (303, 120),
    (358, 130),
    (1_000_118, 140),
    (1_000_182, 150),
    (2_000_153, 160),
    (2_000_289, 170),
    (2_000_322, 180),
    (2_000_783, 190),
    (3_000_307, 200),
    (3_000_369, 210),
    (4_000_293, 220),
    (4_000_497, 230),
    (4_000_612, 240),
    (4_000_737, 250),
    (4_000_885, 260),
    (4_001_037, 270),
    (4_001_237, 280),
    (4_001_460, 290),
    (4_003_434, 300),
    (5_001_883, 310),
    (5_002_488, 320),
    (5_003_281, 330),
    (5_004_176, 340),
    (5_006_219, 350),
    (5_007_213, 360),
    (6_002_552, 370),
    (6_004_621, 380),
    (6_006_188, 390),
    (6_007_400, 400),
    (6_008_753, 410),
    (6_010_889, 420),
    (6_016_355, 430),
    (6_036_117, 440),
    (7_000_000, 450),
    (7_009_653, 459),
    (7_012_504, 469),
    (7_013_479, 479),
    (7_014_180, 489),
    (7_017_250, 499),
    (7_020_196, 509),
    (7_021_912, 519),
    (7_030_212, 529),
    (7_040_962, 539),
    (7_155_826, 549),
];

/// puzsq の 1〜5 スケールでの推定、100 分の 1 単位。273 なら 2.73。
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
        "  仮置き\t{} 回 / 深さ {}\tsubtotal {}\n",
        outcome.stats.deductions,
        outcome.stats.max_depth,
        TRIAL_DEDUCTION_COST * outcome.stats.deductions
            + TRIAL_DEPTH_COST * outcome.stats.max_depth * outcome.stats.max_depth
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
    out.push_str(&format!(
        "  入れ子の仮置き\t{} 回\tweight {NESTED_TRIAL_COST}\tsubtotal {}\n",
        outcome.stats.nested_deductions,
        NESTED_TRIAL_COST * outcome.stats.nested_deductions
    ));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::puzzlink::decode_url;
    use crate::solver::{run_all, SolveOptions};

    #[test]
    fn a_solved_puzzle_stays_below_the_unfinished_scale() {
        let board = decode_url("https://puzz.link/p?nurikabe/6/6/g5l3zg6i4g").unwrap();
        let outcome = run_all(&board, SolveOptions::default());
        assert_eq!(outcome.status, SolveStatus::Completed);
        assert!(difficulty(&outcome) < unfinished_base(SolveOptions::default().trial_depth));
    }

    #[test]
    fn trials_cost_more_than_plain_techniques() {
        // 仮置きなしだと手筋切れ、ありだと完解する問題では、
        // 仮置きありのスコアの方が「完解スケール」に収まる
        let board = decode_url("https://puzz.link/p?nurikabe/6/6/t4j4g2g3l2k").unwrap();
        let with_trial = run_all(&board, SolveOptions::default());
        let without = run_all(
            &board,
            SolveOptions {
                no_trial: true,
                ..Default::default()
            },
        );
        if with_trial.status == SolveStatus::Completed && without.status == SolveStatus::Stopped {
            assert!(difficulty(&with_trial) < unfinished_base(1));
            assert!(difficulty(&without) >= unfinished_base(0));
        }
    }
}
