from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Position:
    x: int
    y: int


def equals(a: Position, b: Position) -> bool:
    return a.x == b.x and a.y == b.y


dirs = {
    1: Position(0, -1),
    2: Position(0, 1),
    3: Position(-1, 0),
    4: Position(1, 0),
}
dir_list = [dirs[1], dirs[2], dirs[3], dirs[4]]


def around(pos: Position) -> list[tuple[Position, Position]]:
    return [(Position(pos.x + d.x, pos.y + d.y), d) for d in dir_list]


def add(a: Position, b: Position) -> Position:
    return Position(a.x + b.x, a.y + b.y)


def subtract(a: Position, b: Position) -> Position:
    return Position(a.x - b.x, a.y - b.y)
