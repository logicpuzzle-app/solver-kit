from __future__ import annotations

from dataclasses import dataclass, field

from .board import Board, to_id
from .position import Position, dirs
from .solution import Solution, create_solution


class CellState:
    """Plain int constants; see the note on LineState in answer_model."""

    Unknown = 0
    Black = 1
    Line = 2
    Blocked = 3


class EdgeState:
    Unknown = 0
    Line = 1
    Blank = 2


TRAIL_CELL, TRAIL_EDGE, TRAIL_LINE_COUNT, TRAIL_BLANK_COUNT, TRAIL_PARENT, TRAIL_SIZE = range(6)


@dataclass(slots=True)
class Clue:
    cell: int
    dir: int
    count: int
    ray: list[int]


@dataclass(slots=True)
class Mark:
    trail: int
    unknown_cells: int
    line_cells: int
    contradiction: bool
    loop_closed: bool
    loop_root: int


@dataclass(slots=True)
class Engine:
    cols: int
    rows: int
    cell_count: int
    edge_count: int
    h_count: int
    cell: list[int]
    edge: list[int]
    line_count: list[int]
    blank_count: list[int]
    incident: list[int]
    edge_cells: list[int]
    neighbours: list[int]
    parent: list[int]
    size: list[int]
    unknown_cells: int
    line_cells: int = 0
    contradiction: bool = False
    loop_closed: bool = False
    loop_root: int = -1
    changed: bool = False
    clues: list[Clue] = field(default_factory=list)
    trail: list[int] = field(default_factory=list)
    forced: list[int] = field(default_factory=list)
    cell_queue: list[int] = field(default_factory=list)
    in_cell_queue: list[int] = field(default_factory=list)
    clue_queue: list[int] = field(default_factory=list)
    in_clue_queue: list[int] = field(default_factory=list)
    clue_of_cell_start: list[int] = field(default_factory=list)
    clue_of_cell_data: list[int] = field(default_factory=list)
    # Edge ids grouped by the grid line they cross: vertical edges for a horizontal cut,
    # horizontal edges for a vertical one.
    cuts: list[list[int]] = field(default_factory=list)
    # Scratch state for the connectivity check; stamped per call instead of cleared.
    visit_stamp: list[int] = field(default_factory=list)
    visit_generation: int = 0
    dfs_stack: list[int] = field(default_factory=list)


def _h_index(cols: int, x: int, y: int) -> int:
    return y * (cols - 1) + x


def _v_index(cols: int, h_count: int, x: int, y: int) -> int:
    return h_count + y * cols + x


