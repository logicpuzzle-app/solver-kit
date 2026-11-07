from __future__ import annotations

from ..answer_methods import AnswerMethods
from ..board import Board, to_id
from ..position import equals
from ..reasons import Reason
from ..status import Status
from .connection_map import ConnectionMap


def _unique(values: list[int]) -> list[int]:
    return list(dict.fromkeys(values))


def closed_line_number_theory(
    board: Board, answer: AnswerMethods, connection: ConnectionMap
) -> Status:
    del board
    mapping, cells, area_count = connection.map, connection.cells, connection.area_count
    inner = [[] for _ in range(area_count)]
    boundary = [[] for _ in range(area_count)]
    nearby = [[] for _ in range(area_count)]
    edges = answer.get_all_edge()
    edge_count = len(edges)
    while True:
        remaining = []
        for pos in edges:
            around_ids = [mapping.get(to_id(pos2)) for pos2, _ in answer.edge_around(pos)]
            if any(value is None for value in around_ids):
                remaining.append(pos)
                continue
            unique_ids = _unique([value for value in around_ids if value is not None])
            if len(unique_ids) == 1:
                inner[unique_ids[0]].append(pos)
                mapping[to_id(pos)] = unique_ids[0]
            else:
                for area_id in unique_ids:
                    boundary[area_id].append(pos)
        edges = remaining
        if not edges:
            break
        if len(edges) == edge_count:
            for pos in edges:
                unique_ids = _unique([
                    value for value in
                    (mapping.get(to_id(pos2)) for pos2, _ in answer.edge_around(pos))
                    if value is not None
                ])
                if len(unique_ids) == 1:
                    nearby[unique_ids[0]].append(pos)
                else:
                    for area_id in unique_ids:
                        boundary[area_id].append(pos)
            break
        edge_count = len(edges)

    for area_id, edge_list in enumerate(nearby):
        for pos in edge_list:
            outside = [
                pos2 for pos2, _ in answer.edge_around(pos) if to_id(pos2) not in mapping
            ]
            if all(
                any(equals(pos2, p) for p in edge_list)
                or any(equals(pos2, p) for p in boundary[area_id])
                for pos2 in outside
            ):
                inner[area_id].append(pos)
                mapping[to_id(pos)] = area_id
            else:
                boundary[area_id].append(pos)

    for area_id in range(area_count):
        if len(cells[area_id]) == 1 and not answer.has_white_cell(cells[area_id][0]):
            continue
        inner_ids = {
            answer.get_edge_id(pos) for pos in inner[area_id]
        }
        if len(boundary[area_id]) == 0:
            if area_count >= 2 and len(inner[area_id]) == 0:
                return "broken"
            if len(inner[area_id]) % 2 == 1:
                return "broken"
            if area_count >= 2 and len(inner_ids) == len(inner[area_id]) / 2:
                return "broken"
        if len(boundary[area_id]) == 1:
            want_inside = len(inner[area_id]) % 2 == 1
            advanced = False
            for pos in boundary[area_id]:
                if advanced:
                    continue
                next_cells = [
                    pos2 for pos2, _ in answer.edge_around(pos)
                    if (mapping.get(to_id(pos2)) == area_id) == want_inside
                ]
                if len(next_cells) == 1:
                    advanced |= answer.add_line(
                        [pos, next_cells[0]], Reason.InvisibleWallByCount
                    )
            if advanced:
                return "advanced"
        if len(boundary[area_id]) == 2 and len(inner[area_id]) % 2 == 0:
            if len(inner_ids) == len(inner[area_id]) / 2:
                advanced = False
                for pos in boundary[area_id]:
                    if advanced:
                        continue
                    next_cells = [
                        pos2 for pos2, _ in answer.edge_around(pos)
                        if mapping.get(to_id(pos2)) == area_id
                    ]
                    if len(next_cells) == 1:
                        advanced |= answer.add_line(
                            [pos, next_cells[0]], Reason.InvisibleWallByGlobalSmallLoop
                        )
                if advanced:
                    return "advanced"
    return "stopped"
