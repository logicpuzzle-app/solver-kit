from __future__ import annotations

from ..answer_methods import AnswerMethods
from ..position import Position, around
from ..reasons import Reason
from ..status import Status


def add_white_around_single_black(answer: AnswerMethods, black: Position) -> Status:
    advanced = False
    broken = False
    for pos, _ in around(black):
        if not answer.forbidden(pos):
            advanced |= answer.add_white_cell(answer, pos, Reason.WhiteAroundBlack)
        elif answer.has_black_cell(pos):
            broken = True
    if broken:
        return "broken"
    return "advanced" if advanced else "stopped"
