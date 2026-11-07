from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Callable

from .board import Board, create_board, to_id, to_pos
from .difficulty import difficulty, technique_work
from .position import Position, dirs
from .random import Rng
from .search import (
    REDRAW_RESTARTS, analyse_propagation, count_loop_routings, count_solutions,
    draw_solution, find_initial_solution,
)
from .solution import Solution, validate_solution
from .solver import SolveOutcome, run_all


@dataclass(slots=True)
class GenerateOptions:
    cols: int
    rows: int
    clues: int | None = None
    clue_ratio: float = 0.16
    attempts: int = 100
    dp_min: int | None = None
    dp_max: int | None = None
    max_nodes: int = 0
    weaken: bool = True
    reduce: bool = True
    symmetry: str = "rot2"
    pattern: list[bool] | None = None
    black_bias: int = 850
    refine: int = 0
    anneal: int | None = None
    # Let the annealing add and remove clues, not just move and re-aim them. Produces
    # harder puzzles at the cost of roughly 40% more time.
    vary_clue_count: bool = False
    trace: Callable[[str], None] | None = None


@dataclass(slots=True)
class Generated:
    board: Board
    solution: Solution
    outcome: SolveOutcome
    difficulty: int
    attempts: int


@dataclass(slots=True)
class Clue:
    pos: Position
    index: int


REPAIR_ROUNDS = 24
PROMOTION_REJECTIONS = 24
# How many unsolvable pattern draws are skipped before one counts as a failed attempt.
PATTERN_DRAWS = 30


def _anneal_rounds_for(cols: int, rows: int) -> int:
    return max(400, cols * rows * 8)


def _ray_length(board: Board, origin: Position, direction: int) -> int:
    delta = dirs[direction]
    x, y, length = origin.x + delta.x, origin.y + delta.y, 0
    while board.in_board(Position(x, y)):
        length += 1
        x += delta.x
        y += delta.y
    return length


def _count_blacks(board: Board, blacks: dict[int, None], origin: Position, direction: int) -> int:
    delta = dirs[direction]
    x, y, count = origin.x + delta.x, origin.y + delta.y, 0
    while board.in_board(Position(x, y)):
        if to_id(Position(x, y)) in blacks:
            count += 1
        x += delta.x
        y += delta.y
    return count


def _directions_by_reach(board: Board, origin: Position, rng: Rng) -> list[int]:
    items = [
        (direction, _ray_length(board, origin, direction), rng.next_int(1 << 20))
        for direction in (1, 2, 3, 4)
    ]
    return [item[0] for item in sorted(items, key=lambda item: (-item[1], item[2]))]


def _refresh_counts(board: Board, solution: Solution, clues: list[Clue]) -> None:
    for clue in clues:
        cell = board.cell[clue.index]
        cell.qnum = _count_blacks(board, solution.blacks, clue.pos, cell.qdir)


def _uniqueness(board: Board, max_nodes: int) -> tuple[bool, Solution | None, bool]:
    result = count_solutions(board, 2, max_nodes)
    if result.aborted:
        return False, None, True
    if len(result.solutions) == 1:
        return True, None, False
    other = result.solutions[1] if len(result.solutions) > 1 else (
        result.solutions[0] if result.solutions else None
    )
    return False, other, False


def _choose_direction(
    board: Board, solution: Solution, other: Solution | None,
    pos: Position, rng: Rng,
) -> int:
    ordered = _directions_by_reach(board, pos, rng)
    if other is not None:
        for direction in ordered:
            if _count_blacks(board, solution.blacks, pos, direction) != _count_blacks(
                board, other.blacks, pos, direction
            ):
                return direction
    return ordered[0]


def _promote(
    board: Board, solution: Solution, clues: list[Clue], pos: Position, direction: int
) -> None:
    index = pos.y * board.cols + pos.x
    solution.blacks.pop(to_id(pos), None)
    board.cell[index].qdir, board.cell[index].qnum = direction, 0
    clues.append(Clue(pos, index))
    _refresh_counts(board, solution, clues)


