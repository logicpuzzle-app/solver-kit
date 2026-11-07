from __future__ import annotations

import os
import math
import re
import sys
import time
from dataclasses import dataclass, field

from .board import Board, clone_board
from .difficulty import band, difficulty, puzsq_rating_hundredths
from .format import (
    format_answer_grid, format_problem_text, format_solution_summary, parse_problem_text,
)
from .generator import GenerateOptions, Generated, generate_loop, generate_pattern
from .puzzlink import decode_url, encode_code, encode_url
from .random import Rng
from .search import count_solutions
from .solution import describe_validation_error, extract_solution, validate_solution
from .solver import SolveOptions, run_all

USAGE = """usage: yajilin <command> [options]

commands:
  solve <problem>              solve a puzzle and report the answer and difficulty
  count <problem> [--limit N]  count solutions (default limit 2)
  generate-loop [options]      generate by drawing the loop first
  generate-pattern [options]   generate from a clue pattern
  bench [options]              time solving and generation

<problem> is a file path, a puzz.link url, or a bare "yajilin/W/H/body" code.

common options:
  --seed N            rng seed (default 0)
  --size WxH          board size (default 10x10)
  --clues N           number of arrow clues
  --clue-ratio R      clues as a fraction of the board (default 0.16)
  --attempts N        retry budget, 0 = unlimited (default 100)
  --dp-min N          reject puzzles below this difficulty
  --dp-max N          reject puzzles above this difficulty
  --max-nodes N       search node cap, 0 = unlimited (default 200000)
  --symmetry S        none|rot2|rot4|mirror-h|mirror-v (pattern mode, default rot2)
  --pattern FILE      explicit clue pattern (pattern mode)
  --no-weaken         keep the most informative clue directions
  --no-reduce         keep every clue, even redundant ones (loop mode)
  --refine N          hill-climb N rounds for a harder puzzle (default 0)
  --anneal N          annealing rounds when the greedy repair stalls (default 8 per cell)
  --vary-clue-count   let the annealing add and remove clues: harder, ~40% slower
  --black-bias N      per-mille chance of trying a cell as black first (default 850)
  --no-trial          solve without the lookahead
  --format F          url|code|text|grid (default grid)
  --out FILE          write to a file instead of stdout
  --count N           bench iterations (default 10)
"""


@dataclass(slots=True)
class Options:
    positional: list[str] = field(default_factory=list)
    flags: dict[str, None] = field(default_factory=dict)
    values: dict[str, str] = field(default_factory=dict)


def parse_args(argv: list[str]) -> Options:
    result = Options()
    valued = {
        "--seed", "--size", "--clues", "--clue-ratio", "--attempts", "--dp-min",
        "--dp-max", "--max-nodes", "--symmetry", "--pattern", "--format", "--out",
        "--limit", "--count", "--refine", "--black-bias", "--anneal",
    }
    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg in valued:
            i += 1
            if i >= len(argv):
                raise ValueError(f"{arg} requires a value")
            result.values[arg] = argv[i]
        elif arg.startswith("--"):
            result.flags[arg] = None
        else:
            result.positional.append(arg)
        i += 1
    return result


def _int_option(options: Options, name: str, fallback: int) -> int:
    raw = options.values.get(name)
    if raw is None:
        return fallback
    match = re.match(r"^[+-]?\d+", raw)
    if not match:
        raise ValueError(f"{name} must be an integer")
    return int(match.group())


def _float_option(options: Options, name: str, fallback: float) -> float:
    raw = options.values.get(name)
    if raw is None:
        return fallback
    try:
        return float(raw)
    except ValueError:
        raise ValueError(f"{name} must be a number") from None


def _size_option(options: Options) -> tuple[int, int]:
    raw = options.values.get("--size", "10x10")
    match = re.fullmatch(r"(\d+)x(\d+)", raw)
    if not match:
        raise ValueError("--size must look like 10x10")
    return int(match.group(1)), int(match.group(2))


def _read_problem(source: str) -> Board:
    text = open(source, encoding="utf-8").read() if os.path.exists(source) else source
    trimmed = text.strip()
    return decode_url(trimmed) if "yajilin/" in trimmed else parse_problem_text(trimmed)


