from __future__ import annotations

from dataclasses import dataclass

from .position import Position

max_size = 256


@dataclass(slots=True)
class Cell:
    qdir: int = -1
    qnum: int = -1


@dataclass(slots=True)
class Board:
    cell: list[Cell]
    cols: int
    rows: int

    def in_board(self, pos: Position) -> bool:
        return 0 <= pos.x < self.cols and 0 <= pos.y < self.rows


def to_id(pos: Position) -> int:
    return (pos.y << 16) | pos.x


def to_pos(value: int) -> Position:
    return Position(value & 0xFF, value >> 16)


def create_board(cols: int, rows: int) -> Board:
    return Board([Cell() for _ in range(cols * rows)], cols, rows)


def clone_board(board: Board) -> Board:
    copy = create_board(board.cols, board.rows)
    for i, cell in enumerate(board.cell):
        copy.cell[i].qdir = cell.qdir
        copy.cell[i].qnum = cell.qnum
    return copy


def cell_at(board: Board, pos: Position) -> Cell:
    return board.cell[pos.y * board.cols + pos.x]


def is_clue(board: Board, pos: Position) -> bool:
    return cell_at(board, pos).qnum != -1