def create_engine(board: Board) -> Engine:
    cols, rows = board.cols, board.rows
    cell_count = cols * rows
    h_count = rows * max(cols - 1, 0)
    edge_count = h_count + max(rows - 1, 0) * cols
    engine = Engine(
        cols, rows, cell_count, edge_count, h_count,
        [0] * cell_count, [0] * edge_count, [0] * cell_count, [0] * cell_count,
        [0] * (cell_count * 4), [0] * (edge_count * 2), [0] * (cell_count * 4),
        list(range(cell_count)), [1] * cell_count, cell_count,
        in_cell_queue=[0] * cell_count, clue_of_cell_start=[0] * (cell_count + 1),
    )
    for i in range(cell_count):
        x, y = i % cols, i // cols
        up = _v_index(cols, h_count, x, y - 1) if y > 0 else -1
        down = _v_index(cols, h_count, x, y) if y < rows - 1 else -1
        left = _h_index(cols, x - 1, y) if x > 0 else -1
        right = _h_index(cols, x, y) if x < cols - 1 else -1
        engine.incident[i * 4:i * 4 + 4] = [up, down, left, right]
        engine.neighbours[i * 4:i * 4 + 4] = [
            i - cols if y > 0 else -1, i + cols if y < rows - 1 else -1,
            i - 1 if x > 0 else -1, i + 1 if x < cols - 1 else -1,
        ]
        engine.blank_count[i] = sum(value < 0 for value in (up, down, left, right))
    for y in range(rows):
        for x in range(cols - 1):
            edge = _h_index(cols, x, y)
            engine.edge_cells[edge * 2:edge * 2 + 2] = [y * cols + x, y * cols + x + 1]
    for y in range(rows - 1):
        for x in range(cols):
            edge = _v_index(cols, h_count, x, y)
            engine.edge_cells[edge * 2:edge * 2 + 2] = [y * cols + x, (y + 1) * cols + x]
    for i, cell in enumerate(board.cell):
        if cell.qnum != -1:
            set_cell(engine, i, CellState.Blocked)
        if 1 <= cell.qdir <= 4 and cell.qnum >= 0:
            delta = dirs[cell.qdir]
            x, y = i % cols + delta.x, i // cols + delta.y
            ray = []
            while 0 <= x < cols and 0 <= y < rows:
                ray.append(y * cols + x)
                x += delta.x
                y += delta.y
            engine.clues.append(Clue(i, cell.qdir, cell.qnum, ray))
    engine.in_clue_queue = [0] * len(engine.clues)
    counts = [0] * cell_count
    for clue in engine.clues:
        for value in clue.ray:
            counts[value] += 1
    running = 0
    for i in range(cell_count):
        engine.clue_of_cell_start[i] = running
        running += counts[i]
    engine.clue_of_cell_start[cell_count] = running
    # Grid lines, for the parity rule. A horizontal cut between rows y and y+1 is crossed
    # by the vertical edges of row y; a vertical cut between columns x and x+1 by the
    # horizontal edges of column x.
    for y in range(rows - 1):
        engine.cuts.append([_v_index(cols, h_count, x, y) for x in range(cols)])
    for x in range(cols - 1):
        engine.cuts.append([_h_index(cols, x, y) for y in range(rows)])

    engine.visit_stamp = [0] * engine.cell_count
    engine.clue_of_cell_data = [0] * running
    cursor = engine.clue_of_cell_start[:cell_count]
    for clue_index, clue in enumerate(engine.clues):
        for value in clue.ray:
            engine.clue_of_cell_data[cursor[value]] = clue_index
            cursor[value] += 1
    engine.trail.clear()
    for i in range(cell_count):
        _enqueue_cell(engine, i)
    for i in range(len(engine.clues)):
        _enqueue_clue(engine, i)
    return engine


def _enqueue_cell(engine: Engine, index: int) -> None:
    if index < 0 or engine.in_cell_queue[index] == 1:
        return
    engine.in_cell_queue[index] = 1
    engine.cell_queue.append(index)


def _enqueue_clue(engine: Engine, index: int) -> None:
    if engine.in_clue_queue[index] == 1:
        return
    engine.in_clue_queue[index] = 1
    engine.clue_queue.append(index)


def _enqueue_clues_of(engine: Engine, index: int) -> None:
    start, end = engine.clue_of_cell_start[index:index + 2]
    for k in range(start, end):
        _enqueue_clue(engine, engine.clue_of_cell_data[k])


def mark(engine: Engine) -> Mark:
    return Mark(len(engine.trail), engine.unknown_cells, engine.line_cells,
                engine.contradiction, engine.loop_closed, engine.loop_root)


def remark(engine: Engine, saved: Mark) -> None:
    saved.trail = len(engine.trail)
    saved.unknown_cells = engine.unknown_cells
    saved.line_cells = engine.line_cells
    saved.contradiction = engine.contradiction
    saved.loop_closed = engine.loop_closed
    saved.loop_root = engine.loop_root


def undo(engine: Engine, saved: Mark) -> None:
    trail = engine.trail
    # One lookup per list rather than one per trail entry; undo runs on every backtrack.
    targets = (
        engine.cell,
        engine.edge,
        engine.line_count,
        engine.blank_count,
        engine.parent,
        engine.size,
    )
    for i in range(len(trail) - 3, saved.trail - 1, -3):
        targets[trail[i]][trail[i + 1]] = trail[i + 2]
    del trail[saved.trail:]
    engine.unknown_cells = saved.unknown_cells
    engine.line_cells = saved.line_cells
    engine.contradiction = saved.contradiction
    engine.loop_closed = saved.loop_closed
    engine.loop_root = saved.loop_root


def _find(engine: Engine, value: int) -> int:
    while engine.parent[value] != value:
        value = engine.parent[value]
    return value


