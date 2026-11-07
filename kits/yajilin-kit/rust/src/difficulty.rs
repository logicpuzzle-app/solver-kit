//! Yajilin Kit — difficulty scoring.
//!
//! The score ("DP", following the convention of the NPGenerator rewrite) sums a weight per
//! applied technique and adds a separate charge for lookahead: how many deductions needed
//! a trial, and how deep the deepest successful trial had to propagate. Trials dominate on
//! purpose — a puzzle that cannot be finished without them is what players call hard.

use crate::board::Board;
use crate::reasons::{self, weight};
use crate::solver::{SolveOutcome, SolveStatus};

pub const TRIAL_DEDUCTION_COST: i32 = 40;
pub const TRIAL_DEPTH_COST: i32 = 25;

/// Charge per cell still undecided the first time the techniques ran out (`pure_undecided`).
///
/// v5, ported from nurikabe-kit. Technique fire counts track board size rather than
/// difficulty; how far pure deduction got you does not. On the puzsq corpus the medians run
/// 0 / 0 / 66 / 69 / 84 across ratings 1-5. The coefficient sits on a plateau from 4 to 16
/// and 10 is its peak; 5-fold CV agreement over 7 seeds goes 59.00% -> 59.69%.
pub const PURE_UNDECIDED_COST: i32 = 10;

/// Width of one reasoning stage. The stage is the main axis; effort only orders within it.
///
/// v5. `solve` is a cascade — each stage runs only when every cheaper stage has stalled —
/// so the deepest stage that fired is the minimum set of techniques that cracks the puzzle.
/// That is how players describe difficulty, and it measures better than effort alone:
/// on the puzsq corpus, effort with no stage axis gets 57.37% (5-fold CV) and the stage
/// axis takes it to 58.71%. Most of that was already being bought, less directly, by
/// `UNFINISHED_BASE` and `TECHNIQUE_FLOOR`; stacking the explicit stage on top adds 0.3pt
/// more, and the `pure_undecided` term adds 0.6pt on top of that.
pub const LEVEL_SCALE: i32 = 1_000_000;

/// Denominator of the `SIZE_SCALE` multipliers.
pub const SIZE_SCALE_UNIT: i32 = 4096;

/// Multipliers, in 1/4096ths, that restate a score measured on a board of `cells` cells as
/// what the same reasoning would have scored on a 10x10.
///
/// The raw score counts deductions, so it grows with the board: a big grid simply has more
/// cells to decide. Human ratings do not work that way, so the score is divided by a power
/// of the area to cancel the drift.
///
/// The exponent is 0.35, refitted on the puzsq corpus (8,822 rated puzzles) in v4. The
/// original 0.8 was fitted before `cut_parity` existed, and that technique took most of
/// the lookahead out of the large boards, which is where the raw score used to run away.
/// At 0.8 the correction had become an over-correction in both directions: small boards
/// read high (6x6 by +0.55 of a star, 7x7 by +0.43) and large boards read low (18x18 and
/// up by -0.38). At 0.35 no size band is off by more than 0.13, and exact agreement with
/// the declared rating rises from 55.8% to 57.4% (5-fold CV 55.7% -> 57.1%).
///
/// The table IS the definition, not an approximation of a power law evaluated at runtime.
/// A floating-point `pow` would risk the three ports disagreeing in the last bit, and this
/// whole file has to be exact integer arithmetic for them to print identical bytes. 10x10
/// is the reference size and its multiplier is exactly 1, so the most common board keeps
/// the scores this project was calibrated on.
const SIZE_SCALE: [(i32, i32); 20] = [
    (25, 6654),
    (36, 5857),
    (49, 5258),
    (64, 4788),
    (81, 4410),
    (100, 4096),
    (121, 3832),
    (144, 3605),
    (169, 3409),
    (196, 3236),
    (225, 3084),
    (256, 2948),
    (289, 2825),
    (361, 2614),
    (441, 2437),
    (529, 2286),
    (625, 2157),
    (784, 1992),
    (1024, 1814),
    (1400, 1626),
];

