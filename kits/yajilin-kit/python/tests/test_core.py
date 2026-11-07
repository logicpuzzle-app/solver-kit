"""Unit tests for the contracts the golden-output comparison cannot localise.

``verify.sh`` proves the three ports agree, but when it fails it says only "these bytes
differ". These tests pin the individual behaviours a port has to reproduce — above all the
ones that look like bugs and are deliberate.

Run with ``python3 -m unittest discover -s tests`` (or the same under ``pypy3``).
"""

from __future__ import annotations

import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.setrecursionlimit(100000)

from yajilin_kit.board import Board, create_board, to_id, to_pos  # noqa: E402
from yajilin_kit.difficulty import (  # noqa: E402
    band,
    difficulty,
    puzsq_rating,
    puzsq_rating_hundredths,
    size_scale,
    SIZE_SCALE_UNIT,
    UNFINISHED_BASE,
)
from yajilin_kit.engine import (  # noqa: E402
    CellState,
    EdgeState,
    create_engine,
    propagate_engine,
    set_cell,
)
from yajilin_kit.position import Position  # noqa: E402
from yajilin_kit.puzzlink import decode_url, encode_body, encode_code, parse_url  # noqa: E402
from yajilin_kit.random import Rng  # noqa: E402
from yajilin_kit.reasons import Reason  # noqa: E402
from yajilin_kit.search import count_solutions, propagation_coverage  # noqa: E402
from yajilin_kit.solution import (  # noqa: E402
    create_solution,
    extract_solution,
    validate_solution,
)
from yajilin_kit.solver import run_all  # noqa: E402
from yajilin_kit.unionfind import UnionFind  # noqa: E402

PUBLISHED = "yajilin/10/10/r31d32k22b31d23b31k33r12c40c13n"


class UnionFindTest(unittest.TestCase):
    def test_keeps_the_nan_size_semantics(self) -> None:
        # size() of a root that was never registered is NaN, so the union-by-size
        # comparison in connect() is always false. Deductions depend on the resulting tree
        # shape, so the behaviour is reproduced rather than fixed.
        uf = UnionFind()
        self.assertTrue(math.isnan(uf.size(1)))
        self.assertTrue(uf.connect(1, 2))
        # With both sizes NaN the swap never happens, so the first argument stays root.
        self.assertEqual(uf.root(2), 1)
        self.assertTrue(uf.is_union(1, 2))
        self.assertFalse(uf.connect(1, 2))

    def test_copies_without_sharing(self) -> None:
        uf = UnionFind()
        uf.connect(1, 2)
        copy = UnionFind.from_uf(uf)
        copy.connect(2, 3)
        self.assertTrue(copy.is_union(1, 3))
        self.assertFalse(uf.is_union(1, 3))


class CellIdTest(unittest.TestCase):
    def test_round_trips(self) -> None:
        for pos in (Position(0, 0), Position(9, 9), Position(255, 255)):
            self.assertEqual(to_pos(to_id(pos)), pos)


class PuzzlinkTest(unittest.TestCase):
    CODES = (
        PUBLISHED,
        "yajilin/10/10/a21a24a24a21a2343s42s41s41s43i",
        "yajilin/b/10/10/o0.e43j30a0.a0.a0.d2.k0.f20a0.a0.a3.b42za32",
    )

    def test_round_trips_every_corpus_form(self) -> None:
        for code in self.CODES:
            board = decode_url(code)
            again = decode_url(encode_code(board))
            self.assertEqual((again.cols, again.rows), (board.cols, board.rows))
            for a, b in zip(again.cell, board.cell):
                self.assertEqual((a.qdir, a.qnum), (b.qdir, b.qnum))

    def test_accepts_urls_and_bare_codes(self) -> None:
        self.assertEqual(
            parse_url("yajilin/10/10/abc"),
            parse_url("https://puzz.link/p?yajilin/10/10/abc"),
        )

    def test_skips_variant_flags(self) -> None:
        _, cols, rows, _ = parse_url("yajilin/b/10/12/abc")
        self.assertEqual((cols, rows), (10, 12))

    def test_encodes_an_empty_board_as_skips(self) -> None:
        # 100 empty cells: three full runs of 26 ('z') and a remainder of 22 ('v').
        self.assertEqual(encode_body(create_board(10, 10)), "zzzv")

    def test_rejects_other_puzzle_types(self) -> None:
        with self.assertRaises(Exception):
            parse_url("masyu/10/10/abc")


