"""カットの偶奇。ループは閉路なので、盤面を縦または横の直線で 2 つに分けたとき、
その境界を横切る線分の本数は必ず偶数になる。さらにヤジリンの線は黒マス以外の
すべての白マスを通る一本のループなので、カットの両側に「必ず通るマス」があるなら
横断は 2 本以上でもある。詳細は Rust 版 techniques/cut_parity.rs を参照。
"""

from __future__ import annotations

from ..answer_methods import AnswerMethods
from ..answer_model import LineState
from ..board import Board
from ..position import Position
from ..reasons import Reason
from ..status import Status


def _strip_must_be_visited(
    board: Board, answer: AnswerMethods, vertical: bool, start: int, stop: int
) -> bool:
    inner = board.rows if vertical else board.cols
    for t in range(start, stop):
        for u in range(inner):
            pos = Position(t, u) if vertical else Position(u, t)
            if not board.in_board(pos):
                continue
            if board.cell[pos.y * board.cols + pos.x].qnum != -1:
                continue
            if (
                answer.has_white_cell(pos)
                or answer.has_line(pos)
                or answer.is_line_edge(pos)
            ):
                return True
            # ヒントでない隣接ペア: 黒は隣接できないので、少なくとも一方は白=必通
            for nxt in (Position(pos.x + 1, pos.y), Position(pos.x, pos.y + 1)):
                in_strip = nxt.x < stop if vertical else nxt.y < stop
                if (
                    in_strip
                    and board.in_board(nxt)
                    and board.cell[nxt.y * board.cols + nxt.x].qnum == -1
                ):
                    return True
    return False


def cut_parity(board: Board, answer: AnswerMethods) -> Status:
    advanced = False
    for vertical in (True, False):
        cuts = board.cols if vertical else board.rows
        length = board.rows if vertical else board.cols
        for c in range(1, cuts):
            lines = 0
            unknowns: list[tuple[Position, Position]] = []
            for t in range(length):
                if vertical:
                    a, b = Position(c - 1, t), Position(c, t)
                else:
                    a, b = Position(t, c - 1), Position(t, c)
                state = answer.get_line_state(a, b)
                if state == LineState.Line:
                    lines += 1
                elif (
                    state == LineState.Bar
                    or answer.forbidden(a)
                    or answer.forbidden(b)
                ):
                    pass  # この辺は横断できない
                else:
                    unknowns.append((a, b))
            both_visited = _strip_must_be_visited(
                board, answer, vertical, 0, c
            ) and _strip_must_be_visited(board, answer, vertical, c, cuts)
            low = max(lines, 2) if both_visited else lines
            high = lines + len(unknowns)
            c_min = low if low % 2 == 0 else low + 1
            c_max = high if high % 2 == 0 else high - 1
            if c_min > c_max:
                return "broken"
            if not unknowns or c_min != c_max:
                continue
            if c_max == high:
                for a, b in unknowns:
                    if answer.add_line([a, b], Reason.CutParityLine):
                        advanced = True
            elif c_min == lines:
                for a, b in unknowns:
                    answer.set_line_bar(a, b)
                    advanced = True
    return "advanced" if advanced else "stopped"
