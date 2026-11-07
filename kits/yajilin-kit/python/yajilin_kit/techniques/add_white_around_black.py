from __future__ import annotations

from ..answer_methods import AnswerMethods
from ..position import around
from ..reasons import Reason
from ..status import Status


def add_white_around_black(answer: AnswerMethods) -> Status:
    advanced = False
    for black in answer.get_black_cells():
        for pos, _ in around(black):
            if not answer.forbidden(pos):
                advanced |= answer.add_white_cell(answer, pos, Reason.WhiteAroundBlack)
    return "advanced" if advanced else "stopped"