/// The multiplier for a board of `cells` cells, interpolated between table entries. The
/// table runs downwards, so the interpolation is written as a subtraction of a non-negative
/// quantity — that keeps the rounding identical in languages whose integer division
/// truncates towards zero rather than flooring.
pub fn size_scale(cells: i32) -> i32 {
    let points = SIZE_SCALE;
    if cells <= points[0].0 {
        return points[0].1;
    }
    let last = points[points.len() - 1];
    if cells >= last.0 {
        return last.1;
    }
    for i in 1..points.len() {
        let (x1, _y1) = points[i];
        if cells < x1 {
            let (x0, y0) = points[i - 1];
            let span = x1 - x0;
            let drop = y0 - points[i].1;
            return y0 - ((cells - x0) * drop * 2 + span) / (2 * span);
        }
    }
    last.1
}

/// Where the scale for puzzles the technique solver could not finish begins. Anything at or
/// above this is an unfinished solve; anything below is a completed one, clamped so the two
/// ranges cannot overlap however large a completed score gets.
pub const UNFINISHED_BASE: i32 = 20_000;

/// How hard the technique solver worked: technique weights plus a charge for lookahead.
///
/// This is a measure of effort, not of difficulty, and the two come apart exactly where it
/// matters. Generation hill-climbs on this, because within the puzzles it can actually
/// finish, more work really does mean a longer chain of deductions.
pub fn technique_work(outcome: &SolveOutcome) -> i32 {
    let base: i32 = outcome
        .recorder
        .counts
        .iter()
        .map(|(reason, count)| weight(reason) * count)
        .sum();
    base + TRIAL_DEDUCTION_COST * outcome.stats.trial_deductions
        + TRIAL_DEPTH_COST * outcome.stats.max_trial_count * outcome.stats.max_trial_count
        + PURE_UNDECIDED_COST * outcome.stats.pure_undecided
}

/// Techniques whose mere presence puts a floor under the score, and what that floor is.
///
/// A weight cannot express what these techniques say. They fire once or twice when they
/// fire at all, so weight times count is a rounding error next to a puzzle's total — and
/// yet on the calibration corpus not one of the 165 puzzles that needed the invisible wall
/// was rated 1, against 18% for an ordinary deduction like `LINE_FIXED`. Needing the rule at
/// all is the evidence; how much work it then saved is beside the point.
///
/// The floors are fitted on half the sample and measured on the other half, where they take
/// the rounded rating from 48.5% correct to 49.6% and the within-one rate from 93.7% to
/// 94.4%. Only the counting theorems earn one. A floor was also fitted for `ZERO_WHITE`,
/// which 62% of puzzles use, and it changed nothing at all — a floor under something nearly
/// every puzzle does is not a gate, it is an offset, and the curve already handles offsets.
///
/// Deliberately this lives in `difficulty` and not in `technique_work`: generation
/// hill-climbs on the latter, and a floor is a step function with no gradient to climb.
const TECHNIQUE_FLOOR: [(&str, i32); 4] = [
    (reasons::INVISIBLE_WALL_BY_COUNT, 1200),
    (reasons::SUBTRACTED_BLACK_ALREADY_PLACED_WHITE, 1200),
    (reasons::ROW_COUNT_BLACK, 700),
    (reasons::COL_COUNT_BLACK, 700),
];

