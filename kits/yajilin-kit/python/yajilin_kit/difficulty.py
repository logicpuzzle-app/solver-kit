"""Yajilin Kit — difficulty scoring.

The score ("DP", following the convention of the NPGenerator rewrite) sums a weight per
applied technique and adds a separate charge for lookahead: how many deductions needed
a trial, and how deep the deepest successful trial had to propagate. Trials dominate on
purpose — a puzzle that cannot be finished without them is what players call hard.
"""

from __future__ import annotations

from .board import Board
from .reasons import Reason, REASON_WEIGHT
from .solver import SolveOutcome

TRIAL_DEDUCTION_COST = 40

#: Charge per cell still undecided the first time the techniques ran out.
#:
#: v5, ported from nurikabe-kit. On the puzsq corpus the medians run 0 / 0 / 66 / 69 / 84
#: across ratings 1-5. The coefficient sits on a plateau from 4 to 16 with its peak at 10.
PURE_UNDECIDED_COST = 10

#: Width of one reasoning stage. The stage is the main axis; effort only orders within it.
#:
#: v5. ``solve`` is a cascade, so the deepest stage that fired is the minimum set of
#: techniques that cracks the puzzle -- which is how players describe difficulty. Effort
#: with no stage axis scores 57.4% (5-fold CV) against the declared rating; the stage axis
#: takes it to 58.7%, and ``PURE_UNDECIDED_COST`` adds another 0.6pt on top.
LEVEL_SCALE = 1_000_000
TRIAL_DEPTH_COST = 25

# Denominator of the `_SIZE_SCALE` multipliers.
SIZE_SCALE_UNIT = 4096

# Multipliers, in 1/4096ths, that restate a score measured on a board of `cells` cells as
# what the same reasoning would have scored on a 10x10.
#
# The raw score counts deductions, so it grows with the board: a big grid simply has more
# cells to decide. Human ratings do not work that way — on the calibration corpus the
# declared rating barely tracks board size (rank correlation 0.30) while the raw score
# tracks it at 0.47. Left uncorrected the same declared rating came out at a median score
# of 2003 on a 9x9 and 15959 on a 17x17 or larger, so the estimate ran 0.45 low on small
# boards and 0.35 high on large ones. Dividing the score by roughly the 0.8 power of the
# area cancels that: the worst remaining bias in any size band is 0.12.
#
# The table IS the definition, not an approximation of a power law evaluated at runtime.
# A floating-point `pow` would risk the three ports disagreeing in the last bit, and this
# whole file has to be exact integer arithmetic for them to print identical bytes. 10x10
# is the reference size and its multiplier is exactly 1, so the most common board keeps
# the scores this project was calibrated on.
_SIZE_SCALE = (
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
)


def size_scale(cells: int) -> int:
    """Return the multiplier for a board of `cells` cells.

    The value is interpolated between table entries. The table runs downwards, so the
    interpolation is written as a subtraction of a non-negative quantity — that keeps
    the rounding identical in languages whose integer division truncates towards zero
    rather than flooring.
    """
    points = _SIZE_SCALE
    if cells <= points[0][0]:
        return points[0][1]
    last = points[-1]
    if cells >= last[0]:
        return last[1]
    for i in range(1, len(points)):
        x1, y1 = points[i]
        if cells < x1:
            x0, y0 = points[i - 1]
            span = x1 - x0
            drop = y0 - y1
            return y0 - ((cells - x0) * drop * 2 + span) // (2 * span)
    return last[1]


# Where the scale for puzzles the technique solver could not finish begins. Anything at or
# above this is an unfinished solve; anything below is a completed one, clamped so the two
# ranges cannot overlap however large a completed score gets.
UNFINISHED_BASE = 20000


def technique_score(counts: dict[str, int]) -> int:
    return sum(REASON_WEIGHT.get(reason, 1) * count for reason, count in counts.items())


