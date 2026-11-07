# Walks each arrow, splits the still-undecided cells along it into maximal runs, and
# compares the arrow's count with the maximum number of blacks those runs can hold.
# When they match:
# - odd runs have every second cell forced black;
# - even runs leave a two-way choice, registered in black_candidates_* so that whitening
#   one half later forces the other, plus the "2n in n" white deductions at the ends.

from __future__ import annotations

from ..answer_methods import AnswerMethods
from ..board import Board, to_id
from ..position import Position, dirs
from ..reasons import Reason
from ..status import Status


def _max_blacks_beyond(
    board: Board, answer: AnswerMethods, start: Position, delta: Position
) -> int:
    """Return the most blacks possible after ``start`` along ``delta``.

    The cells from ``start`` (exclusive) to the board edge are considered, counting blacks
    already placed.

    Used only to bound a ``?`` clue. Deliberately an over-estimate: it costs each maximal
    undecided run ``ceil(len / 2)`` without checking whether a neighbouring black already
    rules the first cell out. Over-estimating here can only weaken the bound it feeds, never
    make it claim too much.
    """
    x, y = start.x + delta.x, start.y + delta.y
    placed = 0
    run = 0
    capacity = 0
    while board.in_board(Position(x, y)):
        pos = Position(x, y)
        free = (
            not answer.has_line(pos)
            and not answer.has_black_cell(pos)
            and not answer.has_white_cell(pos)
            and not answer.is_line_edge(pos)
            and board.cell[y * board.cols + x].qnum == -1
        )
        if free:
            run += 1
        else:
            if answer.has_black_cell(pos):
                placed += 1
            capacity += (run + 1) // 2
            run = 0
        x += delta.x
        y += delta.y
    capacity += (run + 1) // 2
    return placed + capacity


def _placed_blacks_beyond(
    board: Board, answer: AnswerMethods, start: Position, delta: Position
) -> int:
    """Count blacks already standing beyond ``start``.

    They are the floor under a ``?`` clue's own count.
    """
    x, y = start.x + delta.x, start.y + delta.y
    placed = 0
    while board.in_board(Position(x, y)):
        if answer.has_black_cell(Position(x, y)):
            placed += 1
        x += delta.x
        y += delta.y
    return placed


def add_black_cell_with_number(board: Board, answer: AnswerMethods) -> Status:
    advanced = False
    for i, cell in enumerate(board.cell):
        direction = cell.qdir
        if direction in (-1, 0) or cell.qnum == -2:
            continue
        delta = dirs[direction]
        x, y = i % board.cols + delta.x, i // board.cols + delta.y
        black_count = 0
        runs: list[list[Position]] = []
        while board.in_board(Position(x, y)) and board.cell[y * board.cols + x].qdir != direction:
            pos = Position(x, y)
            if answer.has_black_cell(pos):
                black_count += 1
            if (
                not answer.has_line(pos) and not answer.has_black_cell(pos)
                and not answer.has_white_cell(pos) and not answer.is_line_edge(pos)
                and board.cell[y * board.cols + x].qnum == -1
            ):
                if not runs or (
                    runs[-1][-1].x + delta.x != x or runs[-1][-1].y + delta.y != y
                ):
                    runs.append([pos])
                else:
                    runs[-1].append(pos)
            x += delta.x
            y += delta.y
        next_num = board.cell[y * board.cols + x].qnum if board.in_board(Position(x, y)) else 0
        # How many blacks lie between this arrow and the clue it runs into. An arrow counts
        # to the board edge, and the clue it runs into counts a suffix of the same ray, so
        # the count in between is this arrow's number minus that clue's.
        #
        # When that clue is a `?` its number is unknown and the difference becomes a range
        # rather than a value. Both ends are still usable: the far clue can count no fewer
        # than nothing, which caps the run at this arrow's own number, and it can count no
        # more than the blacks that could physically fit beyond it, which puts a floor
        # under the run.
        capped = cell.qnum
        if next_num == -2:
            low = max(
                0,
                capped - _max_blacks_beyond(board, answer, Position(x, y), delta),
            )
            high = capped - _placed_blacks_beyond(
                board, answer, Position(x, y), delta
            )
        else:
            low = capped - next_num
            high = capped - next_num
        cand_count = sum((len(run) + 1) // 2 for run in runs)
        if low == cand_count + black_count:
            for run in runs:
                if len(run) % 2 == 1:
                    for index, pos in enumerate(run):
                        if index % 2 == 0:
                            advanced |= answer.add_black_cell(answer, pos, Reason.EverySecondBlack)
            for run in runs:
                if len(run) % 2:
                    continue
                for index, pos in enumerate(run):
                    if index % 2 != 0:
                        continue
                    if delta.x == 0:
                        answer.black_candidates_vertical[to_id(
                            Position(pos.x, pos.y + min(delta.y, 0))
                        )] = None
                    else:
                        answer.black_candidates_horizontal[to_id(
                            Position(pos.x + min(delta.x, 0), pos.y)
                        )] = None
                    answer.set_line_bar(pos, Position(pos.x + delta.x, pos.y + delta.y))

                first, last = run[0], run[-1]
                prev = Position(first.x - delta.x, first.y - delta.y)
                pn1 = Position(first.x - delta.y, first.y - delta.x)
                pn2 = Position(first.x + delta.y, first.y + delta.x)
                if answer.forbidden(prev):
                    if not answer.forbidden(pn1):
                        advanced |= answer.add_white_cell(answer, pn1, Reason.TwoNInNWhiteNear)
                    if not answer.forbidden(pn2):
                        advanced |= answer.add_white_cell(answer, pn2, Reason.TwoNInNWhiteNear)
                nxt = Position(last.x + delta.x, last.y + delta.y)
                nn1 = Position(last.x - delta.y, last.y - delta.x)
                nn2 = Position(last.x + delta.y, last.y + delta.x)
                if answer.forbidden(nxt):
                    if not answer.forbidden(nn1):
                        advanced |= answer.add_white_cell(answer, nn1, Reason.TwoNInNWhiteNear)
                    if not answer.forbidden(nn2):
                        advanced |= answer.add_white_cell(answer, nn2, Reason.TwoNInNWhiteNear)

                tests = [
                    (Position(first.x - delta.x - delta.y, first.y - delta.y - delta.x),
                     pn1, Position(run[1].x - delta.y, run[1].y - delta.x)),
                    (Position(first.x - delta.x + delta.y, first.y - delta.y + delta.x),
                     pn2, Position(run[1].x + delta.y, run[1].y + delta.x)),
                    (Position(last.x + delta.x - delta.y, last.y + delta.y - delta.x),
                     nn1, Position(run[-2].x - delta.y, run[-2].y - delta.x)),
                    (Position(last.x + delta.x + delta.y, last.y + delta.y + delta.x),
                     nn2, Position(run[-2].x + delta.y, run[-2].y + delta.x)),
                ]
                for diagonal, near, far in tests:
                    if answer.forbidden(diagonal) and not answer.forbidden(near) and not answer.is_line_edge(near):
                        if not answer.forbidden(far):
                            advanced |= answer.add_white_cell(answer, far, Reason.TwoNInNWhiteFar)
        elif low > cand_count + black_count:
            return "broken"
        elif high < black_count:
            return "broken"
    return "advanced" if advanced else "stopped"