class RngTest(unittest.TestCase):
    @staticmethod
    def _reference(seed: int):
        multiplier = 0x5DEECE66D
        mask = (1 << 48) - 1
        state = (seed ^ multiplier) & mask

        def nxt(bits: int) -> int:
            nonlocal state
            state = (state * multiplier + 0xB) & mask
            return state >> (48 - bits)

        return nxt

    def test_matches_the_reference_stream(self) -> None:
        # The shipped generator splits the 48-bit state into 24-bit halves for speed, so
        # this straightforward version is a real cross-check rather than a tautology.
        for seed in (0, 1, 42, 2147483647):
            rng = Rng(seed)
            nxt = self._reference(seed)
            for i in range(500):
                bits = 1 + (i % 32)
                self.assertEqual(rng.next(bits), nxt(bits), f"seed {seed} draw {i}")

    def test_next_int_stays_in_range(self) -> None:
        rng = Rng(7)
        for bound in (1, 2, 3, 16, 1000):
            for _ in range(200):
                value = rng.next_int(bound)
                self.assertGreaterEqual(value, 0)
                self.assertLess(value, bound)

    def test_shuffle_is_a_reproducible_permutation(self) -> None:
        a = list(range(8))
        b = list(range(8))
        Rng(3).shuffle(a)
        Rng(3).shuffle(b)
        self.assertEqual(a, b)
        self.assertEqual(sorted(a), list(range(8)))


class ValidateTest(unittest.TestCase):
    def test_accepts_the_solver_answer(self) -> None:
        board = decode_url(PUBLISHED)
        outcome = run_all(board)
        self.assertEqual(outcome.status, "completed")
        self.assertEqual(validate_solution(board, extract_solution(outcome.answer)), [])

    def test_rejects_an_empty_answer(self) -> None:
        board = decode_url(PUBLISHED)
        errors = validate_solution(board, create_solution())
        self.assertTrue(errors)
        self.assertTrue(any(error["kind"] == "cell-not-covered" for error in errors))

    def test_rejects_adjacent_blacks(self) -> None:
        board = create_board(3, 3)
        solution = create_solution()
        solution.blacks[to_id(Position(0, 0))] = None
        solution.blacks[to_id(Position(1, 0))] = None
        errors = validate_solution(board, solution)
        self.assertTrue(any(error["kind"] == "adjacent-blacks" for error in errors))


class EngineTest(unittest.TestCase):
    def test_forces_neighbours_of_a_black_cell(self) -> None:
        engine = create_engine(create_board(4, 4))
        set_cell(engine, 5, CellState.Black)  # (1,1)
        self.assertTrue(propagate_engine(engine))
        for neighbour in (1, 4, 6, 9):
            self.assertEqual(engine.cell[neighbour], CellState.Line)
        for d in range(4):
            edge = engine.incident[5 * 4 + d]
            self.assertEqual(engine.edge[edge], EdgeState.Blank)

    def test_reports_adjacent_blacks_as_a_contradiction(self) -> None:
        engine = create_engine(create_board(4, 4))
        set_cell(engine, 5, CellState.Black)
        set_cell(engine, 6, CellState.Black)
        self.assertFalse(propagate_engine(engine))

    def test_uses_the_arrow_bound_to_force_cells(self) -> None:
        # A left-pointing 2 at (3,1) of a 5x3 board sees three cells. Three cells hold at
        # most two non-adjacent blacks and only one way round, so both ends are forced
        # black and the middle onto the loop. An even-length run would leave a genuine
        # choice and force nothing, which is why the ray here is deliberately odd.
        board = create_board(5, 3)
        board.cell[8].qdir = 3
        board.cell[8].qnum = 2
        engine = create_engine(board)
        propagate_engine(engine)
        self.assertEqual(engine.cell[7], CellState.Black)
        self.assertEqual(engine.cell[5], CellState.Black)
        self.assertEqual(engine.cell[6], CellState.Line)

    def test_coverage_is_between_nothing_and_everything(self) -> None:
        board = decode_url(PUBLISHED)
        coverage = propagation_coverage(board)
        self.assertGreater(coverage, 0)
        self.assertLessEqual(coverage, 10 * 10 + 2 * 10 * 9)


