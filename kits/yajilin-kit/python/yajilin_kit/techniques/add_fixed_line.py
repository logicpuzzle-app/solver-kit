from __future__ import annotations

from ..answer_methods import AnswerMethods
from ..board import Board
from ..position import Position, add, dir_list
from ..reasons import Reason
from ..status import Status


def _fixed_edge(answer: AnswerMethods, target: Position) -> Status:
    advanced = False
    enables = answer.edge_around(target)
    if len(enables) == 1:
        advanced |= answer.add_line([target, enables[0][0]], Reason.ExtendLineEnd)
    elif len(enables) == 2:
        if not answer.is_single_line() and answer.is_same_line(target, enables[0][0]):
            advanced |= answer.add_line([target, enables[1][0]], Reason.SmallLoopBan)
        elif not answer.is_single_line() and answer.is_same_line(target, enables[1][0]):
            advanced |= answer.add_line([target, enables[0][0]], Reason.SmallLoopBanExtension)
    elif len(enables) == 0:
        return "broken"
    elif len(enables) == 3:
        for pos, _ in enables:
            if not answer.is_single_line() and answer.is_same_line(target, pos):
                answer.set_line_bar(target, pos)
                advanced = True
    return "advanced" if advanced else "stopped"


def _fixed_white(answer: AnswerMethods, target: Position) -> Status:
    advanced = False
    enables = answer.edge_around(target)
    if len(enables) == 2:
        advanced |= answer.add_line(
            [add(target, enables[0][1]), target, add(target, enables[1][1])],
            Reason.LineFixed,
        )
    elif len(enables) <= 1:
        return "broken"
    elif len(enables) == 3:
        not_edges = [item for item in enables if not answer.is_line_edge(item[0])]
        edges = [item for item in enables if answer.is_line_edge(item[0])]
        if (
            len(not_edges) == 1 and not answer.is_single_line()
            and answer.is_same_line(edges[0][0], edges[1][0])
        ):
            advanced |= answer.add_line([target, not_edges[0][0]], Reason.SimpleLoopTechnique)
    return "advanced" if advanced else "stopped"


def add_fixed_line_with_target(answer: AnswerMethods, target: Position) -> Status:
    # Bound methods hoisted into locals: this runs once per free cell per pass, and the
    # attribute lookups alone were a measurable share of the solve time.
    is_line_edge = answer.is_line_edge
    edge_around = answer.edge_around
    forbidden = answer.forbidden
    is_single_line = answer.is_single_line
    is_same_line = answer.is_same_line
    add_white_cell = answer.add_white_cell
    add_black_cell = answer.add_black_cell

    advanced = False
    if is_line_edge(target):
        status = _fixed_edge(answer, target)
        if status == "broken":
            return status
        advanced |= status == "advanced"
    elif answer.has_white_cell(target):
        status = _fixed_white(answer, target)
        if status == "broken":
            return status
        advanced |= status == "advanced"
    else:
        enables = edge_around(target)
        target_advanced = False
        if len(enables) <= 1:
            flag = add_black_cell(answer, target, Reason.UnreachableBlack)
            advanced |= flag
            target_advanced |= flag
        elif len(enables) == 2:
            if not is_single_line() and is_same_line(enables[0][0], enables[1][0]):
                flag = add_black_cell(answer, target, Reason.SmallLoopBanBlack)
                advanced |= flag
                target_advanced |= flag
        if not target_advanced:
            # forEach in the source keeps visiting even after a deduction.
            for pos, direction in enables:
                if is_line_edge(pos):
                    continue
                enables2 = edge_around(pos)
                if len(enables2) == 2:
                    flag = add_white_cell(answer, target, Reason.ExitTechnique)
                    advanced |= flag
                    target_advanced |= flag
                elif len(enables2) == 3:
                    others = [
                        item for item in enables2
                        if direction.x + item[1].x != 0 or direction.y + item[1].y != 0
                    ]
                    if (
                        not is_single_line()
                        and is_same_line(add(pos, others[0][1]), add(pos, others[1][1]))
                    ):
                        flag = add_white_cell(answer, target, Reason.SmallLoopBanWhite)
                        advanced |= flag
                        target_advanced |= flag
        if not target_advanced:
            for direction in (
                Position(1, 1), Position(1, -1), Position(-1, 1), Position(-1, -1)
            ):
                if not is_line_edge(Position(target.x + direction.x, target.y + direction.y)):
                    continue
                hp = Position(target.x + direction.x, target.y)
                vp = Position(target.x, target.y + direction.y)
                if forbidden(hp) or forbidden(vp):
                    continue
                hdirs = [d for d in dir_list if not forbidden(add(hp, d))]
                vdirs = [d for d in dir_list if not forbidden(add(vp, d))]
                if (
                    (len(hdirs) == 2 or (not is_line_edge(hp) and len(hdirs) == 3))
                    and (len(vdirs) == 2 or (not is_line_edge(vp) and len(vdirs) == 3))
                ):
                    advanced |= add_white_cell(answer, target, Reason.BranchBanWhite)
    return "advanced" if advanced else "stopped"


def add_fixed_line(board: Board, answer: AnswerMethods) -> Status:
    advanced = False
    for i in range(len(board.cell)):
        target = Position(i % board.cols, i // board.cols)
        if answer.forbidden(target):
            continue
        status = add_fixed_line_with_target(answer, target)
        if status == "broken":
            return status
        advanced |= status == "advanced"
    return "advanced" if advanced else "stopped"