def _demote(board: Board, solution: Solution, clues: list[Clue], clue: Clue) -> None:
    solution.blacks[to_id(clue.pos)] = None
    board.cell[clue.index].qdir = board.cell[clue.index].qnum = -1
    try:
        clues.remove(clue)
    except ValueError:
        pass
    _refresh_counts(board, solution, clues)


def _reduce_clues(
    board: Board, solution: Solution, clues: list[Clue], rng: Rng, max_nodes: int
) -> None:
    order = list(clues)
    rng.shuffle(order)
    for clue in order:
        blocked = any(
            board.in_board(Position(clue.pos.x + dirs[d].x, clue.pos.y + dirs[d].y))
            and to_id(Position(clue.pos.x + dirs[d].x, clue.pos.y + dirs[d].y)) in solution.blacks
            for d in (1, 2, 3, 4)
        )
        if blocked:
            continue
        saved = (board.cell[clue.index].qdir, board.cell[clue.index].qnum)
        _demote(board, solution, clues, clue)
        if not _uniqueness(board, max_nodes)[0]:
            solution.blacks.pop(to_id(clue.pos), None)
            board.cell[clue.index].qdir, board.cell[clue.index].qnum = saved
            clues.append(clue)
            _refresh_counts(board, solution, clues)


def _weaken_clues(
    board: Board, solution: Solution, clues: list[Clue], rng: Rng, max_nodes: int
) -> None:
    order = list(clues)
    rng.shuffle(order)
    for clue in order:
        cell = board.cell[clue.index]
        original = cell.qdir
        directions = _directions_by_reach(board, clue.pos, rng)
        directions.reverse()
        for direction in directions:
            if direction == original:
                continue
            cell.qdir = direction
            _refresh_counts(board, solution, clues)
            if _uniqueness(board, max_nodes)[0]:
                break
            cell.qdir = original
            _refresh_counts(board, solution, clues)


@dataclass(slots=True)
class _Snapshot:
    qdir: list[int]
    qnum: list[int]
    blacks: list[int]
    horizontal: list[int]
    vertical: list[int]
    clues: list[Clue]


def _snapshot(board: Board, solution: Solution, clues: list[Clue]) -> _Snapshot:
    return _Snapshot(
        [cell.qdir for cell in board.cell], [cell.qnum for cell in board.cell],
        list(solution.blacks), list(solution.horizontal), list(solution.vertical),
        [Clue(clue.pos, clue.index) for clue in clues],
    )


def _restore(board: Board, solution: Solution, clues: list[Clue], saved: _Snapshot) -> None:
    for index, cell in enumerate(board.cell):
        cell.qdir, cell.qnum = saved.qdir[index], saved.qnum[index]
    solution.blacks.clear()
    for value in saved.blacks:
        solution.blacks[value] = None
    solution.horizontal.clear()
    for value in saved.horizontal:
        solution.horizontal[value] = None
    solution.vertical.clear()
    for value in saved.vertical:
        solution.vertical[value] = None
    # Copies again on the way back: _relocate_clue mutates clue records in place, so
    # handing the snapshot's own objects to the live list would let later moves corrupt it.
    clues[:] = [Clue(clue.pos, clue.index) for clue in saved.clues]


def _adopt_solution(target: Solution, source: Solution) -> None:
    target.blacks.clear()
    target.blacks.update(source.blacks)
    target.horizontal.clear()
    target.horizontal.update(source.horizontal)
    target.vertical.clear()
    target.vertical.update(source.vertical)


def _black_neighbour(board: Board, solution: Solution, pos: Position) -> bool:
    return any(
        board.in_board(Position(pos.x + dirs[d].x, pos.y + dirs[d].y))
        and to_id(Position(pos.x + dirs[d].x, pos.y + dirs[d].y)) in solution.blacks
        for d in (1, 2, 3, 4)
    )


