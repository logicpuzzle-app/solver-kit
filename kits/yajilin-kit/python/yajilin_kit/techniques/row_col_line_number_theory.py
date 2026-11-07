from __future__ import annotations

from ..answer_methods import AnswerMethods
from ..answer_model import LineState
from ..board import Board, to_id
from ..position import Position
from ..reasons import Reason
from ..status import Status


def row_col_line_number_theory(board: Board, answer: AnswerMethods) -> Status:
    for r in range(1, board.rows - 1):
        up = down = 0
        spaces: list[Position] = []
        c = 0
        while c < board.cols:
            pos, posu, posd = Position(c, r), Position(c, r - 1), Position(c, r + 1)
            if answer.has_black_cell(pos) or board.cell[r * board.cols + c].qnum != -1:
                c += 1
                continue
            if (
                to_id(pos) in answer.black_candidates_horizontal
                and not answer.forbidden(pos) and not answer.forbidden(Position(c + 1, r))
                and (answer.forbidden(Position(c - 1, r))
                     or answer.get_line_state(pos, Position(c - 1, r)) == LineState.Bar)
                and (answer.forbidden(Position(c + 2, r))
                     or answer.get_line_state(Position(c + 1, r), Position(c + 2, r)) == LineState.Bar)
            ):
                up += 1
                down += 1
                c += 2
                continue
            if answer.is_line_connection(pos, posu):
                up += 1
            if answer.is_line_connection(pos, posd):
                down += 1
            if not answer.has_line(pos) and not (
                (answer.forbidden(posu) or answer.get_line_state(pos, posu) == LineState.Bar)
                and (answer.forbidden(posd) or answer.get_line_state(pos, posd) == LineState.Bar)
            ):
                spaces.append(pos)
            c += 1
        if len(spaces) == 2:
            flag = False
            if spaces[0].y + 1 == spaces[1].y and up % 2 == 0 and down % 2 == 0:
                flag |= answer.add_white_cell(answer, spaces[0], Reason.RowCountTwoWhite)
                flag |= answer.add_white_cell(answer, spaces[1], Reason.RowCountTwoWhite)
            if up == 0 and down == 0:
                flag |= answer.add_white_cell(answer, spaces[0], Reason.RowGlobalSmallLoopTwoWhite)
                flag |= answer.add_white_cell(answer, spaces[1], Reason.RowGlobalSmallLoopTwoWhite)
            if spaces[0].y + 1 == spaces[1].y and up == 0 and down == 0:
                answer.set_line_bar(spaces[0], spaces[1])
            if flag:
                return "advanced"
        if len(spaces) == 1:
            pos = spaces[0]
            if up % 2 == 0 and down % 2 == 0:
                if answer.add_black_cell(answer, pos, Reason.RowCountBlack):
                    return "advanced"
            elif up % 2 == 1 and down % 2 == 1:
                if answer.add_white_cell(answer, pos, Reason.RowCountWhite):
                    return "advanced"
            elif up % 2 == 1 and down % 2 == 0:
                if answer.add_line([pos, Position(pos.x, pos.y - 1)], Reason.RowCountLine):
                    return "advanced"
            elif up % 2 == 0 and down % 2 == 1:
                if answer.add_line([pos, Position(pos.x, pos.y + 1)], Reason.RowCountLine):
                    return "advanced"
        elif len(spaces) == 0 and up % 2 != 0 and down % 2 != 0:
            return "broken"

    for c in range(1, board.cols - 1):
        left = right = 0
        spaces = []
        r = 0
        while r < board.rows:
            pos, posl, posr = Position(c, r), Position(c - 1, r), Position(c + 1, r)
            if answer.has_black_cell(pos) or board.cell[r * board.cols + c].qnum != -1:
                r += 1
                continue
            if (
                to_id(pos) in answer.black_candidates_vertical
                and (answer.forbidden(Position(c, r - 1))
                     or answer.get_line_state(pos, Position(c, r - 1)) == LineState.Bar)
                and (answer.forbidden(Position(c, r + 2))
                     or answer.get_line_state(Position(c, r + 1), Position(c, r + 2)) == LineState.Bar)
            ):
                left += 1
                right += 1
                r += 2
                continue
            if answer.is_line_connection(pos, posl):
                left += 1
            if answer.is_line_connection(pos, posr):
                right += 1
            if not answer.has_line(pos) and not (
                (answer.forbidden(posl) or answer.get_line_state(pos, posl) == LineState.Bar)
                and (answer.forbidden(posr) or answer.get_line_state(pos, posr) == LineState.Bar)
            ):
                spaces.append(pos)
            r += 1
        if len(spaces) == 2:
            flag = False
            if spaces[0].y + 1 == spaces[1].y and left % 2 == 0 and right % 2 == 0:
                flag |= answer.add_white_cell(answer, spaces[0], Reason.ColCountTwoWhite)
                flag |= answer.add_white_cell(answer, spaces[1], Reason.ColCountTwoWhite)
            if left == 0 and right == 0:
                flag |= answer.add_white_cell(answer, spaces[0], Reason.ColGlobalSmallLoopTwoWhite)
                flag |= answer.add_white_cell(answer, spaces[1], Reason.ColGlobalSmallLoopTwoWhite)
            if spaces[0].y + 1 == spaces[1].y and left == 0 and right == 0:
                answer.set_line_bar(spaces[0], spaces[1])
            if flag:
                return "advanced"
        if len(spaces) == 1:
            pos = spaces[0]
            if left % 2 == 0 and right % 2 == 0:
                if answer.add_black_cell(answer, pos, Reason.ColCountBlack):
                    return "advanced"
            if left % 2 == 1 and right % 2 == 1:
                if answer.add_white_cell(answer, pos, Reason.ColCountWhite):
                    return "advanced"
            if left % 2 == 1 and right % 2 == 0:
                if answer.add_line([pos, Position(pos.x - 1, pos.y)], Reason.ColCountLine):
                    return "advanced"
            if left % 2 == 0 and right % 2 == 1:
                if answer.add_line([pos, Position(pos.x + 1, pos.y)], Reason.ColCountLine):
                    return "advanced"
        elif len(spaces) == 0 and left % 2 != 0 and right % 2 != 0:
            return "broken"
    return "stopped"
