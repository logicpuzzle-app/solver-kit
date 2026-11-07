from __future__ import annotations

from dataclasses import dataclass, field

from .board import Board
from .engine import (
    CellState, EdgeState, Engine, Mark, create_engine, is_solved, mark,
    propagate_engine, remark, set_cell, set_edge, to_solution, undo,
)
from .random import Rng
from .solution import Solution


@dataclass(slots=True)
class SearchLimits:
    limit: int
    max_nodes: int = 0
    black_bias: int = 500


@dataclass(slots=True)
class SearchResult:
    solutions: list[Solution] = field(default_factory=list)
    nodes: int = 0
    aborted: bool = False


def _pick_branch_cell(engine: Engine, rng: Rng | None, buffer: list[int]) -> int:
    best_score = -1
    buffer.clear()
    # Both pick functions scan the whole board at every search node, so the three lists
    # they read are bound once rather than looked up per cell.
    cell = engine.cell
    blank_count = engine.blank_count
    line_count = engine.line_count
    append = buffer.append
    randomised = rng is not None
    for i in range(engine.cell_count):
        if cell[i] != 0:  # CellState.Unknown
            continue
        score = blank_count[i] * 2 + line_count[i]
        if score > best_score:
            best_score = score
            buffer.clear()
            append(i)
        elif randomised and score == best_score:
            append(i)
    if not buffer:
        return -1
    if rng is None or len(buffer) == 1:
        return buffer[0]
    return buffer[rng.next_int(len(buffer))]


def _pick_branch_edge(engine: Engine, rng: Rng | None, buffer: list[int]) -> int:
    fallback = -1
    buffer.clear()
    cell = engine.cell
    edges = engine.edge
    edge_cells = engine.edge_cells
    line_count = engine.line_count
    append = buffer.append
    randomised = rng is not None
    for edge in range(engine.edge_count):
        if edges[edge] != 0:  # EdgeState.Unknown
            continue
        base = edge * 2
        a = edge_cells[base]
        b = edge_cells[base + 1]
        if not (
            (cell[a] == 2 and line_count[a] == 1)  # CellState.Line
            or (cell[b] == 2 and line_count[b] == 1)
        ):
            if fallback < 0:
                fallback = edge
            continue
        append(edge)
        if not randomised:
            break
    if not buffer:
        return fallback
    if len(buffer) == 1:
        return buffer[0]
    return buffer[rng.next_int(len(buffer))]  # type: ignore[union-attr]


def search_engine(engine: Engine, limits: SearchLimits, rng: Rng | None = None) -> SearchResult:
    result = SearchResult()
    buffer: list[int] = []
    marks: list[Mark] = []

    def visit(depth: int) -> None:
        if len(result.solutions) >= limits.limit or result.aborted:
            return
        result.nodes += 1
        if limits.max_nodes > 0 and result.nodes > limits.max_nodes:
            result.aborted = True
            return
        if not propagate_engine(engine):
            return
        if depth == len(marks):
            marks.append(mark(engine))
        saved = marks[depth]
        cell = _pick_branch_cell(engine, rng, buffer)
        if cell >= 0:
            black_first = rng.next_int(1000) < limits.black_bias if rng else True
            first = CellState.Black if black_first else CellState.Line
            second = CellState.Line if black_first else CellState.Black
            remark(engine, saved)
            set_cell(engine, cell, first)
            visit(depth + 1)
            undo(engine, saved)
            if len(result.solutions) >= limits.limit or result.aborted:
                return
            remark(engine, saved)
            set_cell(engine, cell, second)
            visit(depth + 1)
            undo(engine, saved)
            return
        edge = _pick_branch_edge(engine, rng, buffer)
        if edge >= 0:
            line_first = rng.next_boolean() if rng else True
            first = EdgeState.Line if line_first else EdgeState.Blank
            second = EdgeState.Blank if line_first else EdgeState.Line
            remark(engine, saved)
            set_edge(engine, edge, first)
            visit(depth + 1)
            undo(engine, saved)
            if len(result.solutions) >= limits.limit or result.aborted:
                return
            remark(engine, saved)
            set_edge(engine, edge, second)
            visit(depth + 1)
            undo(engine, saved)
            return
        if is_solved(engine):
            result.solutions.append(to_solution(engine))

    root = mark(engine)
    visit(0)
    undo(engine, root)
    return result


def search(board: Board, limits: SearchLimits, rng: Rng | None = None) -> SearchResult:
    return search_engine(create_engine(board), limits, rng)


@dataclass(slots=True)
class PropagationAnalysis:
    coverage: int
    undetermined: list[int]


def analyse_propagation(board: Board) -> PropagationAnalysis:
    engine = create_engine(board)
    if not propagate_engine(engine):
        return PropagationAnalysis(-1, [])
    determined = 0
    undetermined = []
    cells = engine.cell
    for i in range(engine.cell_count):
        if cells[i] != 0:  # CellState.Unknown
            determined += 1
        else:
            undetermined.append(i)
    edges = engine.edge
    for edge in range(engine.edge_count):
        if edges[edge] != 0:  # EdgeState.Unknown
            determined += 1
    return PropagationAnalysis(determined, undetermined)


def propagation_coverage(board: Board) -> int:
    return analyse_propagation(board).coverage


def maximum_coverage(board: Board) -> int:
    engine = create_engine(board)
    return engine.cell_count + engine.edge_count


def count_solutions(board: Board, limit: int = 2, max_nodes: int = 0) -> SearchResult:
    return search(board, SearchLimits(limit, max_nodes))


def has_unique_solution(board: Board, max_nodes: int = 0) -> bool:
    result = count_solutions(board, 2, max_nodes)
    return not result.aborted and len(result.solutions) == 1


def count_loop_routings(
    board: Board, solution: Solution, limit: int = 2, max_nodes: int = 0
) -> SearchResult:
    engine = create_engine(board)
    for i in range(engine.cell_count):
        if engine.cell[i] != CellState.Unknown:
            continue
        x, y = i % engine.cols, i // engine.cols
        set_cell(
            engine, i,
            CellState.Black if ((y << 16) | x) in solution.blacks else CellState.Line,
        )
    if engine.contradiction:
        return SearchResult()
    return search_engine(engine, SearchLimits(limit, max_nodes))


def find_random_solution(
    board: Board, rng: Rng, max_nodes: int = 0, black_bias: int = 500
) -> Solution | None:
    """A random valid solution, or None when the board admits none.

    Deliberately a single search with no restarts; restarting on a wasted node budget was
    measured and reverted (failures cost eight times as much and the success rate fell).
    """
    result = search(board, SearchLimits(1, max_nodes, black_bias), rng)
    return result.solutions[0] if result.solutions else None


INITIAL_RESTARTS = 8
REDRAW_RESTARTS = 3


def draw_solution(
    board: Board, rng: Rng, max_nodes: int = 0, black_bias: int = 500,
    restarts: int = REDRAW_RESTARTS,
) -> Solution | None:
    if max_nodes <= 0:
        return find_random_solution(board, rng, max_nodes, black_bias)
    for _ in range(restarts):
        result = search(board, SearchLimits(1, max_nodes, black_bias), rng)
        if result.solutions:
            return result.solutions[0]
        if not result.aborted:
            return None
    return None


def find_initial_solution(
    board: Board, rng: Rng, max_nodes: int = 0, black_bias: int = 500
) -> Solution | None:
    return draw_solution(board, rng, max_nodes, black_bias, INITIAL_RESTARTS)