def _read_pattern(source: str, cols: int, rows: int) -> list[bool]:
    with open(source, encoding="utf-8") as handle:
        raw = handle.read()
    lines = []
    for raw_line in raw.split("\n"):
        line = raw_line.strip()
        if line and not (line.startswith("#") and (len(line) == 1 or line[1] == " ")):
            lines.append(line)
    if len(lines) != rows:
        raise ValueError(f"pattern must have {rows} rows, found {len(lines)}")
    pattern = [False] * (cols * rows)
    for y, line in enumerate(lines):
        split = re.split(r"\s+", line)
        cells = split if len(split) == cols else list(line)
        if len(cells) != cols:
            raise ValueError(f"pattern row {y + 1} must have {cols} cells")
        for x, token in enumerate(cells):
            pattern[y * cols + x] = token not in (".", "0")
    return pattern


def _emit(options: Options, text: str) -> None:
    output = options.values.get("--out")
    if output:
        with open(output, "w", encoding="utf-8", newline="") as handle:
            handle.write(text)
    else:
        sys.stdout.write(text)


def _format_rating(score: int) -> str:
    """Format the puzzle-square 1-5 rating from integer hundredths.

    Dividing first and formatting a float would not guarantee that the three ports print
    identical bytes.
    """
    hundredths = puzsq_rating_hundredths(score)
    whole = hundredths // 100
    fraction = hundredths - whole * 100
    return f"{whole}.{fraction:02}"


# Node budget for the uniqueness check. A budget rather than a deadline: the node count is
# deterministic, so the three ports agree on when to give up, which a clock never would.
#
# The value buys what it can and no more. On the 164 puzzles in the corpus that the
# technique solver cannot finish, this settles roughly two thirds of them at about half a
# second each; the rest do not settle at any budget worth spending — 34 of them were still
# running after twenty minutes apiece. Past that point the honest answer is "unverified".
#
# It costs nothing on an ordinary puzzle, because a finished solve is never asked.
UNIQUENESS_NODES = 250_000


def _count_answers(board: Board, status: str) -> str:
    """
    How many answers the puzzle has, as "0", "1", "2+" or "?" when the budget ran out.
    
    Only asked when the technique solver stopped short. Every deduction it makes is forced —
    even the trials, which only ever rule a colour out by contradiction — so a solve that
    finishes has proved its answer is the only one, and searching again would be waste.
    
    It has to be asked at all because a puzzle with two answers is not hard, it is broken,
    and the solver stalling on it looks exactly like the solver stalling on a hard one.
    """
    if status == "completed":
        return "1"
    found = count_solutions(board, 2, UNIQUENESS_NODES)
    if found.aborted:
        return "?"
    if len(found.solutions) >= 2:
        return "2+"
    return str(len(found.solutions))


def _solve_command(options: Options) -> int:
    if not options.positional:
        raise ValueError("solve needs a problem")
    board = _read_problem(options.positional[0])
    outcome = run_all(board, options=SolveOptions(no_trial="--no-trial" in options.flags))
    solution = extract_solution(outcome.answer)
    errors = validate_solution(board, solution) if outcome.status == "completed" else []
    score = difficulty(outcome, board)
    solutions = _count_answers(board, outcome.status)
    # A score says how hard the puzzle was to work through, which means nothing when there
    # is nothing single to work towards.
    rating = _format_rating(score) if solutions == "1" else "-"
    lines = [
        f"STATUS {outcome.status.upper()}", f"SOLUTIONS {solutions}",
        f"DP {score}", f"BAND {band(score)}",
        f"RATING {rating}", f"LEVEL {outcome.stats.level}", f"PASSES {outcome.stats.passes}",
        f"TRIAL {outcome.stats.trial_deductions} {outcome.stats.max_trial_count}",
    ]
    if errors:
        lines.append(f"INVALID {len(errors)}")
        lines.extend(f"  {describe_validation_error(error)}" for error in errors[:5])
    _emit(options, "\n".join(lines) + "\n" + format_answer_grid(board, solution)
          + format_solution_summary(solution))
    if outcome.status == "broken":
        return 1
    if outcome.status != "completed":
        return 2
    return 1 if errors else 0


def _count_command(options: Options) -> int:
    if not options.positional:
        raise ValueError("count needs a problem")
    result = count_solutions(
        _read_problem(options.positional[0]),
        _int_option(options, "--limit", 2), _int_option(options, "--max-nodes", 0),
    )
    _emit(options, f"SOLUTIONS {len(result.solutions)}\nNODES {result.nodes}\n"
                   f"ABORTED {1 if result.aborted else 0}\n")
    return 0 if len(result.solutions) == 1 else 1


