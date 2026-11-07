from __future__ import annotations

from dataclasses import dataclass, field

from .board import to_id, to_pos
from .position import Position, equals
from .unionfind import UnionFind


class LineState:
    """Plain int constants rather than an IntEnum.

    Nothing here needs enum behaviour, and member access plus comparison on an IntEnum is
    a measurable cost when the technique solver reads line states millions of times per
    puzzle. The values and every comparison stay exactly the same.
    """

    None_ = -1
    Blank = 0
    Line = 1
    Bar = 2


@dataclass(slots=True)
class AnswerModel:
    # dict keys reproduce JavaScript Set insertion/deletion/reinsertion order.
    black_cells: dict[int, None] = field(default_factory=dict)
    white_cells: dict[int, None] = field(default_factory=dict)
    edge: dict[int, int] = field(default_factory=dict)
    line_uf: UnionFind = field(default_factory=UnionFind)
    inner_line: dict[int, None] = field(default_factory=dict)
    horizontal: dict[int, LineState] = field(default_factory=dict)
    vertical: dict[int, LineState] = field(default_factory=dict)
    has_loop: bool = False


def create_answer_model() -> AnswerModel:
    return AnswerModel()


def normalize(answer: AnswerModel, new_line: list[Position]) -> None:
    new_end1 = to_id(new_line[0])
    new_end2 = to_id(new_line[-1])
    prev_end1 = answer.edge.get(new_end1)
    prev_end2 = answer.edge.get(new_end2)
    if prev_end1 is not None and prev_end2 is not None and new_end1 != prev_end2:
        for i, pos in enumerate(new_line):
            pos_id = to_id(pos)
            if i == 0 or i == len(new_line) - 1:
                answer.edge.pop(pos_id, None)
            answer.inner_line[pos_id] = None
            answer.white_cells.pop(pos_id, None)
        answer.edge[prev_end1] = prev_end2
        answer.edge[prev_end2] = prev_end1
    elif prev_end1 is not None:
        for i, pos in enumerate(new_line):
            pos_id = to_id(pos)
            if i != len(new_line) - 1:
                answer.inner_line[pos_id] = None
            answer.white_cells.pop(pos_id, None)
        answer.edge.pop(new_end1, None)
        answer.edge[new_end2] = prev_end1
        answer.edge[prev_end1] = new_end2
        if prev_end2 is not None:
            answer.edge.pop(new_end2, None)
            answer.inner_line[new_end2] = None
            answer.has_loop = True
    elif prev_end2 is not None:
        for i, pos in enumerate(new_line):
            pos_id = to_id(pos)
            if i != 0:
                answer.inner_line[pos_id] = None
            answer.white_cells.pop(pos_id, None)
        answer.edge[new_end1] = prev_end2
        answer.edge[prev_end2] = new_end1
        answer.edge.pop(new_end2, None)
    else:
        for i, pos in enumerate(new_line):
            pos_id = to_id(pos)
            if i != 0 and i != len(new_line) - 1:
                answer.inner_line[pos_id] = None
            answer.white_cells.pop(pos_id, None)
        answer.edge[new_end1] = new_end2
        answer.edge[new_end2] = new_end1


def add_line(answer: AnswerModel, line: list[Position]) -> None:
    for prev, cur in zip(line, line[1:]):
        answer.line_uf.connect(to_id(prev), to_id(cur))
        if prev.x == cur.x:
            answer.vertical[to_id(prev if prev.y < cur.y else cur)] = LineState.Line
        if prev.y == cur.y:
            answer.horizontal[to_id(prev if prev.x < cur.x else cur)] = LineState.Line
    normalize(answer, line)


def is_loop(line: list[Position]) -> bool:
    return len(line) > 2 and equals(line[0], line[-1])


def has_line(answer: AnswerModel, pos_id: int) -> bool:
    return pos_id in answer.inner_line


def is_line_edge(answer: AnswerModel, pos: Position) -> bool:
    return ((pos.y << 16) | pos.x) in answer.edge


def get_edge_id(answer: AnswerModel, pos: Position) -> int | None:
    return answer.edge.get((pos.y << 16) | pos.x)


def get_line_state(answer: AnswerModel, pos1: Position, pos2: Position) -> LineState | None:
    # to_id inlined: called a few million times per puzzle.
    x1 = pos1.x
    y1 = pos1.y
    x2 = pos2.x
    y2 = pos2.y
    if x1 == x2:
        return answer.vertical.get(((y1 if y1 < y2 else y2) << 16) | x1)
    if y1 == y2:
        return answer.horizontal.get((y1 << 16) | (x1 if x1 < x2 else x2))
    return LineState.None_


def set_line_bar(answer: AnswerModel, pos1: Position, pos2: Position) -> None:
    x1 = pos1.x
    y1 = pos1.y
    x2 = pos2.x
    y2 = pos2.y
    if x1 == x2:
        answer.vertical[((y1 if y1 < y2 else y2) << 16) | x1] = LineState.Bar
    if y1 == y2:
        answer.horizontal[(y1 << 16) | (x1 if x1 < x2 else x2)] = LineState.Bar


def is_line_connection(answer: AnswerModel, pos1: Position, pos2: Position) -> bool:
    # The original builds a throwaway Position for the key; the id is computed directly.
    x1 = pos1.x
    y1 = pos1.y
    x2 = pos2.x
    y2 = pos2.y
    if x1 == x2:
        return answer.vertical.get(((y1 if y1 < y2 else y2) << 16) | x1) == 1
    if y1 == y2:
        return answer.horizontal.get((y1 << 16) | (x1 if x1 < x2 else x2)) == 1
    return False


def has_line_with_end(answer: AnswerModel, pos: Position) -> bool:
    pos_id = (pos.y << 16) | pos.x
    return pos_id in answer.inner_line or pos_id in answer.edge


def is_same_line(answer: AnswerModel, pos1: Position, pos2: Position) -> bool:
    return answer.line_uf.is_union(to_id(pos1), to_id(pos2))


def is_single_line(answer: AnswerModel) -> bool:
    return len(answer.edge) <= 2 and len(answer.white_cells) <= 2 and len(answer.inner_line) >= 2


def add_black_cell(cells: dict[int, None], pos: Position) -> dict[int, None]:
    cells[to_id(pos)] = None
    return cells


def add_white_cell(cells: dict[int, None], pos: Position) -> dict[int, None]:
    cells[to_id(pos)] = None
    return cells


def get_black_cells(cells: dict[int, None]) -> list[Position]:
    return [to_pos(value) for value in list(cells)]


def get_white_cells(cells: dict[int, None]) -> list[Position]:
    return [to_pos(value) for value in list(cells)]


def get_all_edge(answer: AnswerModel) -> list[Position]:
    return [to_pos(value) for value in list(answer.edge)]


def clone(answer: AnswerModel) -> AnswerModel:
    return AnswerModel(
        black_cells=dict(answer.black_cells),
        white_cells=dict(answer.white_cells),
        edge=dict(answer.edge),
        line_uf=UnionFind.from_uf(answer.line_uf),
        inner_line=dict(answer.inner_line),
        horizontal=dict(answer.horizontal),
        vertical=dict(answer.vertical),
        has_loop=False,
    )
