/*
 * Unit tests for the pieces the golden-output comparison cannot localise.
 *
 * The cross-language `verify.sh` proves the three ports agree, but when it fails it says
 * only "these bytes differ". These tests pin the individual contracts that the ports have
 * to reproduce — most importantly the ones that look like bugs and are deliberate.
 */

import { describe, expect, it } from "vitest";

import { createBoard, toId, toPos } from "../board.js";
import {
  band,
  difficulty,
  puzsqRating,
  puzsqRatingHundredths,
  sizeScale,
  SIZE_SCALE_UNIT,
  UNFINISHED_BASE,
} from "../difficulty.js";
import { Reason } from "../reasons.js";
import {
  CellState,
  EdgeState,
  createEngine,
  propagateEngine,
  setCell,
} from "../engine.js";
import { decodeUrl, encodeBody, encodeCode, parseUrl } from "../puzzlink.js";
import { Rng } from "../random.js";
import { countSolutions, propagationCoverage } from "../search.js";
import {
  createSolution,
  extractSolution,
  validateSolution,
} from "../solution.js";
import { runAll } from "../solver.js";
import { UnionFind } from "../unionfind.js";

describe("UnionFind", () => {
  it("keeps the NaN size semantics of the original", () => {
    // size() of a root that was never registered is NaN, so the union-by-size comparison
    // in connect() is always false. Deductions depend on the resulting tree shape, so
    // this is reproduced rather than fixed — the ports must do the same.
    const uf = new UnionFind();
    expect(Number.isNaN(uf.size(1))).toBe(true);
    expect(uf.connect(1, 2)).toBe(true);
    // With both sizes NaN the swap never happens, so the first argument stays the root.
    expect(uf.root(2)).toBe(1);
    expect(uf.isUnion(1, 2)).toBe(true);
    expect(uf.connect(1, 2)).toBe(false);
  });

  it("copies without sharing state", () => {
    const uf = new UnionFind();
    uf.connect(1, 2);
    const copy = UnionFind.fromUF(uf);
    copy.connect(2, 3);
    expect(copy.isUnion(1, 3)).toBe(true);
    expect(uf.isUnion(1, 3)).toBe(false);
  });
});

describe("cell ids", () => {
  it("round-trips positions inside the supported range", () => {
    for (const pos of [
      { x: 0, y: 0 },
      { x: 9, y: 9 },
      { x: 255, y: 255 },
    ]) {
      expect(toPos(toId(pos))).toEqual(pos);
    }
  });
});

describe("puzz.link codec", () => {
  const codes = [
    "yajilin/10/10/r31d32k22b31d23b31k33r12c40c13n",
    "yajilin/10/10/a21a24a24a21a2343s42s41s41s43i",
    "yajilin/b/10/10/o0.e43j30a0.a0.a0.d2.k0.f20a0.a0.a3.b42za32",
  ];

  it("round-trips every corpus form", () => {
    for (const code of codes) {
      const board = decodeUrl(code);
      const again = decodeUrl(encodeCode(board));
      expect(again.cols).toBe(board.cols);
      expect(again.rows).toBe(board.rows);
      expect(again.cell).toEqual(board.cell);
    }
  });

  it("accepts full urls and bare codes alike", () => {
    const bare = parseUrl("yajilin/10/10/abc");
    const full = parseUrl("https://puzz.link/p?yajilin/10/10/abc");
    expect(full).toEqual(bare);
  });

  it("skips variant flags between the type and the size", () => {
    const parsed = parseUrl("yajilin/b/10/12/abc");
    expect(parsed.cols).toBe(10);
    expect(parsed.rows).toBe(12);
  });

  it("encodes an empty board as run-length skips only", () => {
    // 100 empty cells: three full runs of 26 ('z') and a remainder of 22 ('v').
    expect(encodeBody(createBoard(10, 10))).toBe("zzzv");
  });

  it("rejects other puzzle types", () => {
    expect(() => parseUrl("masyu/10/10/abc")).toThrow();
  });
});