def _refine(
    board: Board, solution: Solution, clues: list[Clue], rng: Rng,
    rounds: int, max_nodes: int,
) -> None:
    best = technique_work(run_all(board))
    for _ in range(rounds):
        if not clues:
            return
        saved = _snapshot(board, solution, clues)
        clue = clues[rng.next_int(len(clues))]
        if rng.next_int(2) == 0:
            choices = _directions_by_reach(board, clue.pos, rng)
            board.cell[clue.index].qdir = choices[rng.next_int(len(choices))]
            _refresh_counts(board, solution, clues)
        else:
            if _black_neighbour(board, solution, clue.pos):
                continue
            _demote(board, solution, clues, clue)
            ordered = [to_pos(value) for value in sorted(solution.blacks)]
            near = [pos for pos in ordered
                    if abs(pos.x - clue.pos.x) + abs(pos.y - clue.pos.y) <= 3]
            pool = near if near else ordered
            if not pool:
                _restore(board, solution, clues, saved)
                continue
            target = pool[rng.next_int(len(pool))]
            _promote(
                board, solution, clues, target,
                _choose_direction(board, solution, None, target, rng),
            )
        if validate_solution(board, solution) or not _uniqueness(board, max_nodes)[0]:
            _restore(board, solution, clues, saved)
            continue
        score = technique_work(run_all(board))
        if score > best:
            best = score
        else:
            _restore(board, solution, clues, saved)


def _steer(
    board: Board, solution: Solution, clues: list[Clue], rng: Rng, max_nodes: int
) -> bool:
    for _ in range(len(clues) * 4 + 4):
        unique, other, aborted = _uniqueness(board, max_nodes)
        if aborted:
            return False
        if unique:
            return True
        order = list(clues)
        rng.shuffle(order)
        changed = False
        for clue in order:
            cell = board.cell[clue.index]
            direction = _choose_direction(board, solution, other, clue.pos, rng)
            if direction == cell.qdir:
                continue
            mine = _count_blacks(board, solution.blacks, clue.pos, direction)
            theirs = _count_blacks(board, other.blacks, clue.pos, direction)  # type: ignore[union-attr]
            if mine == theirs:
                continue
            cell.qdir = direction
            _refresh_counts(board, solution, clues)
            changed = True
            break
        if not changed:
            return False
    return _uniqueness(board, max_nodes)[0]


def _loop_slack(
    board: Board, solution: Solution, max_nodes: int
) -> tuple[bool, list[Position]]:
    result = count_loop_routings(board, solution, 2, max_nodes)
    if result.aborted:
        return False, []
    if len(result.solutions) == 1:
        return True, []
    if len(result.solutions) < 2:
        return False, []
    rival = result.solutions[1]
    cells: set[int] = set()

    def note(value: int, horizontal: bool) -> None:
        x, y = value & 0xffff, value >> 16
        cells.add(value)
        ox, oy = (x + 1, y) if horizontal else (x, y + 1)
        if 0 <= ox < board.cols and 0 <= oy < board.rows:
            cells.add((oy << 16) | ox)

    for value in solution.horizontal:
        if value not in rival.horizontal:
            note(value, True)
    for value in rival.horizontal:
        if value not in solution.horizontal:
            note(value, True)
    for value in solution.vertical:
        if value not in rival.vertical:
            note(value, False)
    for value in rival.vertical:
        if value not in solution.vertical:
            note(value, False)
    return False, [Position(value & 0xffff, value >> 16) for value in sorted(cells)]


def _relocate_clue(board: Board, clue: Clue, to: Position) -> None:
    old = board.cell[clue.index]
    direction = old.qdir
    old.qdir = old.qnum = -1
    index = to.y * board.cols + to.x
    board.cell[index].qdir, board.cell[index].qnum = direction, 0
    clue.pos = to
    clue.index = index


def _orbit_of(
    cols: int, rows: int, symmetry: str, pos: Position
) -> list[Position]:
    """Return a position's symmetry orbit, deduplicated and inside the board."""
    x, y = pos.x, pos.y
    if symmetry == "rot2":
        raw = [pos, Position(cols - 1 - x, rows - 1 - y)]
    elif symmetry == "rot4":
        raw = [
            pos,
            Position(cols - 1 - y, x),
            Position(cols - 1 - x, rows - 1 - y),
            Position(y, rows - 1 - x),
        ]
    elif symmetry == "mirror-h":
        raw = [pos, Position(cols - 1 - x, y)]
    elif symmetry == "mirror-v":
        raw = [pos, Position(x, rows - 1 - y)]
    else:
        raw = [pos]
    result: list[Position] = []
    for cell in raw:
        if not (0 <= cell.x < cols and 0 <= cell.y < rows) or cell in result:
            continue
        result.append(cell)
    return result