def _generate_options(options: Options) -> GenerateOptions:
    cols, rows = _size_option(options)
    result = GenerateOptions(
        cols, rows, clue_ratio=_float_option(options, "--clue-ratio", 0.16),
        attempts=_int_option(options, "--attempts", 100),
        max_nodes=_int_option(options, "--max-nodes", 200000),
        weaken="--no-weaken" not in options.flags,
        reduce="--no-reduce" not in options.flags,
        refine=_int_option(options, "--refine", 0),
        vary_clue_count="--vary-clue-count" in options.flags,
        anneal=(
            _int_option(options, "--anneal", 0)
            if "--anneal" in options.values
            else None
        ),
        black_bias=_int_option(options, "--black-bias", 850),
    )
    if "--clues" in options.values:
        result.clues = _int_option(options, "--clues", 0)
    if "--dp-min" in options.values:
        result.dp_min = _int_option(options, "--dp-min", 0)
    if "--dp-max" in options.values:
        result.dp_max = _int_option(options, "--dp-max", 0)
    if "--symmetry" in options.values:
        result.symmetry = options.values["--symmetry"]
    if "--pattern" in options.values:
        result.pattern = _read_pattern(options.values["--pattern"], cols, rows)
    return result


def _render_generated(options: Options, generated: Generated) -> str:
    output_format = options.values.get("--format", "grid")
    if output_format == "url":
        return encode_url(generated.board) + "\n"
    if output_format == "code":
        return encode_code(generated.board) + "\n"
    if output_format == "text":
        return format_problem_text(generated.board)
    clues = sum(cell.qnum != -1 for cell in generated.board.cell)
    lines = [
        f"CODE {encode_code(generated.board)}", f"URL {encode_url(generated.board)}",
        f"DP {generated.difficulty}", f"BAND {band(generated.difficulty)}",
        f"RATING {_format_rating(generated.difficulty)}",
        f"STATUS {generated.outcome.status.upper()}", f"CLUES {clues}",
        f"BLACKS {len(generated.solution.blacks)}", f"ATTEMPTS {generated.attempts}",
    ]
    return "\n".join(lines) + "\n" + format_problem_text(generated.board) + format_answer_grid(
        generated.board, generated.solution
    )


def _generate_command(options: Options, mode: str) -> int:
    rng = Rng(_int_option(options, "--seed", 0))
    generate = _generate_options(options)
    generated = generate_loop(rng, generate) if mode == "loop" else generate_pattern(rng, generate)
    if generated is None:
        sys.stderr.write(f"RESULT GENERATE_FAILED attempts={generate.attempts}\n")
        return 2
    _emit(options, _render_generated(options, generated))
    return 0


def _bench_command(options: Options) -> int:
    count = _int_option(options, "--count", 10)
    seed = _int_option(options, "--seed", 0)
    generate = _generate_options(options)
    start = time.time_ns()
    generated_count = dp_total = 0
    boards = []
    for i in range(count):
        puzzle = generate_loop(Rng(seed + i), generate)
        if puzzle:
            generated_count += 1
            dp_total += puzzle.difficulty
            boards.append(clone_board(puzzle.board))
    generate_ms = (time.time_ns() - start) // 1_000_000
    start = time.time_ns()
    solved = sum(run_all(board).status == "completed" for board in boards)
    solve_ms = (time.time_ns() - start) // 1_000_000
    start = time.time_ns()
    unique = sum(
        (lambda r: not r.aborted and len(r.solutions) == 1)(
            count_solutions(board, 2, generate.max_nodes)
        ) for board in boards
    )
    count_ms = (time.time_ns() - start) // 1_000_000
    average = int(math.floor(dp_total / generated_count + 0.5)) if generated_count else 0
    _emit(options, f"GENERATED {generated_count}/{count}\nGENERATE_MS {generate_ms}\n"
                   f"SOLVED {solved}/{len(boards)}\nSOLVE_MS {solve_ms}\n"
                   f"UNIQUE {unique}/{len(boards)}\nCOUNT_MS {count_ms}\nDP_AVG {average}\n")
    return 0 if generated_count == count else 2


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if not argv or argv[0] in ("--help", "-h"):
        sys.stdout.write(USAGE)
        return 1 if not argv else 0
    command = argv[0]
    options = parse_args(argv[1:])
    if command == "solve":
        return _solve_command(options)
    if command == "count":
        return _count_command(options)
    if command == "generate-loop":
        return _generate_command(options, "loop")
    if command == "generate-pattern":
        return _generate_command(options, "pattern")
    if command == "bench":
        return _bench_command(options)
    sys.stderr.write(f"unknown command: {command}\n")
    sys.stdout.write(USAGE)
    return 1


def entrypoint() -> None:
    try:
        raise SystemExit(main())
    except (Exception, OSError) as error:
        sys.stderr.write(f"{error}\n")
        raise SystemExit(1) from None
