from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from . import answer_model as model
from .answer_methods import AnswerMethods, Recorder, TraceEntry, create_answer_methods, create_recorder
from .board import Board, to_id, to_pos
from .position import Position
from .reasons import Reason
from .status import Status
from .techniques.add_black_cell_with_number import add_black_cell_with_number
from .techniques.add_fixed_line import add_fixed_line
from .techniques.add_white_around_black import add_white_around_black
from .techniques.add_white_cell_with_zero import add_white_cell_with_zero
from .techniques.cut_parity import cut_parity
from .techniques.line_number_theory import line_number_theory
from .techniques.row_col_line_number_theory import row_col_line_number_theory


@dataclass(slots=True)
class TrialStats:
    trial_deductions: int = 0
    max_trial_count: int = 0
    passes: int = 0
    #: The deepest stage of reasoning the puzzle actually needed (see ``LEVEL_*``).
    #:
    #: ``solve`` is already a cascade -- each stage runs only when every cheaper stage has
    #: stalled -- so the deepest stage that fired is the minimum set of techniques that
    #: cracks the puzzle. That is how players describe difficulty.
    level: int = 0
    #: Cells still undecided the first time the techniques ran out, before any lookahead.
    pure_undecided: int = 0


#: Stages of reasoning, cheapest first. The stage is the difficulty model's main axis.
LEVEL_BASIC = 1
LEVEL_ROW_COL = 2
LEVEL_CUT_PARITY = 3
LEVEL_LINE_THEORY = 4
LEVEL_TRIAL = 5
LEVEL_UNSOLVED = 6


@dataclass(slots=True)
class SolveOutcome:
    status: str
    answer: model.AnswerModel
    recorder: Recorder
    stats: TrialStats


@dataclass(slots=True)
class SolveOptions:
    no_trial: bool = False
    max_passes: int = 0


def solve(board: Board, answer: AnswerMethods) -> Status:
    return solve_at(board, answer, [0])


def solve_at(board: Board, answer: AnswerMethods, reached: list[int]) -> Status:
    """``solve``, recording the deepest stage that fired into ``reached[0]``."""

    def at(stage: int, status: Status) -> Status:
        if status == "advanced":
            reached[0] = max(reached[0], stage)
        return status

    add_white_around_black(answer)
    status1 = at(LEVEL_BASIC, add_black_cell_with_number(board, answer))
    if status1 == "broken":
        return "broken"
    status2 = at(LEVEL_BASIC, add_white_cell_with_zero(board, answer))
    status4 = at(LEVEL_BASIC, add_fixed_line(board, answer))
    if status4 == "broken" or answer.has_small_loop():
        return "broken"
    if status1 == status2 == status4 == "stopped":
        status5 = at(LEVEL_ROW_COL, row_col_line_number_theory(board, answer))
        if status5 == "stopped":
            status6 = at(LEVEL_CUT_PARITY, cut_parity(board, answer))
            if status6 == "stopped":
                return at(LEVEL_LINE_THEORY, line_number_theory(board, answer))
            return status6
        return status5
    return "advanced"


def _record_pure_undecided(board: Board, answer: model.AnswerModel, stats: TrialStats) -> None:
    """Note how many cells were still undecided the first time the techniques ran out.

    Ported from nurikabe-kit, where this is the single most useful difficulty feature:
    technique fire counts track board size rather than difficulty, but how far pure
    deduction gets you separates the ratings cleanly. Recorded once, on the first stall.
    """
    if stats.pure_undecided != 0:
        return
    clue_cells = sum(1 for cell in board.cell if cell.qnum >= 0)
    decided = len(answer.black_cells) + len(answer.white_cells)
    stats.pure_undecided = board.cols * board.rows - clue_cells - decided


def _propagate_trial(board: Board, methods: AnswerMethods, minimum: int, ge: bool = False) -> tuple[Status, int]:
    status: Status = "advanced"
    count = 0
    while True:
        status = solve(board, methods)
        count += 1
        if (count >= minimum if ge else count > minimum):
            status = "stopped"
        if status != "advanced":
            return status, count