class UniquenessTest(unittest.TestCase):
    def test_published_puzzles_have_one_solution(self) -> None:
        for code in (PUBLISHED, "yajilin/10/10/a21a24a24a21a2343s42s41s41s43i"):
            result = count_solutions(decode_url(code), 2, 200000)
            self.assertFalse(result.aborted)
            self.assertEqual(len(result.solutions), 1, code)

    def test_an_empty_board_has_many_solutions(self) -> None:
        result = count_solutions(create_board(6, 6), 2, 200000)
        self.assertEqual(len(result.solutions), 2)


class DifficultyTest(unittest.TestCase):
    def test_bands_increase_with_the_score(self) -> None:
        # v5: the label is derived from the estimated rating, so pick one score inside
        # each band rather than hard-coding raw numbers.
        self.assertEqual(band(0), "intro")
        self.assertEqual(band(238), "easy")
        self.assertEqual(band(1000504), "medium")
        self.assertEqual(band(4001372), "hard")
        self.assertEqual(band(4002295), "expert")
        self.assertEqual(band(4004209), "fiendish")

    def test_puzzle_square_rating_uses_integer_interpolation(self) -> None:
        self.assertEqual(puzsq_rating_hundredths(-1), 50)
        self.assertEqual(puzsq_rating_hundredths(0), 50)
        # v5 anchors. The middle three are the interval-DP boundaries; 4.50 is pinned to
        # the start of stage 6 (the solver could not finish) and 5.49 to its 99th centile.
        self.assertEqual(puzsq_rating_hundredths(238), 150)
        self.assertEqual(puzsq_rating_hundredths(4001304), 250)
        self.assertEqual(puzsq_rating_hundredths(4004722), 350)
        self.assertEqual(puzsq_rating_hundredths(5000000), 450)
        self.assertEqual(puzsq_rating_hundredths(5032429), 549)
        self.assertEqual(puzsq_rating_hundredths(5032430), 549)
        self.assertEqual(puzsq_rating_hundredths(4003013), 300)
        self.assertEqual(puzsq_rating(4001304), 2.5)

    def test_size_scale_restates_scores_at_10x10_scale(self) -> None:
        self.assertEqual(size_scale(100), SIZE_SCALE_UNIT)
        self.assertGreater(size_scale(64), SIZE_SCALE_UNIT)
        self.assertLess(size_scale(289), SIZE_SCALE_UNIT)
        self.assertEqual(size_scale(81), 4410)
        self.assertEqual(size_scale(144), 3605)
        for cells in range(25, 1400):
            self.assertGreaterEqual(size_scale(cells), size_scale(cells + 1))
        self.assertEqual(size_scale(1), size_scale(25))
        self.assertEqual(size_scale(99999), size_scale(1400))

    def test_scores_a_published_puzzle(self) -> None:
        board = decode_url(PUBLISHED)
        score = difficulty(run_all(board), board)
        self.assertGreater(score, 0)
        self.assertLess(score, 100000)

    def test_puts_a_floor_under_puzzles_that_needed_a_counting_theorem(self) -> None:
        # The gate is on the technique being present at all, not on how much it produced,
        # so a single use of the invisible wall has to lift an otherwise trivial score.
        board = decode_url(PUBLISHED)
        outcome = run_all(board)
        plain = difficulty(outcome, board)
        self.assertLess(plain, 1200)
        outcome.recorder.counts[Reason.InvisibleWallByCount] = 1
        self.assertEqual(difficulty(outcome, board), 1200)
        # A reason with no gate of its own leaves the score where it was.
        del outcome.recorder.counts[Reason.InvisibleWallByCount]
        outcome.recorder.counts[Reason.SmallLoopBan] = 1
        self.assertLess(difficulty(outcome, board), 1200)


if __name__ == "__main__":
    unittest.main()