def _unite(engine: Engine, a: int, b: int) -> None:
    ra, rb = _find(engine, a), _find(engine, b)
    if ra == rb:
        engine.loop_closed, engine.loop_root = True, ra
        return
    large, small = (rb, ra) if engine.size[ra] < engine.size[rb] else (ra, rb)
    engine.trail.extend((TRAIL_PARENT, small, engine.parent[small]))
    engine.trail.extend((TRAIL_SIZE, large, engine.size[large]))
    engine.parent[small] = large
    engine.size[large] += engine.size[small]


def set_edge(engine: Engine, edge: int, value: EdgeState) -> None:
    if engine.contradiction or edge < 0:
        return
    current = engine.edge[edge]
    if current == value:
        return
    if current != EdgeState.Unknown:
        engine.contradiction = True
        return
    trail = engine.trail
    trail.extend((TRAIL_EDGE, edge, current))
    engine.edge[edge] = value
    engine.changed = True
    edge_cells = engine.edge_cells
    base = edge * 2
    a = edge_cells[base]
    b = edge_cells[base + 1]
    _enqueue_cell(engine, a)
    _enqueue_cell(engine, b)
    if value == 1:  # EdgeState.Line
        line_count = engine.line_count
        trail.extend((TRAIL_LINE_COUNT, a, line_count[a]))
        trail.extend((TRAIL_LINE_COUNT, b, line_count[b]))
        line_count[a] += 1
        line_count[b] += 1
        set_cell(engine, a, CellState.Line)
        set_cell(engine, b, CellState.Line)
        if not engine.contradiction:
            _unite(engine, a, b)
    else:
        blank_count = engine.blank_count
        trail.extend((TRAIL_BLANK_COUNT, a, blank_count[a]))
        trail.extend((TRAIL_BLANK_COUNT, b, blank_count[b]))
        blank_count[a] += 1
        blank_count[b] += 1


def set_cell(engine: Engine, index: int, value: CellState) -> None:
    if engine.contradiction or index < 0:
        return
    current = engine.cell[index]
    if current == value:
        return
    if current != CellState.Unknown:
        engine.contradiction = True
        return
    engine.trail.extend((TRAIL_CELL, index, current))
    engine.cell[index] = value
    engine.unknown_cells -= 1
    engine.changed = True
    _enqueue_cell(engine, index)
    _enqueue_clues_of(engine, index)
    if value in (CellState.Black, CellState.Blocked):
        for edge in engine.incident[index * 4:index * 4 + 4]:
            set_edge(engine, edge, EdgeState.Blank)
    if value == CellState.Black:
        for neighbour in engine.neighbours[index * 4:index * 4 + 4]:
            if neighbour < 0:
                continue
            state = engine.cell[neighbour]
            if state == CellState.Black:
                engine.contradiction = True
                return
            if state == CellState.Unknown:
                set_cell(engine, neighbour, CellState.Line)
                if engine.contradiction:
                    return
    elif value == CellState.Line:
        engine.line_cells += 1


def _propagate_cell(engine: Engine, index: int) -> None:
    state = engine.cell[index]
    if state == 1 or state == 3:  # Black or Blocked
        return
    available = 4 - engine.blank_count[index]
    lines = engine.line_count[index]
    if state == 2:  # Line
        if lines > 2 or available < 2:
            engine.contradiction = True
            return
        if lines == 2:
            fill = EdgeState.Blank
        elif available == 2:
            fill = EdgeState.Line
        else:
            return
        edges = engine.edge
        incident = engine.incident
        base = index * 4
        for offset in range(4):
            edge = incident[base + offset]
            if edge >= 0 and edges[edge] == 0:  # EdgeState.Unknown
                set_edge(engine, edge, fill)
    elif lines > 0:
        set_cell(engine, index, CellState.Line)
    elif available < 2:
        set_cell(engine, index, CellState.Black)


