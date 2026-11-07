from __future__ import annotations

import re

from .board import Board, create_board, to_id
from .position import Position
from .solution import Solution

DIR_CHARS = {1: "^", 2: "v", 3: "<", 4: ">"}
CHAR_DIRS = {"^": 1, "v": 2, "<": 3, ">": 4}


def parse_problem_text(text: str) -> Board:
    lines = [line.strip() for line in text.split("\n")
             if line.strip() and not line.strip().startswith("#")]
    if not lines:
        raise ValueError("empty problem")
    header = re.split(r"\s+", lines[0])
    if header[0] == "yajilin":
        header = header[1:]
    try:
        cols, rows = int(header[0]), int(header[1])
    except (ValueError, IndexError):
        raise ValueError(f"invalid size header: {lines[0]}") from None
    board = create_board(cols, rows)
    body = lines[1:]
    if len(body) != rows:
        raise ValueError(f"expected {rows} rows, found {len(body)}")
    for y, line in enumerate(body):
        tokens = re.split(r"\s+", line)
        if len(tokens) != cols:
            raise ValueError(f"row {y + 1}: expected {cols} cells, found {len(tokens)}")
        for x, token in enumerate(tokens):
            cell = board.cell[y * cols + x]
            if token == ".":
                continue
            if token == "+":
                cell.qdir, cell.qnum = 0, -3
                continue
            direction = CHAR_DIRS.get(token[0])
            if direction is None:
                raise ValueError(f"row {y + 1}, cell {x + 1}: unknown token {token}")
            cell.qdir = direction
            rest = token[1:]
            if rest in ("?", ""):
                cell.qnum = -2
            else:
                try:
                    cell.qnum = int(rest)
                except ValueError:
                    raise ValueError(f"row {y + 1}, cell {x + 1}: invalid clue {token}") from None
                if cell.qnum < 0:
                    raise ValueError(f"row {y + 1}, cell {x + 1}: invalid clue {token}")
    return board


def _problem_token(qdir: int, qnum: int) -> str:
    if qnum == -1:
        return "."
    if qnum == -3:
        return "+"
    char = DIR_CHARS.get(qdir, "*")
    return f"{char}?" if qnum == -2 else f"{char}{qnum}"


def format_problem_text(board: Board) -> str:
    lines = [f"yajilin {board.cols} {board.rows}"]
    for y in range(board.rows):
        lines.append(" ".join(_problem_token(board.cell[y * board.cols + x].qdir,
                                             board.cell[y * board.cols + x].qnum)
                              for x in range(board.cols)))
    return "\n".join(lines) + "\n"


def _loop_char(up: bool, down: bool, left: bool, right: bool) -> str:
    if up and down: return "|"
    if left and right: return "-"
    if up and right: return "L"
    if up and left: return "J"
    if down and right: return "r"
    if down and left: return "7"
    if up or down: return "|"
    if left or right: return "-"
    return "o"


def format_answer_grid(board: Board, solution: Solution) -> str:
    lines = []
    for y in range(board.rows):
        row = ""
        for x in range(board.cols):
            pos = Position(x, y)
            value = to_id(pos)
            cell = board.cell[y * board.cols + x]
            if value in solution.blacks:
                row += "#"
            elif cell.qnum != -1:
                row += "+" if cell.qnum == -3 else DIR_CHARS.get(cell.qdir, "*")
            else:
                up = to_id(Position(x, y - 1)) in solution.vertical
                down = value in solution.vertical
                left = to_id(Position(x - 1, y)) in solution.horizontal
                right = value in solution.horizontal
                row += _loop_char(up, down, left, right) if up or down or left or right else "."
            if x < board.cols - 1:
                row += "-" if value in solution.horizontal else " "
        lines.append(row)
        if y < board.rows - 1:
            between = ""
            for x in range(board.cols):
                between += "|" if to_id(Position(x, y)) in solution.vertical else " "
                if x < board.cols - 1:
                    between += " "
            lines.append(between)
    return "\n".join(lines) + "\n"


def _positions_of(values: dict[int, None]) -> str:
    return " ".join(f"{(value & 0xff) + 1},{(value >> 16) + 1}" for value in sorted(values))


def format_solution_summary(solution: Solution) -> str:
    return "\n".join([
        f"BLACK {_positions_of(solution.blacks)}".rstrip(),
        f"HLINE {_positions_of(solution.horizontal)}".rstrip(),
        f"VLINE {_positions_of(solution.vertical)}".rstrip(),
    ]) + "\n"
