# When an arrow's remaining count is already satisfied, every still-free cell along the
# arrow becomes white. ``next_num`` subtracts the clue of the next arrow pointing the same
# way, which is what lets chained arrows cancel out.

from __future__ import annotations

from ..answer_methods import AnswerMethods
from ..board import Board
from ..position import Position, dirs
from ..reasons import Reason
from ..status import Status


def _placed_blacks_beyond(
    board: Board, answer: AnswerMethods, start: Position, delta: Position
) -> int:
    """Count blacks already standing after ``start`` along ``delta``.

    A ``?`` clue counts these whether or not its own number is known, so they are the floor
    under it and come straight off the arrow that runs into it.
    """
    x, y = start.x + delta.x, start.y + delta.y
    placed = 0
    while board.in_board(Position(x, y)):
        if answer.has_black_cell(Position(x, y)):
            placed += 1
        x += delta.x
        y += delta.y
    return placed


def add_white_cell_with_zero(board: Board, answer: AnswerMethods) -> Status:
    advanced = False
    for i, cell in enumerate(board.cell):
        direction = cell.qdir
        if direction in (-1, 0):
            continue
        delta = dirs[direction]
        x, y = i % board.cols + delta.x, i // board.cols + delta.y
        black_count = 0
        while board.in_board(Position(x, y)) and board.cell[y * board.cols + x].qdir != direction:
            if answer.has_black_cell(Position(x, y)):
                black_count += 1
            x += delta.x
            y += delta.y
        next_num = board.cell[y * board.cols + x].qnum if board.in_board(Position(x, y)) else 0
        # This arrow's own count has to be known for the rule to say anything at all.
        if cell.qnum == -2:
            continue
        # The most blacks that can lie between here and the clue this arrow runs into.
        # When that clue is a `?` the subtraction is unavailable, but the far clue still
        # counts every black already standing beyond it, and subtracting those is what
        # makes the bound bite. An arrow reading 1 that runs into a `?` with one black
        # already placed past it has nothing left to spend, so everything in between is
        # white — reading the `?` as merely "nothing or more" throws that away.
        most = (
            cell.qnum - _placed_blacks_beyond(board, answer, Position(x, y), delta)
            if next_num == -2
            else cell.qnum - next_num
        )
        # A `?` leaves nothing subtracted, so the two "subtracted" reasons cannot apply and
        # the deduction is recorded as the plain one it is.
        subtracted = next_num != -2 and next_num > 0

        if most == black_count:
            x, y = i % board.cols + delta.x, i // board.cols + delta.y
            while board.in_board(Position(x, y)) and board.cell[y * board.cols + x].qdir != direction:
                pos = Position(x, y)
                if not answer.forbidden(pos):
                    if black_count > 0 and subtracted:
                        advanced |= answer.add_white_cell(
                            answer, pos, Reason.SubtractedBlackAlreadyPlacedWhite
                        )
                    if black_count > 0:
                        advanced |= answer.add_white_cell(
                            answer, pos, Reason.BlackAlreadyPlacedWhite
                        )
                    elif subtracted:
                        advanced |= answer.add_white_cell(
                            answer, pos, Reason.SubtractedZeroWhite
                        )
                    else:
                        advanced |= answer.add_white_cell(answer, pos, Reason.ZeroWhite)
                x += delta.x
                y += delta.y
    return "advanced" if advanced else "stopped"