ANNEAL_START_THRESHOLD = 6
ANNEAL_REHEAT_AFTER = 60
ANNEAL_GIVE_UP = 240
ANNEAL_CHECK_EVERY = 25


def _anneal_clues(
    board: Board, answer: Solution, clues: list[Clue], rng: Rng, rounds: int,
    max_nodes: int, black_bias: int,
    # move_positions: whether clues may move. Pattern mode fixes the positions by
    # definition, so there only the aiming moves are available.
    # vary_clue_count: whether the annealing may add and remove clues as well.
    move_positions: bool = True, vary_clue_count: bool = False,
    orbit_symmetry: str | None = None,
    trace: Callable[[str], None] | None = None,
) -> bool:
    if not clues or rounds <= 0:
        return _uniqueness(board, max_nodes)[0]
    # Bounds for the add/remove moves, relative to where phase 1 left off.
    clue_ceiling = len(clues) + max(2, -(-len(clues) // 2))
    clue_floor = max(1, len(clues) // 2)
    analysis = analyse_propagation(board)
    current = best = analysis.coverage
    if _uniqueness(board, max_nodes)[0]:
        return True
    since_improvement = 0
    cols, rows = board.cols, board.rows
    cells = board.cell
    for round_index in range(rounds):
        threshold = ANNEAL_START_THRESHOLD * (rounds - round_index) // rounds
        if since_improvement > ANNEAL_GIVE_UP:
            if trace:
                trace(f"  anneal gave up after {round_index} rounds without progress")
            break
        if since_improvement > ANNEAL_REHEAT_AFTER:
            threshold = ANNEAL_START_THRESHOLD
            since_improvement = 0
        since_improvement += 1
        if (
            round_index > 0
            and round_index % ANNEAL_CHECK_EVERY == 0
            and _uniqueness(board, max_nodes)[0]
        ):
            return True

        saved = _snapshot(board, answer, clues)
        clue = clues[rng.next_int(len(clues))]
        undetermined = analysis.undetermined
        # Moves 5 and 6 change how many clues there are, which phase 1 otherwise fixes
        # from the board area and never revisits. They are opt-in: measured over the same
        # seeds they bought roughly 50% more difficulty for 35-45% more time.
        if move_positions:
            move = rng.next_int(7 if vary_clue_count else 5)
        elif orbit_symmetry is not None and rng.next_int(3) == 0:
            move = 7
        else:
            move = 1 + 2 * rng.next_int(2)
        relocates = move != 1 and move != 3

        if move == 0:
            delta = dirs[1 + rng.next_int(4)]
            tx, ty = clue.pos.x + delta.x, clue.pos.y + delta.y
            if not (0 <= tx < cols and 0 <= ty < rows) or cells[ty * cols + tx].qnum != -1:
                continue
            _relocate_clue(board, clue, Position(tx, ty))
        elif move == 1:
            directions = _directions_by_reach(board, clue.pos, rng)
            cells[clue.index].qdir = directions[rng.next_int(len(directions))]
        elif move == 2:
            blacks = sorted(answer.blacks)
            if not blacks:
                continue
            value = blacks[rng.next_int(len(blacks))]
            _relocate_clue(board, clue, Position(value & 0xffff, value >> 16))
        elif move == 3:
            if not undetermined:
                continue
            open_cells = set(undetermined)
            best_direction, best_seen = 0, -1
            for direction in _directions_by_reach(board, clue.pos, rng):
                delta = dirs[direction]
                x, y = clue.pos.x + delta.x, clue.pos.y + delta.y
                seen = 0
                while 0 <= x < cols and 0 <= y < rows:
                    if y * cols + x in open_cells:
                        seen += 1
                    x += delta.x
                    y += delta.y
                if seen > best_seen:
                    best_seen = seen
                    best_direction = direction
            if best_direction == 0 or best_direction == cells[clue.index].qdir:
                continue
            cells[clue.index].qdir = best_direction
        elif move == 5:
            # Add a clue on one of the answer's black cells.
            if len(clues) >= clue_ceiling:
                continue
            blacks = sorted(answer.blacks)
            if not blacks:
                continue
            value = blacks[rng.next_int(len(blacks))]
            pos = Position(value & 0xffff, value >> 16)
            _promote(board, answer, clues, pos, _choose_direction(board, answer, None, pos, rng))
        elif move == 7:
            # Relocate this clue's whole orbit onto a free orbit elsewhere.
            source = _orbit_of(cols, rows, orbit_symmetry, clue.pos)
            target = _orbit_of(
                cols,
                rows,
                orbit_symmetry,
                Position(rng.next_int(cols), rng.next_int(rows)),
            )
            if len(target) != len(source):
                continue
            if any(
                cells[pos.y * cols + pos.x].qnum != -1 and pos not in source
                for pos in target
            ):
                continue
            moved = [
                next(
                    (
                        candidate
                        for candidate in clues
                        if candidate.pos.x == pos.x and candidate.pos.y == pos.y
                    ),
                    None,
                )
                for pos in source
            ]
            if any(candidate is None for candidate in moved):
                continue
            for candidate in moved:
                cells[candidate.index].qnum = -1
                cells[candidate.index].qdir = -1
            for index, candidate in enumerate(moved):
                to = target[index]
                target_index = to.y * cols + to.x
                cells[target_index].qdir = 1
                cells[target_index].qnum = 0
                candidate.pos = to
                candidate.index = target_index
        elif move == 6:
            # Drop a clue, turning it back into a black cell. Only safe where that would
            # not put two black cells side by side.
            if len(clues) <= clue_floor or _black_neighbour(board, answer, clue.pos):
                continue
            _demote(board, answer, clues, clue)
        else:
            if not undetermined:
                continue
            focus = undetermined[rng.next_int(len(undetermined))]
            fx, fy = focus % cols, focus // cols
            blacks = sorted(answer.blacks)
            if not blacks:
                continue
            target = blacks[0]
            best_distance = (1 << 63) - 1
            for value in blacks:
                x, y = value & 0xffff, value >> 16
                distance = abs(x - fx) + abs(y - fy)
                if distance < best_distance:
                    best_distance = distance
                    target = value
            _relocate_clue(
                board, clue, Position(target & 0xffff, target >> 16)
            )

        if relocates:
            nxt = draw_solution(
                board, rng, max_nodes, black_bias, REDRAW_RESTARTS
            )
            if nxt is None:
                _restore(board, answer, clues, saved)
                continue
            _adopt_solution(answer, nxt)
        _refresh_counts(board, answer, clues)
        candidate = analyse_propagation(board)
        if candidate.coverage < 0 or candidate.coverage < current - threshold:
            _restore(board, answer, clues, saved)
            continue
        analysis = candidate
        current = candidate.coverage
        if current > best:
            best = current
            since_improvement = 0
            if _uniqueness(board, max_nodes)[0]:
                return True
    return _uniqueness(board, max_nodes)[0]


def _finish(
    board: Board, solution: Solution, rng: Rng, clues: list[Clue],
    options: GenerateOptions, attempts: int,
) -> Generated | None:
    if validate_solution(board, solution):
        return None
    if options.reduce:
        _reduce_clues(board, solution, clues, rng, options.max_nodes)
    if options.weaken:
        _weaken_clues(board, solution, clues, rng, options.max_nodes)
    if options.refine > 0:
        _refine(board, solution, clues, rng, options.refine, options.max_nodes)
    if not _uniqueness(board, options.max_nodes)[0]:
        return None
    outcome = run_all(board)
    score = difficulty(outcome, board)
    if options.dp_min is not None and score < options.dp_min:
        return None
    if options.dp_max is not None and score > options.dp_max:
        return None
    return Generated(board, solution, outcome, score, attempts)


def generate_loop(rng: Rng, options: GenerateOptions) -> Generated | None:
    clue_limit = options.clues
    if clue_limit is None:
        clue_limit = max(1, math.floor(options.cols * options.rows * options.clue_ratio + 0.5))
    attempt = 1
    while options.attempts == 0 or attempt <= options.attempts:
        board = create_board(options.cols, options.rows)
        answer = find_initial_solution(board, rng, options.max_nodes, options.black_bias)
        if answer is None:
            if options.trace:
                options.trace(f"attempt {attempt}: no initial answer")
            attempt += 1
            continue
        if options.trace:
            options.trace(f"attempt {attempt}: answer with {len(answer.blacks)} blacks")
        clues: list[Clue] = []
        failed = False
        rejections = 0
        batch_cap = clue_limit
        while len(clues) < clue_limit:
            remaining = clue_limit - len(clues)
            candidates = [to_pos(value) for value in sorted(answer.blacks)]
            batch = max(
                1, min((remaining + 1) // 2, (len(candidates) + 1) // 2, batch_cap)
            )
            rng.shuffle(candidates)
            chosen = candidates[:min(batch, remaining)]
            if not chosen:
                if options.trace:
                    options.trace(f"  ran out of black cells at {len(clues)} clues")
                failed = True
                break
            saved = _snapshot(board, answer, clues)
            for pos in chosen:
                _promote(board, answer, clues, pos, _choose_direction(board, answer, None, pos, rng))
            nxt = draw_solution(
                board, rng, options.max_nodes, options.black_bias, REDRAW_RESTARTS
            )
            if nxt is None:
                _restore(board, answer, clues, saved)
                rejections += 1
                batch_cap = max(1, len(chosen) // 2)
                if options.trace:
                    options.trace(
                        f"  no answer after promoting {len(chosen)}; rolled back, "
                        f"batch cap {batch_cap} ({rejections})"
                    )
                if rejections > PROMOTION_REJECTIONS:
                    failed = True
                    break
                continue
            answer = nxt
            _refresh_counts(board, answer, clues)
            if options.trace:
                options.trace(f"  {len(clues)} clues, {len(answer.blacks)} blacks")
        if failed:
            attempt += 1
            continue

        unique = False
        clue_ceiling = clue_limit + max(2, (clue_limit + 1) // 2)
        for _ in range(REPAIR_ROUNDS + 1):
            forced, ambiguous = _loop_slack(board, answer, options.max_nodes)
            if forced:
                if _steer(board, answer, clues, rng, options.max_nodes):
                    unique = True
                    break
                if options.trace:
                    options.trace("  steering failed, redrawing the answer")
                nxt = draw_solution(
                    board, rng, options.max_nodes, options.black_bias, REDRAW_RESTARTS
                )
                if nxt is None:
                    break
                answer = nxt
                _refresh_counts(board, answer, clues)
                continue

            if not ambiguous or len(clues) >= clue_ceiling:
                if options.trace:
                    options.trace("  interchangeable loop with no room left to repair")
                break
            targets = list(ambiguous)
            rng.shuffle(targets)
            planted = False
            for target in targets:
                saved = _snapshot(board, answer, clues)
                _promote(
                    board, answer, clues, target,
                    _choose_direction(board, answer, None, target, rng),
                )
                nxt = draw_solution(
                    board, rng, options.max_nodes, options.black_bias, REDRAW_RESTARTS
                )
                if nxt is not None:
                    answer = nxt
                    _refresh_counts(board, answer, clues)
                    planted = True
                    if options.trace:
                        options.trace(
                            "  planted a clue in the ambiguous region "
                            f"({len(clues)} clues, {len(answer.blacks)} blacks)"
                        )
                    break
                _restore(board, answer, clues, saved)
            if not planted:
                if options.trace:
                    options.trace(
                        "  no clue placement in the ambiguous region keeps the board solvable"
                    )
                break
        if not unique:
            rounds = (
                options.anneal if options.anneal is not None
                else _anneal_rounds_for(options.cols, options.rows)
            )
            if options.trace:
                options.trace(
                    f"  greedy repair stalled at {len(clues)} clues, annealing"
                )
            unique = _anneal_clues(
                board, answer, clues, rng, rounds, options.max_nodes, options.black_bias,
                True, options.vary_clue_count, None, options.trace,
            )
        if not unique:
            if options.trace:
                options.trace(
                    f"  could not reach a unique puzzle with {len(clues)} clues"
                )
            attempt += 1
            continue
        if options.trace:
            options.trace(f"  unique with {len(clues)} clues, finishing")
        generated = _finish(board, answer, rng, clues, options, attempt)
        if generated:
            return generated
        if options.trace:
            options.trace("  finish rejected the puzzle")
        attempt += 1
    return None


def build_pattern(
    cols: int, rows: int, count: int, symmetry: str, rng: Rng
) -> list[bool]:
    pattern = [False] * (cols * rows)

    def orbit(x: int, y: int) -> list[Position]:
        if symmetry == "rot2":
            return [Position(x, y), Position(cols - 1 - x, rows - 1 - y)]
        if symmetry == "rot4":
            return [Position(x, y), Position(cols - 1 - y, x),
                    Position(cols - 1 - x, rows - 1 - y), Position(y, rows - 1 - x)]
        if symmetry == "mirror-h":
            return [Position(x, y), Position(cols - 1 - x, y)]
        if symmetry == "mirror-v":
            return [Position(x, y), Position(x, rows - 1 - y)]
        return [Position(x, y)]

    placed, guard = 0, cols * rows * 20
    while placed < count and guard > 0:
        guard -= 1
        x, y = rng.next_int(cols), rng.next_int(rows)
        cells: list[Position] = []
        for pos in orbit(x, y):
            if not (0 <= pos.x < cols and 0 <= pos.y < rows) or pos in cells:
                continue
            cells.append(pos)
        if any(pattern[pos.y * cols + pos.x] for pos in cells):
            continue
        if placed + len(cells) > count:
            continue
        for pos in cells:
            pattern[pos.y * cols + pos.x] = True
        placed += len(cells)
    return pattern


def generate_pattern(rng: Rng, options: GenerateOptions) -> Generated | None:
    clue_target = options.clues
    if clue_target is None:
        clue_target = max(1, math.floor(options.cols * options.rows * options.clue_ratio + 0.5))
    draws = 0
    attempt = 1
    while options.attempts == 0 or attempt <= options.attempts:
        pattern = options.pattern if options.pattern is not None else build_pattern(
            options.cols, options.rows, clue_target, options.symmetry, rng
        )
        board = create_board(options.cols, options.rows)
        clues = []
        for index, flag in enumerate(pattern):
            if flag:
                pos = Position(index % options.cols, index // options.cols)
                clues.append(Clue(pos, index))
                board.cell[index].qdir, board.cell[index].qnum = 1, -2
        if not clues:
            attempt += 1
            continue
        answer = find_initial_solution(board, rng, options.max_nodes, options.black_bias)
        if answer is None:
            # A clue layout is an obstacle course, and a scattered enough one has no answer at
            # all. Redrawing costs almost nothing, so it does not consume an attempt; the
            # retry budget is meant for puzzles that could not be made unique, not for layouts
            # that were never solvable.
            if options.trace:
                options.trace(f"attempt {attempt}: no answer for the pattern")
            if options.pattern is None and draws < PATTERN_DRAWS:
                draws += 1
                continue
            draws = 0
            attempt += 1
            continue
        draws = 0
        for clue in clues:
            board.cell[clue.index].qdir = _choose_direction(
                board, answer, None, clue.pos, rng
            )
        _refresh_counts(board, answer, clues)
        steered = _steer(board, answer, clues, rng, options.max_nodes)
        if not steered:
            # Same fallback loop mode gets, restricted to re-aiming: the clue positions
            # belong to the pattern and must not move. Without this, pattern mode simply
            # gave up here, which made it the weaker of the two modes at every size.
            rounds = (
                options.anneal
                if options.anneal is not None
                else _anneal_rounds_for(options.cols, options.rows)
            )
            steered = _anneal_clues(
                board, answer, clues, rng, rounds, options.max_nodes, options.black_bias,
                False, False,
                options.symmetry if options.pattern is None else None,
                options.trace,
            )
        if steered:
            original_reduce = options.reduce
            options.reduce = False
            generated = _finish(board, answer, rng, clues, options, attempt)
            options.reduce = original_reduce
            if generated:
                return generated
        attempt += 1
    return None