describe("Rng", () => {
  // An independent bigint implementation of the same published algorithm; the shipped one
  // splits the state into 24-bit halves for speed, so this is a real cross-check.
  const reference = (seed: bigint) => {
    const MULTIPLIER = 0x5deece66dn;
    const MASK = (1n << 48n) - 1n;
    let state = (seed ^ MULTIPLIER) & MASK;
    return (bits: number) => {
      state = (state * MULTIPLIER + 0xbn) & MASK;
      return Number(state >> BigInt(48 - bits));
    };
  };

  it("matches the reference stream", () => {
    for (const seed of [0, 1, 42, 2147483647]) {
      const rng = new Rng(seed);
      const next = reference(BigInt(seed));
      for (let i = 0; i < 500; i++) {
        expect(rng.next(1 + (i % 32))).toBe(next(1 + (i % 32)));
      }
    }
  });

  it("bounds nextInt and stays inside the range", () => {
    const rng = new Rng(7);
    for (const bound of [1, 2, 3, 16, 1000]) {
      for (let i = 0; i < 200; i++) {
        const value = rng.nextInt(bound);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(bound);
      }
    }
    expect(() => rng.nextInt(0)).toThrow();
  });

  it("shuffles as a permutation and reproducibly", () => {
    const a = [0, 1, 2, 3, 4, 5, 6, 7];
    const b = [...a];
    new Rng(3).shuffle(a);
    new Rng(3).shuffle(b);
    expect(a).toEqual(b);
    expect([...a].sort((x, y) => x - y)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
});

describe("validateSolution", () => {
  const board = () => decodeUrl("yajilin/10/10/r31d32k22b31d23b31k33r12c40c13n");

  it("accepts the answer the solver finds", () => {
    const puzzle = board();
    const outcome = runAll(puzzle);
    expect(outcome.status).toBe("completed");
    expect(validateSolution(puzzle, extractSolution(outcome.answer))).toEqual([]);
  });

  it("rejects an empty answer", () => {
    const puzzle = board();
    const errors = validateSolution(puzzle, createSolution());
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((error) => error.kind === "cell-not-covered")).toBe(true);
  });

  it("rejects adjacent black cells", () => {
    const puzzle = createBoard(3, 3);
    const solution = createSolution();
    solution.blacks.add(toId({ x: 0, y: 0 }));
    solution.blacks.add(toId({ x: 1, y: 0 }));
    const errors = validateSolution(puzzle, solution);
    expect(errors.some((error) => error.kind === "adjacent-blacks")).toBe(true);
  });

  it("rejects a wrong arrow count", () => {
    const puzzle = board();
    const outcome = runAll(puzzle);
    const solution = extractSolution(outcome.answer);
    const clue = puzzle.cell.find((cell) => cell.qnum > 0)!;
    clue.qnum += 1;
    expect(
      validateSolution(puzzle, solution).some((error) => error.kind === "arrow-count")
    ).toBe(true);
  });
});

describe("constraint engine", () => {
  it("forces the neighbours of a black cell onto the loop", () => {
    const engine = createEngine(createBoard(4, 4));
    setCell(engine, 5, CellState.Black); // (1,1)
    expect(propagateEngine(engine)).toBe(true);
    expect(engine.cell[1]).toBe(CellState.Line); // above
    expect(engine.cell[4]).toBe(CellState.Line); // left
    expect(engine.cell[6]).toBe(CellState.Line); // right
    expect(engine.cell[9]).toBe(CellState.Line); // below
    for (let d = 0; d < 4; d++) {
      const edge = engine.incident[5 * 4 + d]!;
      expect(engine.edge[edge]).toBe(EdgeState.Blank);
    }
  });

  it("reports a contradiction for adjacent blacks", () => {
    const engine = createEngine(createBoard(4, 4));
    setCell(engine, 5, CellState.Black);
    setCell(engine, 6, CellState.Black);
    expect(propagateEngine(engine)).toBe(false);
  });

  it("uses the arrow bound to force cells", () => {
    // A left-pointing 2 at (3,1) of a 5x3 board sees three cells. Three cells hold at most
    // two non-adjacent blacks and only one way round, so both ends are forced black and
    // the middle is forced onto the loop. An even-length run would leave a genuine choice
    // and nothing would be forced, which is why the ray here is deliberately odd.
    const board = createBoard(5, 3);
    board.cell[8]!.qdir = 3;
    board.cell[8]!.qnum = 2;
    const engine = createEngine(board);
    propagateEngine(engine);
    expect(engine.cell[7]).toBe(CellState.Black);
    expect(engine.cell[5]).toBe(CellState.Black);
    expect(engine.cell[6]).toBe(CellState.Line);
  });

  it("scores coverage between nothing and everything", () => {
    const puzzle = decodeUrl("yajilin/10/10/r31d32k22b31d23b31k33r12c40c13n");
    const coverage = propagationCoverage(puzzle);
    expect(coverage).toBeGreaterThan(0);
    expect(coverage).toBeLessThanOrEqual(10 * 10 + 2 * 10 * 9);
  });
});

describe("uniqueness", () => {
  it("finds exactly one solution for published puzzles", () => {
    for (const code of [
      "yajilin/10/10/r31d32k22b31d23b31k33r12c40c13n",
      "yajilin/10/10/a21a24a24a21a2343s42s41s41s43i",
    ]) {
      const result = countSolutions(decodeUrl(code), 2, 200000);
      expect(result.aborted).toBe(false);
      expect(result.solutions.length).toBe(1);
    }
  });

  it("finds many solutions for an empty board", () => {
    const result = countSolutions(createBoard(6, 6), 2, 200000);
    expect(result.solutions.length).toBe(2);
  });
});

describe("difficulty", () => {
  it("bands increase with the score", () => {
    // v5: the label is derived from the estimated rating, so pick one score inside each
    // band rather than hard-coding raw numbers.
    expect(band(0)).toBe("intro");
    expect(band(238)).toBe("easy");
    expect(band(1000504)).toBe("medium");
    expect(band(4001372)).toBe("hard");
    expect(band(4002295)).toBe("expert");
    expect(band(4004209)).toBe("fiendish");
  });

  it("scores a published puzzle inside the calibrated range", () => {
    const board = decodeUrl("yajilin/10/10/r31d32k22b31d23b31k33r12c40c13n");
    const score = difficulty(runAll(board), board);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(100000);
  });

  it("maps the score onto the 1-5 scale in integers", () => {
    // The anchors and the rounding of the interpolation between them are what the three
    // ports have to agree on to the last digit, so they are pinned here rather than left
    // to the golden outputs, which would only say "these bytes differ".
    // v5 anchors. The middle three are the interval-DP boundaries; 4.50 is pinned to the
    // start of stage 6 (the solver could not finish) and 5.49 to that stage's 99th centile.
    expect(puzsqRatingHundredths(-1)).toBe(50);
    expect(puzsqRatingHundredths(0)).toBe(50);
    expect(puzsqRatingHundredths(238)).toBe(150);
    expect(puzsqRatingHundredths(4001304)).toBe(250);
    expect(puzsqRatingHundredths(4004722)).toBe(350);
    expect(puzsqRatingHundredths(5000000)).toBe(450);
    expect(puzsqRatingHundredths(5032429)).toBe(549);
    expect(puzsqRatingHundredths(5032430)).toBe(549);
    expect(puzsqRatingHundredths(4003013)).toBe(300);
    expect(puzsqRating(4001304)).toBe(2.5);
    // The top of the scale is the unfinished boundary itself, not a fitted number: a score
    // rounds to 5 exactly when the technique solver could not finish.
  });

  it("puts a floor under puzzles that needed a counting theorem", () => {
    // The gate is on the technique being present at all, not on how much it produced, so
    // a single use of the invisible wall has to lift an otherwise trivial score.
    const board = decodeUrl("yajilin/10/10/r31d32k22b31d23b31k33r12c40c13n");
    const outcome = runAll(board);
    const plain = difficulty(outcome, board);
    expect(plain).toBeLessThan(1200);
    outcome.recorder.counts.set(Reason.InvisibleWallByCount, 1);
    expect(difficulty(outcome, board)).toBe(1200);
    // A reason with no gate of its own leaves the score where it was.
    outcome.recorder.counts.delete(Reason.InvisibleWallByCount);
    outcome.recorder.counts.set(Reason.SmallLoopBan, 1);
    expect(difficulty(outcome, board)).toBeLessThan(1200);
  });

  it("restates the score at 10x10 scale", () => {
    // 10x10 is the reference size and must be left exactly alone; smaller boards score
    // higher for the same work and larger ones lower, which is the whole point.
    expect(sizeScale(100)).toBe(SIZE_SCALE_UNIT);
    expect(sizeScale(64)).toBeGreaterThan(SIZE_SCALE_UNIT);
    expect(sizeScale(289)).toBeLessThan(SIZE_SCALE_UNIT);
    // Table entries are exact and the gaps interpolate monotonically.
    expect(sizeScale(81)).toBe(4410);
    expect(sizeScale(144)).toBe(3605);
    for (let cells = 25; cells < 1400; cells++) {
      expect(sizeScale(cells)).toBeGreaterThanOrEqual(sizeScale(cells + 1));
    }
    // Off the ends the table clamps rather than extrapolating.
    expect(sizeScale(1)).toBe(sizeScale(25));
    expect(sizeScale(99999)).toBe(sizeScale(1400));
  });
});
