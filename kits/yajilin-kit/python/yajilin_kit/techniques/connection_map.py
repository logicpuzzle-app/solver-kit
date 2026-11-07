from __future__ import annotations

from dataclasses import dataclass

from ..answer_methods import AnswerMethods
from ..board import Board, to_id, to_pos
from ..position import Position


@dataclass(slots=True)
class ConnectionMap:
    map: dict[int, int]
    cells: list[list[Position]]
    area_count: int


def create_connection_map(board: Board, answer: AnswerMethods) -> ConnectionMap:
    mapping: dict[int, int] = {}

    def dfs(pos: Position, area_id: int) -> None:
        mapping[to_id(pos)] = area_id
        for pos2, _ in answer.edge_around(pos):
            if answer.is_line_edge(pos2) or answer.forbidden(pos2) or to_id(pos2) in mapping:
                continue
            dfs(pos2, area_id)

    area_count = 0
    for i in range(len(board.cell)):
        pos = Position(i % board.cols, i // board.cols)
        if answer.forbidden(pos) or answer.is_line_edge(pos) or to_id(pos) in mapping:
            continue
        dfs(pos, area_count)
        area_count += 1
    cells = [[] for _ in range(area_count)]
    for key, area_id in mapping.items():
        cells[area_id].append(to_pos(key))
    return ConnectionMap(mapping, cells, area_count)