def technique_work(outcome: SolveOutcome) -> int:
    """How hard the technique solver worked: technique weights plus a charge for lookahead.

    This is a measure of effort, not of difficulty, and the two come apart exactly where
    it matters. Generation hill-climbs on this, because within the puzzles it can actually
    finish, more work really does mean a longer chain of deductions.
    """
    return (
        technique_score(outcome.recorder.counts)
        + PURE_UNDECIDED_COST * outcome.stats.pure_undecided
        + TRIAL_DEDUCTION_COST * outcome.stats.trial_deductions
        + TRIAL_DEPTH_COST * outcome.stats.max_trial_count * outcome.stats.max_trial_count
    )


# Techniques whose mere presence puts a floor under the score, and what that floor is.
#
# A weight cannot express what these techniques say. They fire once or twice when they
# fire at all, so weight times count is a rounding error next to a puzzle's total — and
# yet on the calibration corpus not one of the 165 puzzles that needed the invisible wall
# was rated 1, against 18% for an ordinary deduction like `LineFixed`. Needing the rule at
# all is the evidence; how much work it then saved is beside the point.
#
# The floors are fitted on half the sample and measured on the other half, where they take
# the rounded rating from 48.5% correct to 49.6% and the within-one rate from 93.7% to
# 94.4%. Only the counting theorems earn one. A floor was also fitted for `ZeroWhite`,
# which 62% of puzzles use, and it changed nothing at all — a floor under something nearly
# every puzzle does is not a gate, it is an offset, and the curve already handles offsets.
#
# Deliberately this lives in `difficulty` and not in `technique_work`: generation
# hill-climbs on the latter, and a floor is a step function with no gradient to climb.
_TECHNIQUE_FLOOR = {
    Reason.InvisibleWallByCount: 1200,
    Reason.SubtractedBlackAlreadyPlacedWhite: 1200,
    Reason.RowCountBlack: 700,
    Reason.ColCountBlack: 700,
}


def difficulty(outcome: SolveOutcome, board: Board) -> int:
    """How hard the puzzle is.

    Effort alone gets the hardest puzzles backwards. When the technique solver runs out of
    techniques it stops early, having done almost no work, so scoring it by effort rates
    the puzzles it cannot crack as the easiest ones on the board. On the puzzle-square
    corpus that is not a rare corner: it fails to finish 70% of the puzzles rated 5 and
    none of the puzzles rated 1, and those failures were being handed the minimum score.

    So an unfinished solve outranks every finished one, and effort only breaks ties within
    each group. Ranking that way lifts the rank correlation with the declared rating from
    0.68 to 0.78 on the calibration sample.

    The effort is then restated at 10x10 scale (see `_SIZE_SCALE`) so that the same
    reasoning scores the same on any board. Only the effort is scaled: the
    `UNFINISHED_BASE` step is not, so "at or above 20000 means the technique solver could
    not finish" stays true at every size.
    """
    scaled = technique_work(outcome) * size_scale(board.cols * board.rows) // SIZE_SCALE_UNIT
    if outcome.status == "completed":
        score = min(scaled, UNFINISHED_BASE - 1)
    else:
        score = UNFINISHED_BASE + scaled
    floor = max(
        (_TECHNIQUE_FLOOR.get(reason, 0) for reason in outcome.recorder.counts),
        default=0,
    )
    # The stage is the main axis; everything above only orders puzzles within a stage.
    within = min(max(score, floor), LEVEL_SCALE - 1)
    return (outcome.stats.level - 1) * LEVEL_SCALE + within