/// How hard the puzzle is.
///
/// Effort alone gets the hardest puzzles backwards. When the technique solver runs out of
/// techniques it stops early, having done almost no work, so scoring it by effort rates the
/// puzzles it cannot crack as the easiest ones on the board. On the puzzle-square corpus
/// that is not a rare corner: it fails to finish 70% of the puzzles rated 5 and none of the
/// puzzles rated 1, and those failures were being handed the minimum score.
///
/// So an unfinished solve outranks every finished one, and effort only breaks ties within
/// each group. Ranking that way lifts the rank correlation with the declared rating from
/// 0.68 to 0.78 on the calibration sample.
///
/// The effort is then restated at 10x10 scale (see `SIZE_SCALE`) so that the same reasoning
/// scores the same on any board. Only the effort is scaled: the `UNFINISHED_BASE` step is
/// not, so "at or above 20000 means the technique solver could not finish" stays true at
/// every size.
pub fn difficulty(outcome: &SolveOutcome, board: &Board) -> i32 {
    let scaled = (i64::from(technique_work(outcome))
        * i64::from(size_scale(board.cols * board.rows))
        / i64::from(SIZE_SCALE_UNIT)) as i32;
    let score = if outcome.status == SolveStatus::Completed {
        scaled.min(UNFINISHED_BASE - 1)
    } else {
        UNFINISHED_BASE + scaled
    };
    let floor = outcome
        .recorder
        .counts
        .keys()
        .filter_map(|reason| {
            TECHNIQUE_FLOOR
                .iter()
                .find_map(|(technique, floor)| (*technique == *reason).then_some(*floor))
        })
        .max()
        .unwrap_or(0);
    let score = score.max(floor);
    // The stage is the main axis; everything above only orders puzzles within a stage.
    (i32::from(outcome.stats.level) - 1) * LEVEL_SCALE + score.min(LEVEL_SCALE - 1)
}

/// Breakpoints mapping the score onto puzzle-square's 1-5 rating scale, as
/// [score, rating x 100] pairs.
///
/// Built from a sample of 1,371 rated Yajilin puzzles from that site
/// (`tools/calibrate-puzsq.mjs`), drawn evenly across each rating's whole id range. Drawing
/// evenly matters more than it sounds: an earlier calibration took the first N of each
/// rating instead, which since ids run chronologically meant calibrating on 2019-2020
/// puzzles alone, with one prolific author supplying a quarter of them. That author rates
/// about half a point above this estimate, and the site's own standards have drifted since,
/// so that curve came out low by 0.19 on average and by 0.35 on the most recent puzzles.
///
/// The anchors are the four scores that best separate each rating from the next - the score
/// at which a puzzle stops being as likely a 2 as a 3 - pinned to the .5 boundaries where
/// rounding flips. Anchoring the group medians on the integers instead reads more tidily and
/// was tried first, but it costs real accuracy: rating 2's scores span a factor of four
/// between their quartiles and sit entirely inside the gap between rating 1 and rating 3, so
/// pinning their median to exactly 2.00 threw four fifths of them outside the band. On
/// puzzles held out of the calibration the boundary anchors get 47% of ratings exactly right
/// against 43%, and 95% within one against 93%.
///
/// The output runs from 0.50 to 5.49, which is exactly the interval that rounds to 1-5, so
/// rounding the rating gives the estimator's guess at the rating an author would have
/// declared. The decimals say where in the band a puzzle sits, but do not read them as a
/// finer rating: a typical rated-2 puzzle lands near 1.81 and a typical rated-4 near 3.64,
/// because the bands are placed to classify well rather than to centre their groups.
///
/// Read a single value as an estimate, not a verdict - the ratings themselves are one
/// author's judgement, and rank correlation with the score is 0.78, not 1.
///
/// The jump from 2318 to 13041 across the last full segment is not a mistake. Above
/// `UNFINISHED_BASE` the score means "the technique solver could not finish", and 70% of
/// rated-5 puzzles are in that region while 0% of rated-1 puzzles are, so that is where the
/// top of the scale genuinely lives.
///
/// Ratings are stored as hundredths so the interpolation is exact integer arithmetic and
/// the three ports agree to the last digit.
///
/// The sample was scored with the lookahead capped at 40 passes and, for the handful of
/// boards that run for many minutes, a 150 second wall clock limit; puzzles that hit that
/// limit are excluded.
/// v5 較正メモ(2026-08-05): puzsq コーパス 8,688 問(一意解のみ)を段階つきで採点。
/// 1.5〜3.5 の境界は区間 DP、4.5 は段階 6(解けない)の開始点 5,000,000 に構造的に固定、
/// 上端 5.49 は段階 6 の DP の 99 パーセンタイル(5,032,429)。
/// 4.5 を自由に当てはめると一致率は 59.9% になるが★5 の再現が 0/125 に縮退するため、
/// v4 と同じく構造的に固定する(一致率 58.2%、±1 以内 98.2%、★5 の再現 49/125)。
/// 順序の質は Spearman 0.737(v4 は 0.734)、5-fold CV 一致率は 7 シード平均で
/// 58.73% → 59.69%。範囲が重ならない(v4 58.5〜58.9%、v5 59.3〜59.9%)。
///
/// 難易度モデルの版。手筋セットやレーティングのアンカーを変えたら上げる。
/// v5 = 難易度の主軸を「要った読みの段階」にし、「手筋だけで残ったマス」を項に追加
/// (2026-08-05、ぬりかべからの移植)。v4 = サイズ補正の指数を 0.8 から 0.35 へ、
/// v3 = 上端アンカーの引き上げ、v2 = cut_parity(カット偶奇)追加と puzsq 再較正。
pub const DIFFICULTY_VERSION: u32 = 5;