def try_solve(
    board: Board, answer: model.AnswerModel, methods: AnswerMethods, stats: TrialStats
) -> Status:
    broken: list[dict[str, Any]] = []
    min_flag = False
    minimum = 100

    for i, cell in enumerate(board.cell):
        if min_flag:
            break
        target = Position(i % board.cols, i // board.cols)
        target_id = to_id(target)
        if (
            cell.qnum != -1 or target_id in answer.black_cells
            or target_id in answer.white_cells or model.has_line_with_end(answer, target)
        ):
            continue
        black = model.clone(answer)
        black_methods = create_answer_methods(board, black, None)
        model.add_black_cell(black.black_cells, target)
        black_status, black_count = _propagate_trial(board, black_methods, minimum)
        if black_status == "broken":
            broken.append({"target": target, "count": black_count, "type": "white", "reason": "contradiction"})
            if black_count == 1:
                min_flag = True
                break
            minimum = min(minimum, black_count)

        white = model.clone(answer)
        white_methods = create_answer_methods(board, white, None)
        model.add_white_cell(white.white_cells, target)
        white_status, white_count = _propagate_trial(board, white_methods, minimum)
        if white_status == "broken":
            broken.append({"target": target, "count": white_count, "type": "black", "reason": "contradiction"})
            if white_count == 1:
                min_flag = True
                break
            minimum = min(minimum, white_count)

        common_black = [value for value in black_methods.new_blacks if value in white_methods.new_blacks]
        if common_black:
            count = max(black_count, white_count)
            minimum = min(minimum, count)
            broken.append({"target": to_pos(common_black[0]), "count": count, "type": "black",
                           "reason": "any-case", "reason_pos": target})
        common_white = [value for value in black_methods.new_whites if value in white_methods.new_whites]
        if common_white:
            count = max(black_count, white_count)
            minimum = min(minimum, count)
            broken.append({"target": to_pos(common_white[0]), "count": count, "type": "white",
                           "reason": "any-case", "reason_pos": target})

    for y in range(board.rows):
        for x in range(board.cols - 1):
            target = Position(x, y)
            other = Position(x + 1, y)
            if answer.horizontal.get(to_id(target), model.LineState.None_) != model.LineState.None_:
                continue
            if methods.forbidden(target) or methods.forbidden(other):
                continue
            line = model.clone(answer)
            line_methods = create_answer_methods(board, line, None)
            model.add_line(line, [target, other])
            line_status, line_count = _propagate_trial(board, line_methods, minimum)
            if line_status == "broken":
                broken.append({"line": [target, other], "count": line_count, "type": "bar", "reason": "contradiction"})
                if line_count == 1:
                    min_flag = True
                    minimum = line_count
                    break
                minimum = min(minimum, line_count)
            bar = model.clone(answer)
            bar_methods = create_answer_methods(board, bar, None)
            model.set_line_bar(bar, target, other)
            bar_status, bar_count = _propagate_trial(board, bar_methods, minimum)
            if bar_status == "broken":
                broken.append({"line": [target, other], "count": bar_count, "type": "line", "reason": "contradiction"})
                if bar_count == 1:
                    min_flag = True
                    break
                minimum = min(minimum, bar_count)
            common_black = [value for value in line_methods.new_blacks if value in bar_methods.new_blacks]
            if common_black:
                count = max(line_count, bar_count)
                minimum = min(minimum, count)
                broken.append({"target": to_pos(common_black[0]), "count": count, "type": "black",
                               "reason": "any-case", "reason_pos": target})
            common_white = [value for value in line_methods.new_whites if value in bar_methods.new_whites]
            if common_white:
                count = max(line_count, bar_count)
                minimum = min(minimum, count)
                broken.append({"target": to_pos(common_white[0]), "count": count, "type": "white",
                               "reason": "any-case", "reason_pos": target})

    for y in range(board.rows - 1):
        for x in range(board.cols):
            target = Position(x, y)
            other = Position(x, y + 1)
            if answer.vertical.get(to_id(target), model.LineState.None_) != model.LineState.None_:
                continue
            if methods.forbidden(target) or methods.forbidden(other):
                continue
            line = model.clone(answer)
            line_methods = create_answer_methods(board, line, None)
            model.add_line(line, [target, other])
            line_status, line_count = _propagate_trial(board, line_methods, minimum, True)
            if line_status == "broken":
                broken.append({"line": [target, other], "count": line_count, "type": "bar", "reason": "contradiction"})
                if line_count == 1:
                    min_flag = True
                    break
                minimum = min(minimum, line_count)
            bar = model.clone(answer)
            bar_methods = create_answer_methods(board, bar, None)
            model.set_line_bar(bar, target, other)
            bar_status, bar_count = _propagate_trial(board, bar_methods, minimum, True)
            if bar_status == "broken":
                broken.append({"line": [target, other], "count": bar_count, "type": "line", "reason": "contradiction"})
                if bar_count == 1:
                    min_flag = True
                    break
                minimum = min(minimum, bar_count)

    if not broken:
        return "stopped"
    for item in broken:
        stats.trial_deductions += 1
        stats.max_trial_count = max(stats.max_trial_count, item["count"])
        if item["type"] == "white":
            methods.add_white_cell(
                methods, item["target"],
                Reason.TrialContradiction if item["reason"] == "contradiction" else Reason.TrialAnyCase,
            )
        elif item["type"] == "black":
            methods.add_black_cell(
                methods, item["target"],
                Reason.TrialContradiction if item["reason"] == "contradiction" else Reason.TrialAnyCase,
            )
        elif item["type"] == "line":
            model.add_line(answer, item["line"])
            if methods.recorder:
                methods.recorder.add(TraceEntry("line", item["line"], Reason.TrialLineContradiction))
        else:
            model.set_line_bar(answer, item["line"][0], item["line"][1])
            if methods.recorder:
                methods.recorder.add(TraceEntry("bar", item["line"], Reason.TrialLineContradiction))
    return "advanced"


def _run(board: Board, answer: model.AnswerModel, recorder: Recorder, stats: TrialStats) -> Status:
    methods = create_answer_methods(board, answer, recorder)
    stats.passes += 1
    reached = [stats.level]
    status = solve_at(board, methods, reached)
    stats.level = reached[0]
    if status == "advanced":
        return status
    if status == "stopped" and not model.is_single_line(answer):
        _record_pure_undecided(board, answer, stats)
        trial = try_solve(board, answer, methods, stats)
        if trial == "advanced":
            stats.level = max(stats.level, LEVEL_TRIAL)
        return trial
    return status


def run_all(
    board: Board, initial: model.AnswerModel | None = None, options: SolveOptions | None = None
) -> SolveOutcome:
    answer = initial if initial is not None else model.create_answer_model()
    recorder = create_recorder()
    stats = TrialStats()
    options = options or SolveOptions()
    status: Status = "advanced"
    while status == "advanced":
        if options.no_trial:
            methods = create_answer_methods(board, answer, recorder)
            stats.passes += 1
            reached = [stats.level]
            status = solve_at(board, methods, reached)
            stats.level = reached[0]
            if status == "stopped" and not model.is_single_line(answer):
                _record_pure_undecided(board, answer, stats)
        else:
            status = _run(board, answer, recorder, stats)
        if options.max_passes > 0 and stats.passes >= options.max_passes:
            break
    if status == "broken":
        final: str = "broken"
    elif status == "stopped" and model.is_single_line(answer):
        final = "completed"
    else:
        final = "stopped"
    if final == "stopped":
        stats.level = LEVEL_UNSOLVED
    elif stats.level == 0:
        stats.level = LEVEL_BASIC
    return SolveOutcome(final, answer, recorder, stats)
