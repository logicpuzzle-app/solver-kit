from __future__ import annotations

from dataclasses import dataclass, field

from .answer_model import AnswerModel, LineState
from .board import Board, cell_at, to_id, to_pos
from .position import Position, dirs


@dataclass(slots=True)
class Solution:
    blacks: dict[int, None] = field(default_factory=dict)
    horizontal: dict[int, None] = field(default_factory=dict)
    vertical: dict[int, None] = field(default_factory=dict)


def create_solution() -> Solution:
    return Solution()


def extract_solution(answer: AnswerModel) -> Solution:
    result = create_solution()
    result.blacks = dict(answer.black_cells)
    result.horizontal = {key: None for key, state in answer.horizontal.items() if state == LineState.Line}
    result.vertical = {key: None for key, state in answer.vertical.items() if state == LineState.Line}
    return result


def solution_key(board: Board, solution: Solution) -> str:
    parts = []
    for i in range(len(board.cell)):
        parts.append("1" if to_id(Position(i % board.cols, i // board.cols)) in solution.blacks else "0")
    parts.append("|")
    for i in range(len(board.cell)):
        pos_id = to_id(Position(i % board.cols, i // board.cols))
        parts.append("1" if pos_id in solution.horizontal else "0")
        parts.append("1" if pos_id in solution.vertical else "0")
    return "".join(parts)


def count_blacks_along_arrow(board: Board, solution: Solution, origin: Position, direction: int) -> int:
    delta = dirs[direction]
    x, y, count = origin.x + delta.x, origin.y + delta.y, 0
    while board.in_board(Position(x, y)):
        if to_id(Position(x, y)) in solution.blacks:
            count += 1
        x += delta.x
        y += delta.y
    return count


def _neighbours(board: Board, solution: Solution, pos: Position) -> list[Position]:
    values = []
    if to_id(Position(pos.x, pos.y - 1)) in solution.vertical:
        values.append(Position(pos.x, pos.y - 1))
    if to_id(pos) in solution.vertical:
        values.append(Position(pos.x, pos.y + 1))
    if to_id(Position(pos.x - 1, pos.y)) in solution.horizontal:
        values.append(Position(pos.x - 1, pos.y))
    if to_id(pos) in solution.horizontal:
        values.append(Position(pos.x + 1, pos.y))
    return [p for p in values if board.in_board(p)]


def validate_solution(board: Board, solution: Solution) -> list[dict]:
    errors: list[dict] = []

    def blocked(pos: Position) -> bool:
        return (
            not board.in_board(pos) or to_id(pos) in solution.blacks
            or cell_at(board, pos).qnum != -1
        )

    for value in solution.horizontal:
        pos = to_pos(value)
        right = Position(pos.x + 1, pos.y)
        if blocked(pos):
            errors.append({"kind": "line-on-blocked-cell", "pos": pos})
        if blocked(right):
            errors.append({"kind": "line-on-blocked-cell", "pos": right})
    for value in solution.vertical:
        pos = to_pos(value)
        down = Position(pos.x, pos.y + 1)
        if blocked(pos):
            errors.append({"kind": "line-on-blocked-cell", "pos": pos})
        if blocked(down):
            errors.append({"kind": "line-on-blocked-cell", "pos": down})
    loop_cells = []
    for i, cell in enumerate(board.cell):
        pos = Position(i % board.cols, i // board.cols)
        black = to_id(pos) in solution.blacks
        clue = cell.qnum != -1
        if black and clue:
            errors.append({"kind": "black-on-clue", "pos": pos})
            continue
        if black:
            for other in (Position(pos.x + 1, pos.y), Position(pos.x, pos.y + 1)):
                if board.in_board(other) and to_id(other) in solution.blacks:
                    errors.append({"kind": "adjacent-blacks", "pos": pos, "other": other})
            continue
        if clue:
            continue
        degree = len(_neighbours(board, solution, pos))
        if degree == 0:
            errors.append({"kind": "cell-not-covered", "pos": pos})
        elif degree != 2:
            errors.append({"kind": "degree", "pos": pos, "degree": degree})
        else:
            loop_cells.append(pos)
    if errors:
        return errors
    if loop_cells:
        seen = {to_id(loop_cells[0])}
        stack = [loop_cells[0]]
        while stack:
            pos = stack.pop()
            for nxt in _neighbours(board, solution, pos):
                if to_id(nxt) not in seen:
                    seen.add(to_id(nxt))
                    stack.append(nxt)
        if len(seen) != len(loop_cells):
            errors.append({"kind": "not-single-loop", "pos": loop_cells[0]})
    for i, cell in enumerate(board.cell):
        if cell.qdir in (-1, 0) or cell.qnum < 0:
            continue
        pos = Position(i % board.cols, i // board.cols)
        actual = count_blacks_along_arrow(board, solution, pos, cell.qdir)
        if actual != cell.qnum:
            errors.append({"kind": "arrow-count", "pos": pos, "expected": cell.qnum, "actual": actual})
    return errors


def describe_validation_error(error: dict) -> str:
    def at(pos: Position) -> str:
        return f"({pos.x + 1},{pos.y + 1})"
    kind = error["kind"]
    if kind == "black-on-clue":
        return f"black cell on a clue at {at(error['pos'])}"
    if kind == "adjacent-blacks":
        return f"adjacent black cells at {at(error['pos'])} and {at(error['other'])}"
    if kind == "line-on-blocked-cell":
        return f"line runs through a blocked cell at {at(error['pos'])}"
    if kind == "cell-not-covered":
        return f"cell not covered by the loop at {at(error['pos'])}"
    if kind == "degree":
        return f"cell at {at(error['pos'])} has {error['degree']} line ends"
    if kind == "not-single-loop":
        return "the line forms more than one loop"
    return f"arrow at {at(error['pos'])} expects {error['expected']} black cells but sees {error['actual']}"