/// v2 較正メモ(2026-08-04): puzsq コーパス 8,814 問(kind 3、timeout 11 問除外)を
/// cut_parity 込みのソルバーで採点し直した。1.5〜3.5 の境界は「四捨五入で申告と一致する
/// 数を最大化する単調な境界」(区間 DP)、4.5 は手詰まり閾値 UNFINISHED_BASE=20000 に
/// 構造的に固定(全体最適だと ★5 の再現率が 0% に縮退するため)、上端 5.49 は手筋切れ問題の
/// DP の 99 パーセンタイル(30,437)。上端は ★ の分類境界ではないので一致率に影響しない —
/// 低く取ると上位が頭打ちになって順序が潰れるだけなので、外れ値 1 件(36,616)を避けつつ
/// 広く取る。完全一致 55.8%(5-fold CV 55.7%)、±1 以内 97.7%。
const PUZSQ_RATING_POINTS: [(i32, i32); 6] = [
    (0, 50),
    (238, 150),
    (4_001_304, 250),
    (4_004_722, 350),
    (5_000_000, 450),
    (5_032_429, 549),
];

/// The score on puzzle-square's 1-5 scale, in hundredths, so 273 means 2.73.
///
/// Integer throughout: callers that print this must divide at the last moment, or the
/// ports stop agreeing byte for byte.
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
            // Rounded linear interpolation, kept in integers.
            return y0 + ((score - x0) * (y1 - y0) * 2 + span) / (2 * span);
        }
    }
    last.1
}

/// The same value as an `f64`, e.g. 2.73. Print with two decimals.
pub fn puzsq_rating(score: i32) -> f64 {
    f64::from(puzsq_rating_hundredths(score)) / 100.0
}

/// The coarse label, derived from the estimated rating rather than from the raw score.
///
/// Before v5 these were thresholds on the raw score. That stopped working when the score
/// gained a leading stage term: a difference of one stage is a million points, so every
/// puzzle past stage 1 landed in the top band. Deriving the label from the rating keeps it
/// consistent with what `RATING` prints, and the thresholds below are chosen to reproduce
/// the band proportions the old thresholds gave on the puzsq corpus
/// (7.6 / 15.8 / 12.2 / 18.8 / 26.8 / 18.8 percent).
pub fn band(score: i32) -> &'static str {
    match puzsq_rating_hundredths(score) {
        ..150 => "intro",
        150..175 => "easy",
        175..252 => "medium",
        252..279 => "hard",
        279..335 => "expert",
        _ => "fiendish",
    }
}