def _propagate_clue(engine: Engine, clue_index: int) -> None:
    clue = engine.clues[clue_index]
    known = capacity = run = 0
    for value in clue.ray:
        state = engine.cell[value]
        if state == CellState.Black:
            known += 1
            capacity += (run + 1) >> 1
            run = 0
        elif state == CellState.Unknown:
            run += 1
        else:
            capacity += (run + 1) >> 1
            run = 0
    capacity += (run + 1) >> 1
    if known > clue.count or known + capacity < clue.count:
        engine.contradiction = True
        return
    if known == clue.count:
        for value in clue.ray:
            if engine.cell[value] == CellState.Unknown:
                set_cell(engine, value, CellState.Line)
                if engine.contradiction:
                    return
        return
    if known + capacity == clue.count:
        engine.forced.clear()
        start = -1
        for k in range(len(clue.ray) + 1):
            in_run = k < len(clue.ray) and engine.cell[clue.ray[k]] == CellState.Unknown
            if in_run and start < 0:
                start = k
            elif not in_run and start >= 0:
                length = k - start
                if length % 2 == 1:
                    for offset in range(0, length, 2):
                        engine.forced.append(clue.ray[start + offset])
                start = -1
        for value in engine.forced:
            set_cell(engine, value, CellState.Black)
            if engine.contradiction:
                return


def _settle_closed_loop(engine: Engine) -> None:
    if not engine.loop_closed or engine.contradiction:
        return
    for i in range(engine.cell_count):
        if engine.cell[i] == CellState.Unknown:
            set_cell(engine, i, CellState.Black)
            if engine.contradiction:
                return
    root = _find(engine, engine.loop_root)
    if engine.size[root] != engine.line_cells:
        engine.contradiction = True


def _drain_queues(engine: Engine) -> None:
    engine.cell_queue.clear()
    engine.in_cell_queue[:] = [0] * len(engine.in_cell_queue)
    engine.clue_queue.clear()
    engine.in_clue_queue[:] = [0] * len(engine.in_clue_queue)


def _check_connectivity(engine: Engine) -> bool:
    """The finished loop is one connected component, so every cell already committed to
    the loop has to stay mutually reachable through cells that can still carry it. Two
    line fragments walled off from each other by black and blocked cells can never be
    joined, and noticing that here prunes the search far earlier than waiting for a loop
    to close.

    Returns False on contradiction. Traversal crosses any edge that is not blank, into
    any cell that is Line or still Unknown.
    """
    line_cells = engine.line_cells
    if line_cells == 0:
        return True
    # Every list is bound to a local first: this is the single hottest function in
    # generation and the flood fill below touches four of them per neighbour.
    cell = engine.cell
    edges = engine.edge
    incident = engine.incident
    neighbours = engine.neighbours
    visit_stamp = engine.visit_stamp

    start = -1
    for i in range(engine.cell_count):
        if cell[i] == 2:  # CellState.Line
            start = i
            break
    if start < 0:
        return True

    stamp = engine.visit_generation + 1
    engine.visit_generation = stamp
    stack = engine.dfs_stack
    stack.clear()
    stack.append(start)
    visit_stamp[start] = stamp
    reached = 1
    push = stack.append
    pop = stack.pop

    while stack:
        base = pop() * 4
        for offset in range(4):
            d = base + offset
            edge = incident[d]
            if edge < 0 or edges[edge] == 2:  # EdgeState.Blank
                continue
            j = neighbours[d]
            if j < 0 or visit_stamp[j] == stamp:
                continue
            state = cell[j]
            if state == 2:  # CellState.Line
                reached += 1
            elif state != 0:  # CellState.Unknown
                continue
            visit_stamp[j] = stamp
            push(j)

    return reached == line_cells


def _propagate_small_loop_ban(engine: Engine) -> None:
    """Small-loop ban: an edge whose two ends already belong to the same line fragment
    would close that fragment into a loop, which is only ever allowed for the final loop.
    As long as line cells exist outside the fragment, the edge cannot be drawn.

    The engine could already detect a premature closure, but only after the edge had been
    committed; refusing it up front prunes the branch before the search enters it. Worth
    between 1.1x and 2.5x on generation depending on the board.
    """
    edges = engine.edge
    cell = engine.cell
    edge_cells = engine.edge_cells
    for edge in range(engine.edge_count):
        if edges[edge] != EdgeState.Unknown:
            continue
        base = edge * 2
        a = edge_cells[base]
        b = edge_cells[base + 1]
        if cell[a] != CellState.Line or cell[b] != CellState.Line:
            continue
        root = _find(engine, a)
        if root != _find(engine, b):
            continue
        if engine.size[root] == engine.line_cells:
            continue
        set_edge(engine, edge, EdgeState.Blank)
        if engine.contradiction:
            return