# Breakpoints mapping the score onto puzzle-square's 1-5 rating scale, as
# [score, rating x 100] pairs.
#
# Built from a sample of 1,371 rated Yajilin puzzles from that site
# (`tools/calibrate-puzsq.mjs`), drawn evenly across each rating's whole id range. Drawing
# evenly matters more than it sounds: an earlier calibration took the first N of each
# rating instead, which since ids run chronologically meant calibrating on 2019-2020
# puzzles alone, with one prolific author supplying a quarter of them. That author rates
# about half a point above this estimate, and the site's own standards have drifted since,
# so that curve came out low by 0.19 on average and by 0.35 on the most recent puzzles.
#
# The anchors are the four scores that best separate each rating from the next - the score
# at which a puzzle stops being as likely a 2 as a 3 - pinned to the .5 boundaries where
# rounding flips. Anchoring the group medians on the integers instead reads more tidily and
# was tried first, but it costs real accuracy: rating 2's scores span a factor of four
# between their quartiles and sit entirely inside the gap between rating 1 and rating 3, so
# pinning their median to exactly 2.00 threw four fifths of them outside the band. On
# puzzles held out of the calibration the boundary anchors get 47% of ratings exactly right
# against 43%, and 95% within one against 93%.
#
# The output runs from 0.50 to 5.49, which is exactly the interval that rounds to 1-5, so
# rounding the rating gives the estimator's guess at the rating an author would have
# declared. The decimals say where in the band a puzzle sits, but do not read them as a
# finer rating: a typical rated-2 puzzle lands near 1.81 and a typical rated-4 near 3.64,
# because the bands are placed to classify well rather than to centre their groups.
#
# Read a single value as an estimate, not a verdict - the ratings themselves are one
# author's judgement, and rank correlation with the score is 0.78, not 1.
#
# The jump from 2318 to 13041 across the last full segment is not a mistake. Above
# `UNFINISHED_BASE` the score means "the technique solver could not finish", and 70% of
# rated-5 puzzles are in that region while 0% of rated-1 puzzles are, so that is where the
# top of the scale genuinely lives.
#
# Ratings are stored as hundredths so the interpolation is exact integer arithmetic and
# the three ports agree to the last digit.
#
# The sample was scored with the lookahead capped at 40 passes and, for the handful of
# boards that run for many minutes, a 150 second wall clock limit; puzzles that hit that
# limit are excluded.
# 難易度モデルの版。v5 = 難易度の主軸を「要った読みの段階」にし、「手筋だけで残ったマス」を
# 項に追加(2026-08-05、ぬりかべからの移植)。v4 = サイズ補正の指数 0.8→0.35、
# v3 = 上端アンカー、v2 = cut_parity。
DIFFICULTY_VERSION = 5

_PUZSQ_RATING_POINTS = (
    (0, 50),
    (238, 150),
    (4001304, 250),
    (4004722, 350),
    (5000000, 450),
    (5032429, 549),
)


def puzsq_rating_hundredths(score: int) -> int:
    """Return the puzzle-square 1-5 rating in hundredths, so 273 means 2.73.

    Integer throughout: callers that print this must divide at the last moment, or the
    ports stop agreeing byte for byte.
    """
    points = _PUZSQ_RATING_POINTS
    if score <= points[0][0]:
        return points[0][1]
    last = points[-1]
    if score >= last[0]:
        return last[1]
    for i in range(1, len(points)):
        x1, y1 = points[i]
        if score < x1:
            x0, y0 = points[i - 1]
            span = x1 - x0
            if span <= 0:
                return y1
            # Rounded linear interpolation, kept in integers.
            return y0 + ((score - x0) * (y1 - y0) * 2 + span) // (2 * span)
    return last[1]


def puzsq_rating(score: int) -> float:
    """Return the same value as a float, e.g. 2.73. Print with two decimals."""
    return puzsq_rating_hundredths(score) / 100


def band(score: int) -> str:
    """Return the coarse label, derived from the estimated rating, not the raw score.

    Before v5 these were thresholds on the raw score. That stopped working when the score
    gained a leading stage term: a difference of one stage is a million points, so every
    puzzle past stage 1 landed in the top band. Deriving the label from the rating keeps it
    consistent with what the rating prints, and the thresholds below reproduce the band
    proportions the old ones gave on the puzsq corpus.
    """
    rating = puzsq_rating_hundredths(score)
    if rating < 150:
        return "intro"
    if rating < 175:
        return "easy"
    if rating < 252:
        return "medium"
    if rating < 279:
        return "hard"
    if rating < 335:
        return "expert"
    return "fiendish"