def _propagate_parity(engine: Engine) -> None:
    """The parity rule: a closed loop crosses any grid line an even number of times.

    For each cut, count the edges already committed to the line. If none are left open the
    count must be even, and if exactly one is open its state is decided outright. It is a
    cheap sweep and it is what a solver of this puzzle notices first, which is why the
    engine without it left roughly half of a finished board undecided.
    """
    edges = engine.edge
    for cut in engine.cuts:
        lines = 0
        unknown = -1
        unknown_count = 0
        for edge in cut:
            state = edges[edge]
            if state == EdgeState.Line:
                lines += 1
            elif state == EdgeState.Unknown:
                unknown = edge
                unknown_count += 1
                if unknown_count > 1:
                    break
        if unknown_count == 0:
            if lines % 2 == 1:
                engine.contradiction = True
                return
        elif unknown_count == 1:
            set_edge(engine, unknown, EdgeState.Line if lines % 2 == 1 else EdgeState.Blank)
            if engine.contradiction:
                return


def propagate_engine(engine: Engine) -> bool:
    while True:
        while engine.cell_queue or engine.clue_queue:
            while engine.cell_queue:
                index = engine.cell_queue.pop()
                engine.in_cell_queue[index] = 0
                _propagate_cell(engine, index)
                if engine.contradiction:
                    _drain_queues(engine)
                    return False
            while engine.clue_queue:
                clue = engine.clue_queue.pop()
                engine.in_clue_queue[clue] = 0
                _propagate_clue(engine, clue)
                if engine.contradiction:
                    _drain_queues(engine)
                    return False
                if engine.cell_queue:
                    break
        # Rectangle parity — the even-crossings argument applied to every rectangle
        # anchored at the top-left corner — was tried here and is out: sound, raises
        # coverage, but made 12x12 generation slower for the same success rate.
        before_rules = len(engine.trail)
        _propagate_parity(engine)
        if engine.contradiction:
            _drain_queues(engine)
            return False
        _propagate_small_loop_ban(engine)
        if engine.contradiction:
            _drain_queues(engine)
            return False
        if len(engine.trail) != before_rules or engine.cell_queue:
            continue

        if not engine.loop_closed:
            if not _check_connectivity(engine):
                engine.contradiction = True
                _drain_queues(engine)
                return False
            return True
        before = engine.unknown_cells
        _settle_closed_loop(engine)
        if engine.contradiction:
            _drain_queues(engine)
            return False
        if before == engine.unknown_cells and not engine.cell_queue:
            if not _check_connectivity(engine):
                engine.contradiction = True
                _drain_queues(engine)
                return False
            return True


def is_decided(engine: Engine) -> bool:
    return engine.unknown_cells == 0


def is_solved(engine: Engine) -> bool:
    if engine.contradiction or engine.unknown_cells > 0 or engine.line_cells == 0:
        return False
    for i in range(engine.cell_count):
        if engine.cell[i] == CellState.Line and engine.line_count[i] != 2:
            return False
    root = next((_find(engine, i) for i in range(engine.cell_count)
                 if engine.cell[i] == CellState.Line), -1)
    if root < 0 or engine.size[root] != engine.line_cells:
        return False
    for clue in engine.clues:
        if sum(engine.cell[value] == CellState.Black for value in clue.ray) != clue.count:
            return False
    return True


def to_solution(engine: Engine) -> Solution:
    result = create_solution()
    for i in range(engine.cell_count):
        if engine.cell[i] == CellState.Black:
            result.blacks[to_id(Position(i % engine.cols, i // engine.cols))] = None
    for edge in range(engine.edge_count):
        if engine.edge[edge] != EdgeState.Line:
            continue
        a = engine.edge_cells[edge * 2]
        pos_id = to_id(Position(a % engine.cols, a // engine.cols))
        (result.horizontal if edge < engine.h_count else result.vertical)[pos_id] = None
    return result
