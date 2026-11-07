/*
 * Yajilin Kit — puzzle generation.
 *
 * Two entry points that share one pipeline:
 *
 *   generateLoop     the loop comes first. A random valid answer is drawn on an empty
 *                    board, which yields a single loop plus a set of black cells. Black
 *                    cells are then promoted to arrow clues one at a time until the
 *                    puzzle has exactly one solution, and afterwards demoted again for as
 *                    long as uniqueness survives. Promotion and demotion never invalidate
 *                    the answer: a clue cell, like a black cell, is a cell the loop does
 *                    not visit, so the loop itself is fixed from the first step.
 *
 *   generatePattern  the clue positions come first, from a supplied or symmetric pattern.
 *                    Those cells are blocked, a random answer is drawn around them, and
 *                    the arrow directions are then steered until the puzzle is unique.
 *
 * Both finish by weakening clues — swapping in directions that say less — while the
 * solution stays unique, because a puzzle that says less is a puzzle that asks more.
 */

import { createBoard, toId, toPos, type Board } from "./board.js";
import { dirs, type Position } from "./position.js";
import { runAll, type SolveOutcome } from "./solver.js";
import {
  analysePropagation,
  countLoopRoutings,
  countSolutions,
  drawSolution,
  findInitialSolution,
} from "./search.js";
import type { Rng } from "./random.js";
import { createSolution, validateSolution, type Solution } from "./solution.js";
import { difficulty, techniqueWork } from "./difficulty.js";

export type Symmetry = "none" | "rot2" | "rot4" | "mirror-h" | "mirror-v";

export type GenerateOptions = {
  cols: number;
  rows: number;
  /** Loop mode: upper bound on clues. Pattern mode: how many cells the pattern gets. */
  clues?: number;
  clueRatio?: number;
  /** Retry budget for the whole pipeline; 0 = unlimited. */
  attempts?: number;
  dpMin?: number;
  dpMax?: number;
  /** Search node cap; 0 = unlimited. */
  maxNodes?: number;
  /** Swap in less informative clue directions while the puzzle stays unique. */
  weaken?: boolean;
  /** Drop clues that uniqueness does not need (loop mode). */
  reduce?: boolean;
  symmetry?: Symmetry;
  pattern?: boolean[];
  /** How often, per thousand, the answer search tries a cell as black first. */
  blackBias?: number;
  /** Hill-climbing rounds spent making the finished puzzle harder; 0 disables it. */
  refine?: number;
  /** Annealing rounds used to reach uniqueness when the greedy repair stalls. */
  anneal?: number;
  /**
   * Let the annealing add and remove clues, not just move and re-aim them. Produces
   * harder puzzles at the cost of roughly 40% more time.
   */
  varyClueCount?: boolean;
  /** Optional progress hook; used by the diagnostics in `tools/`. */
  trace?: (message: string) => void;
};

export type Generated = {
  board: Board;
  solution: Solution;
  outcome: SolveOutcome;
  difficulty: number;
  attempts: number;
};

const DEFAULT_CLUE_RATIO = 0.16;
const DEFAULT_BLACK_BIAS = 850;
/** How many repair rounds phase 2 gets before the attempt is abandoned. */
const REPAIR_ROUNDS = 24;
/** How many rolled-back promotions phase 1 tolerates before giving up on the answer. */
const PROMOTION_REJECTIONS = 24;
/** How many unsolvable pattern draws are skipped before one counts as a failed attempt. */
const PATTERN_DRAWS = 30;

/**
 * Annealing rounds used when the greedy repair cannot reach uniqueness. Scaled with the
 * board because coverage has that much further to climb on a larger one.
 */
const annealRoundsFor = (cols: number, rows: number): number =>
  Math.max(400, cols * rows * 8);

type Clue = { pos: Position; index: number };

const rayLength = (board: Board, origin: Position, dir: number): number => {
  const delta = dirs[dir]!;
  let x = origin.x + delta.x;
  let y = origin.y + delta.y;
  let length = 0;
  while (board.inBoard({ x, y })) {
    length++;
    x += delta.x;
    y += delta.y;
  }
  return length;
};

const countBlacksInRay = (
  board: Board,
  blacks: Set<number>,
  origin: Position,
  dir: number
): number => {
  const delta = dirs[dir]!;
  let x = origin.x + delta.x;
  let y = origin.y + delta.y;
  let count = 0;
  while (board.inBoard({ x, y })) {
    if (blacks.has(toId({ x, y }))) count++;
    x += delta.x;
    y += delta.y;
  }
  return count;
};

/** Directions ordered from the most informative (longest ray) to the least. */
const directionsByReach = (board: Board, origin: Position, rng: Rng): number[] => {
  const scored = [1, 2, 3, 4].map((dir) => ({
    dir,
    reach: rayLength(board, origin, dir),
    tiebreak: rng.nextInt(1 << 20),
  }));
  scored.sort((a, b) => b.reach - a.reach || a.tiebreak - b.tiebreak);
  return scored.map((entry) => entry.dir);
};

/** Clue counts depend on the black cells, so they are recomputed after every change. */
const refreshCounts = (board: Board, solution: Solution, clues: Clue[]): void => {
  for (const clue of clues) {
    const cell = board.cell[clue.index]!;
    cell.qnum = countBlacksInRay(board, solution.blacks, clue.pos, cell.qdir);
  }
};

const uniqueness = (
  board: Board,
  maxNodes: number
): { unique: boolean; other?: Solution; aborted: boolean } => {
  const result = countSolutions(board, 2, maxNodes);
  if (result.aborted) return { unique: false, aborted: true };
  if (result.solutions.length === 1) return { unique: true, aborted: false };
  return { unique: false, other: result.solutions[1] ?? result.solutions[0], aborted: false };
};

/**
 * Picks the direction for a clue. Directions whose black count differs between the
 * intended answer and a rival answer are preferred, since those rule the rival out;
 * among equals the longest ray wins.
 */
const chooseDirection = (
  board: Board,
  solution: Solution,
  other: Solution | undefined,
  pos: Position,
  rng: Rng
): number => {
  const ordered = directionsByReach(board, pos, rng);
  if (other) {
    for (const dir of ordered) {
      const mine = countBlacksInRay(board, solution.blacks, pos, dir);
      const theirs = countBlacksInRay(board, other.blacks, pos, dir);
      if (mine !== theirs) return dir;
    }
  }
  return ordered[0]!;
};

const promote = (
  board: Board,
  solution: Solution,
  clues: Clue[],
  pos: Position,
  dir: number
): void => {
  const index = pos.y * board.cols + pos.x;
  solution.blacks.delete(toId(pos));
  board.cell[index]!.qdir = dir;
  board.cell[index]!.qnum = 0;
  clues.push({ pos, index });
  refreshCounts(board, solution, clues);
};

const demote = (
  board: Board,
  solution: Solution,
  clues: Clue[],
  clue: Clue
): void => {
  solution.blacks.add(toId(clue.pos));
  board.cell[clue.index]!.qdir = -1;
  board.cell[clue.index]!.qnum = -1;
  const at = clues.indexOf(clue);
  if (at >= 0) clues.splice(at, 1);
  refreshCounts(board, solution, clues);
};

/**
 * Drops clues that uniqueness does not depend on. A dropped clue turns back into a black
 * cell, so it can only go if none of its neighbours is black — the answer has moved on
 * since the clue was created and may have placed blacks right next to it.
 */
const reduceClues = (
  board: Board,
  solution: Solution,
  clues: Clue[],
  rng: Rng,
  maxNodes: number
): void => {
  const order = [...clues];
  rng.shuffle(order);
  for (const clue of order) {
    const blockedByNeighbour = [1, 2, 3, 4].some((dir) => {
      const delta = dirs[dir]!;
      const neighbour = { x: clue.pos.x + delta.x, y: clue.pos.y + delta.y };
      return board.inBoard(neighbour) && solution.blacks.has(toId(neighbour));
    });
    if (blockedByNeighbour) continue;

    const saved = { qdir: board.cell[clue.index]!.qdir, qnum: board.cell[clue.index]!.qnum };
    demote(board, solution, clues, clue);
    if (!uniqueness(board, maxNodes).unique) {
      solution.blacks.delete(toId(clue.pos));
      board.cell[clue.index]!.qdir = saved.qdir;
      board.cell[clue.index]!.qnum = saved.qnum;
      clues.push(clue);
      refreshCounts(board, solution, clues);
    }
  }
};

/** Replaces clue directions with less informative ones while the puzzle stays unique. */
const weakenClues = (
  board: Board,
  solution: Solution,
  clues: Clue[],
  rng: Rng,
  maxNodes: number
): void => {
  const order = [...clues];
  rng.shuffle(order);
  for (const clue of order) {
    const cell = board.cell[clue.index]!;
    const original = cell.qdir;
    for (const dir of directionsByReach(board, clue.pos, rng).reverse()) {
      if (dir === original) continue;
      cell.qdir = dir;
      refreshCounts(board, solution, clues);
      if (uniqueness(board, maxNodes).unique) {
        break;
      }
      cell.qdir = original;
      refreshCounts(board, solution, clues);
    }
  }
};

type Snapshot = {
  qdir: number[];
  qnum: number[];
  blacks: number[];
  horizontal: number[];
  vertical: number[];
  clues: Clue[];
};

const snapshot = (board: Board, solution: Solution, clues: Clue[]): Snapshot => ({
  qdir: board.cell.map((cell) => cell.qdir),
  qnum: board.cell.map((cell) => cell.qnum),
  blacks: [...solution.blacks],
  horizontal: [...solution.horizontal],
  vertical: [...solution.vertical],
  // Copies, not references: relocateClue mutates the records in place.
  clues: clues.map((clue) => ({ pos: clue.pos, index: clue.index })),
});

const restore = (
  board: Board,
  solution: Solution,
  clues: Clue[],
  saved: Snapshot
): void => {
  board.cell.forEach((cell, index) => {
    cell.qdir = saved.qdir[index]!;
    cell.qnum = saved.qnum[index]!;
  });
  solution.blacks.clear();
  saved.blacks.forEach((id) => solution.blacks.add(id));
  solution.horizontal.clear();
  saved.horizontal.forEach((id) => solution.horizontal.add(id));
  solution.vertical.clear();
  saved.vertical.forEach((id) => solution.vertical.add(id));
  clues.length = 0;
  // Copies again on the way back: relocateClue mutates clue records in place, so handing
  // the snapshot's own objects to the live list would let later moves corrupt it. That
  // matters as soon as one snapshot is restored more than once, which the reheat does.
  saved.clues.forEach((clue) => clues.push({ pos: clue.pos, index: clue.index }));
};

/** Overwrites `target` with `source` so the answer object identity stays stable. */
const adoptSolution = (target: Solution, source: Solution): void => {
  target.blacks.clear();
  source.blacks.forEach((id) => target.blacks.add(id));
  target.horizontal.clear();
  source.horizontal.forEach((id) => target.horizontal.add(id));
  target.vertical.clear();
  source.vertical.forEach((id) => target.vertical.add(id));
};

const blackNeighbour = (
  board: Board,
  solution: Solution,
  pos: Position
): boolean =>
  [1, 2, 3, 4].some((dir) => {
    const delta = dirs[dir]!;
    const neighbour = { x: pos.x + delta.x, y: pos.y + delta.y };
    return board.inBoard(neighbour) && solution.blacks.has(toId(neighbour));
  });

/**
 * Hill-climbs on difficulty while keeping the solution unique. The neighbourhood is
 * "change a clue's direction" and "move a clue to a nearby black cell" — moving is the
 * interesting one, because where an arrow sits decides what it can see, and a clue that
 * has drifted a couple of cells away often forces a longer chain of deductions than the
 * same arrow re-aimed in place. Moving is demote-then-promote, so the answer never moves;
 * only the clue does.
 */
const refinePuzzle = (
  board: Board,
  solution: Solution,
  clues: Clue[],
  rng: Rng,
  rounds: number,
  maxNodes: number
): void => {
  let best = techniqueWork(runAll(board));
  for (let round = 0; round < rounds; round++) {
    if (clues.length === 0) return;
    const saved = snapshot(board, solution, clues);
    const clue = clues[rng.nextInt(clues.length)]!;

    if (rng.nextInt(2) === 0) {
      const directions = directionsByReach(board, clue.pos, rng);
      const dir = directions[rng.nextInt(directions.length)]!;
      board.cell[clue.index]!.qdir = dir;
      refreshCounts(board, solution, clues);
    } else {
      if (blackNeighbour(board, solution, clue.pos)) continue;
      demote(board, solution, clues, clue);
      const near = [...solution.blacks]
        .sort((a, b) => a - b)
        .map(toPos)
        .filter(
          (pos) =>
            Math.abs(pos.x - clue.pos.x) + Math.abs(pos.y - clue.pos.y) <= 3
        );
      const pool =
        near.length > 0 ? near : [...solution.blacks].sort((a, b) => a - b).map(toPos);
      if (pool.length === 0) {
        restore(board, solution, clues, saved);
        continue;
      }
      const target = pool[rng.nextInt(pool.length)]!;
      promote(
        board,
        solution,
        clues,
        target,
        chooseDirection(board, solution, undefined, target, rng)
      );
    }

    if (
      validateSolution(board, solution).length > 0 ||
      !uniqueness(board, maxNodes).unique
    ) {
      restore(board, solution, clues, saved);
      continue;
    }
    const score = techniqueWork(runAll(board));
    if (score > best) {
      best = score;
    } else {
      restore(board, solution, clues, saved);
    }
  }
};

/**
 * Turns an ambiguous board into a unique one by re-aiming arrows. Each round asks the
 * search for a rival answer and re-aims one clue so that its count separates the intended
 * answer from that rival; the rival is then dead and the next round attacks the next one.
 * The clue positions and the answer never move here.
 */
const steerDirections = (
  board: Board,
  solution: Solution,
  clues: Clue[],
  rng: Rng,
  maxNodes: number
): boolean => {
  for (let round = 0; round < clues.length * 4 + 4; round++) {
    const status = uniqueness(board, maxNodes);
    if (status.aborted) return false;
    if (status.unique) return true;

    const order = [...clues];
    rng.shuffle(order);
    let changed = false;
    for (const clue of order) {
      const cell = board.cell[clue.index]!;
      const dir = chooseDirection(board, solution, status.other, clue.pos, rng);
      if (dir === cell.qdir) continue;
      const mine = countBlacksInRay(board, solution.blacks, clue.pos, dir);
      const theirs = countBlacksInRay(board, status.other!.blacks, clue.pos, dir);
      if (mine === theirs) continue;
      cell.qdir = dir;
      refreshCounts(board, solution, clues);
      changed = true;
      break;
    }
    if (!changed) return false;
  }
  return uniqueness(board, maxNodes).unique;
};

/**
 * Asks whether the black cells alone pin down the loop, and if they do not, says where
 * the slack is.
 *
 * Two answers with the same black cells cannot be told apart by any arrow, so such an
 * answer can never become a unique puzzle. Rather than throw it away, the cells sitting on
 * the edges the two routings disagree about are returned: blocking one of them is what
 * removes the ambiguity, and on boards past about 10x10 that targeted repair is the
 * difference between generation working and generation never converging — a randomly
 * drawn answer forces its own loop only around one time in seven at 10x10, and
 * essentially never at 12x12 and above.
 */
const loopSlack = (
  board: Board,
  solution: Solution,
  maxNodes: number
): { forced: boolean; ambiguous: Position[] } => {
  const result = countLoopRoutings(board, solution, 2, maxNodes);
  if (result.aborted) return { forced: false, ambiguous: [] };
  if (result.solutions.length === 1) return { forced: true, ambiguous: [] };
  const rival = result.solutions[1];
  if (!rival) return { forced: false, ambiguous: [] };

  const cells = new Set<number>();
  const note = (id: number, horizontal: boolean) => {
    const pos = toPos(id);
    cells.add(toId(pos));
    const other = horizontal ? { x: pos.x + 1, y: pos.y } : { x: pos.x, y: pos.y + 1 };
    if (board.inBoard(other)) cells.add(toId(other));
  };
  solution.horizontal.forEach((id) => {
    if (!rival.horizontal.has(id)) note(id, true);
  });
  rival.horizontal.forEach((id) => {
    if (!solution.horizontal.has(id)) note(id, true);
  });
  solution.vertical.forEach((id) => {
    if (!rival.vertical.has(id)) note(id, false);
  });
  rival.vertical.forEach((id) => {
    if (!solution.vertical.has(id)) note(id, false);
  });

  return {
    forced: false,
    ambiguous: [...cells].sort((a, b) => a - b).map(toPos),
  };
};


/**
 * Moves a clue from one cell to another. Only the board and the clue list change; the
 * answer is redrawn by the caller, because the vacated cell has to rejoin the loop (or
 * become black) and the occupied one has to leave it.
 */
const relocateClue = (board: Board, clues: Clue[], clue: Clue, to: Position): void => {
  const from = board.cell[clue.index]!;
  const dir = from.qdir;
  from.qdir = -1;
  from.qnum = -1;
  const index = to.y * board.cols + to.x;
  board.cell[index]!.qdir = dir;
  board.cell[index]!.qnum = 0;
  clue.pos = to;
  clue.index = index;
};

const isClueCell = (board: Board, pos: Position): boolean =>
  board.cell[pos.y * board.cols + pos.x]!.qnum !== -1;

/** Threshold-accepting schedule: how much worse a state may be and still be kept. */
const ANNEAL_START_THRESHOLD = 6;
// Late acceptance hill climbing was tried in place of the threshold schedule and made no
// difference — 12 to 13 of 16 on pattern 12x12 at history lengths 10, 50 and 200, against
// 13 of 16 here. The acceptance rule is not what limits this search.
/** Rounds without a new best coverage before the threshold is reheated. */
const ANNEAL_REHEAT_AFTER = 60;
/** Rounds without a new best before the run is abandoned in favour of a fresh attempt. */
const ANNEAL_GIVE_UP = 240;
/** How often uniqueness is retested regardless of coverage. */
const ANNEAL_CHECK_EVERY = 25;

/**
 * Anneals the clue layout towards a unique puzzle.
 *
 * The objective is how much of the answer plain propagation pins down (`propagationCoverage`).
 * Uniqueness on its own is a yes/no answer that gives a search nothing to climb, whereas
 * coverage rises as the clues start to bite, so a local search over clue configurations
 * has a gradient to follow. The neighbourhood is deliberately small and geometric —
 * nudge an arrow one cell, re-aim it, or relocate it onto a black cell — because where an
 * arrow sits decides what it can see.
 *
 * Acceptance is threshold accepting rather than the usual exp(-delta/T) Metropolis rule:
 * it needs no floating-point exponential, and so behaves identically in all three ports.
 */
// Pairing coverage with a probe — a node-capped search for a second solution, scored by
// how hard that second solution was to find — was tried as a way past the plateau. On one
// set of 16 seeds it looked like a gain (14 of 16 against 13); on an independent set it
// was 13 against 13 and 40% slower. It was noise, and it is out.
const annealClues = (
  board: Board,
  answer: Solution,
  clues: Clue[],
  rng: Rng,
  rounds: number,
  maxNodes: number,
  blackBias: number,
  /**
   * Whether clues may move. Pattern mode fixes the positions by definition — the pattern
   * is the point — so there only the aiming moves are available.
   */
  movePositions: boolean,
  /** Whether the annealing may add and remove clues as well as move them. */
  varyClueCount: boolean,
  /**
   * Pattern mode only. When set, whole symmetry orbits may be relocated together, which
   * lets the clue positions adapt without the pattern losing the symmetry that is the
   * point of the mode. Loop mode passes undefined; it moves clues individually.
   */
  orbitSymmetry: Symmetry | undefined,
  trace?: (message: string) => void
): boolean => {
  if (clues.length === 0 || rounds <= 0) {
    return uniqueness(board, maxNodes).unique;
  }
  // Bounds for the add/remove moves, relative to where phase 1 left off.
  const clueCeiling = clues.length + Math.max(2, Math.ceil(clues.length / 2));
  const clueFloor = Math.max(1, Math.floor(clues.length / 2));

  let analysis = analysePropagation(board);
  let current = analysis.coverage;
  let best = current;
  if (uniqueness(board, maxNodes).unique) {
    return true;
  }

  let sinceImprovement = 0;
  for (let round = 0; round < rounds; round++) {
    // Threshold accepting, cooled linearly, with a reheat whenever the search has been
    // stuck for a while: coverage plateaus long before it runs out, and without the kick
    // the last stretch is where every large board stalls.
    let threshold = Math.floor(
      (ANNEAL_START_THRESHOLD * (rounds - round)) / rounds
    );
    // A run that has been reheated several times without finding anything new is not
    // going to; on a large board the caller's next attempt — a fresh answer and a fresh
    // set of clue positions — is worth more than another thousand rounds here.
    if (sinceImprovement > ANNEAL_GIVE_UP) {
      trace?.(`  anneal gave up after ${round} rounds without progress`);
      break;
    }
    if (sinceImprovement > ANNEAL_REHEAT_AFTER) {
      threshold = ANNEAL_START_THRESHOLD;
      sinceImprovement = 0;
      // Restarting from the best layout found so far was tried here and measured slower
      // with no gain (12x12: 255s against 211s). Reheating exists to diversify, and
      // snapping back to the best state repeatedly just re-enters the same basin.
    }
    sinceImprovement++;

    // A puzzle can be unique long before propagation alone decides everything — a typical
    // published 10x10 only reaches three quarters coverage — so uniqueness is retested on
    // a fixed cadence as well as whenever coverage improves.
    if (round > 0 && round % ANNEAL_CHECK_EVERY === 0) {
      if (uniqueness(board, maxNodes).unique) {
        return true;
      }
    }
    const saved = snapshot(board, answer, clues);
    const clue = clues[rng.nextInt(clues.length)]!;
    const undetermined = analysis.undetermined;
    // Moves 5 and 6 change how many clues there are, which phase 1 otherwise fixes from
    // the board area and never revisits. They are opt-in: measured over the same seeds
    // they bought roughly 50% more difficulty for 35-45% more time, with success rates
    // unchanged or a shade worse, so the caller decides whether that is a good trade.
    // Weighting the move kinds by how often each had recently led somewhere was tried and
    // changed nothing measurable, so the choice stays uniform. Weighting them by cost —
    // re-aiming needs no redraw, everything else does — was tried too and was no better
    // over the seeds it was measured on.
    // Pattern mode normally only re-aims (moves 1 and 3), because its clue positions
    // belong to the pattern. With a symmetry to respect it can also relocate a whole
    // orbit (move 7), which adapts the positions while keeping the pattern symmetric.
    const move = movePositions
      ? rng.nextInt(varyClueCount ? 7 : 5)
      : orbitSymmetry !== undefined && rng.nextInt(3) === 0
        ? 7
        : 1 + 2 * rng.nextInt(2);

    // Re-aiming leaves the clue where it is, so the answer stays valid and the redraw —
    // by far the most expensive part of a round — can be skipped entirely. Every other
    // move changes which cells the loop may use and needs a fresh answer.
    const relocates = move !== 1 && move !== 3;

    if (move === 0) {
      // Nudge the arrow one cell.
      const delta = dirs[1 + rng.nextInt(4)]!;
      const to = { x: clue.pos.x + delta.x, y: clue.pos.y + delta.y };
      if (!board.inBoard(to) || isClueCell(board, to)) continue;
      relocateClue(board, clues, clue, to);
    } else if (move === 1) {
      // Re-aim it at random.
      const directions = directionsByReach(board, clue.pos, rng);
      board.cell[clue.index]!.qdir = directions[rng.nextInt(directions.length)]!;
    } else if (move === 2) {
      // Drop it onto one of the answer's black cells, which the loop already avoids.
      const blacks = [...answer.blacks].sort((a, b) => a - b).map(toPos);
      if (blacks.length === 0) continue;
      relocateClue(board, clues, clue, blacks[rng.nextInt(blacks.length)]!);
    } else if (move === 3) {
      // Aim it wherever the board is still undecided: an arrow earns its keep by
      // counting cells whose colour is still open, not ones already pinned down.
      if (undetermined.length === 0) continue;
      const openCells = new Set(undetermined);
      let bestDir = 0;
      let bestSeen = -1;
      for (const dir of directionsByReach(board, clue.pos, rng)) {
        const delta = dirs[dir]!;
        let x = clue.pos.x + delta.x;
        let y = clue.pos.y + delta.y;
        let seen = 0;
        while (board.inBoard({ x, y })) {
          if (openCells.has(y * board.cols + x)) seen++;
          x += delta.x;
          y += delta.y;
        }
        if (seen > bestSeen) {
          bestSeen = seen;
          bestDir = dir;
        }
      }
      if (bestDir === 0 || bestDir === board.cell[clue.index]!.qdir) continue;
      board.cell[clue.index]!.qdir = bestDir;
    } else if (move === 5) {
      // Add a clue on one of the answer's black cells.
      if (clues.length >= clueCeiling) continue;
      const blacks = [...answer.blacks].sort((a, b) => a - b).map(toPos);
      if (blacks.length === 0) continue;
      const pos = blacks[rng.nextInt(blacks.length)]!;
      promote(board, answer, clues, pos, chooseDirection(board, answer, undefined, pos, rng));
    } else if (move === 7) {
      // Relocate this clue's whole orbit onto a free orbit elsewhere.
      const from = orbitOf(board.cols, board.rows, orbitSymmetry!, clue.pos);
      const target = orbitOf(board.cols, board.rows, orbitSymmetry!, {
        x: rng.nextInt(board.cols),
        y: rng.nextInt(board.rows),
      });
      if (target.length !== from.length) continue;
      if (target.some((pos) => isClueCell(board, pos) && !from.some((f) => f.x === pos.x && f.y === pos.y))) {
        continue;
      }
      const moved = from.map((pos) => clues.find((c) => c.pos.x === pos.x && c.pos.y === pos.y));
      if (moved.some((c) => c === undefined)) continue;
      moved.forEach((c) => {
        board.cell[c!.index]!.qnum = -1;
        board.cell[c!.index]!.qdir = -1;
      });
      moved.forEach((c, at) => {
        const to = target[at]!;
        const index = to.y * board.cols + to.x;
        board.cell[index]!.qdir = 1;
        board.cell[index]!.qnum = 0;
        c!.pos = to;
        c!.index = index;
      });
    } else if (move === 6) {
      // Drop a clue, turning it back into a black cell. Only safe where that would not
      // put two black cells side by side.
      if (clues.length <= clueFloor) continue;
      if (blackNeighbour(board, answer, clue.pos)) continue;
      demote(board, answer, clues, clue);
    } else {
      // Move it next to somewhere still undecided.
      if (undetermined.length === 0) continue;
      const focus = undetermined[rng.nextInt(undetermined.length)]!;
      const fx = focus % board.cols;
      const fy = Math.floor(focus / board.cols);
      const blacks = [...answer.blacks].sort((a, b) => a - b).map(toPos);
      if (blacks.length === 0) continue;
      let target = blacks[0]!;
      let bestDistance = Number.MAX_SAFE_INTEGER;
      for (const pos of blacks) {
        const distance = Math.abs(pos.x - fx) + Math.abs(pos.y - fy);
        if (distance < bestDistance) {
          bestDistance = distance;
          target = pos;
        }
      }
      relocateClue(board, clues, clue, target);
    }

    if (relocates) {
      const next = drawSolution(board, rng, maxNodes, blackBias);
      if (!next) {
        restore(board, answer, clues, saved);
        continue;
      }
      adoptSolution(answer, next);
    }
    refreshCounts(board, answer, clues);

    const candidate = analysePropagation(board);
    if (candidate.coverage < 0 || candidate.coverage < current - threshold) {
      restore(board, answer, clues, saved);
      continue;
    }
    analysis = candidate;
    current = candidate.coverage;
    if (current > best) {
      best = current;
      sinceImprovement = 0;
      trace?.(`  anneal round ${round}: coverage ${current}`);
      if (uniqueness(board, maxNodes).unique) {
        return true;
      }
    }
  }
  return uniqueness(board, maxNodes).unique;
};

const finish = (
  board: Board,
  solution: Solution,
  rng: Rng,
  clues: Clue[],
  options: GenerateOptions,
  attempts: number
): Generated | undefined => {
  const maxNodes = options.maxNodes ?? 0;
  if (validateSolution(board, solution).length > 0) {
    return undefined;
  }
  if (options.reduce !== false) {
    reduceClues(board, solution, clues, rng, maxNodes);
  }
  if (options.weaken !== false) {
    weakenClues(board, solution, clues, rng, maxNodes);
  }
  if ((options.refine ?? 0) > 0) {
    refinePuzzle(board, solution, clues, rng, options.refine!, maxNodes);
  }
  if (!uniqueness(board, maxNodes).unique) {
    return undefined;
  }

  const outcome = runAll(board);
  const score = difficulty(outcome, board);
  if (options.dpMin !== undefined && score < options.dpMin) return undefined;
  if (options.dpMax !== undefined && score > options.dpMax) return undefined;
  return { board, solution, outcome, difficulty: score, attempts };
};

export const generateLoop = (
  rng: Rng,
  options: GenerateOptions
): Generated | undefined => {
  const { cols, rows } = options;
  const attemptLimit = options.attempts ?? 100;
  const maxNodes = options.maxNodes ?? 0;
  const blackBias = options.blackBias ?? DEFAULT_BLACK_BIAS;
  const clueLimit =
    options.clues ??
    Math.max(1, Math.round(cols * rows * (options.clueRatio ?? DEFAULT_CLUE_RATIO)));

  for (let attempt = 1; attemptLimit === 0 || attempt <= attemptLimit; attempt++) {
    const board = createBoard(cols, rows);
    let answer = findInitialSolution(board, rng, maxNodes, blackBias);
    if (!answer) {
      options.trace?.(`attempt ${attempt}: no initial answer`);
      continue;
    }
    options.trace?.(`attempt ${attempt}: answer with ${answer.blacks.size} blacks`);

    // Phase 1 — decide where the clues go. Black cells are promoted in batches and the
    // answer is redrawn after each batch. Redrawing is what keeps the board dense: once a
    // cell is blocked its neighbours are free to be black, so the fresh answer carries
    // roughly as many black cells as before on top of the clues already placed. Without it
    // every clue would cost a black cell and the puzzle would drift towards "no black
    // cells anywhere", which is barely constrained at all.
    const clues: Clue[] = [];
    let failed = false;
    let rejections = 0;
    // Cap on how many clues one round may add. It halves whenever a round is rolled back,
    // because a rejection usually means the batch was too coarse rather than that the
    // board is out of room — on a 15x15 the first batch is eighteen clues at once, and
    // dropping eighteen obstacles onto a board in one go strands cells far more often
    // than dropping them a few at a time.
    let batchCap = clueLimit;
    while (clues.length < clueLimit) {
      const remaining = clueLimit - clues.length;
      const candidates = [...answer.blacks].sort((a, b) => a - b).map(toPos);
      // Never take more than half the black cells in one round: promoting all of them
      // leaves an answer with nothing to count, and the next redraw has no material to
      // work with.
      const batch = Math.max(
        1,
        Math.min(Math.ceil(remaining / 2), Math.ceil(candidates.length / 2), batchCap)
      );
      rng.shuffle(candidates);
      const chosen = candidates.slice(0, Math.min(batch, remaining));
      if (chosen.length === 0) {
        options.trace?.(`  ran out of black cells at ${clues.length} clues`);
        failed = true;
        break;
      }

      // A clue is an obstacle, and obstacles can make a board unsolvable outright — a
      // scattered enough set strands a cell with fewer than two free sides. When the
      // redraw comes back empty the promotion is rolled back and a different set of cells
      // is tried, which is the difference between an attempt surviving and being thrown
      // away wholesale.
      const saved = snapshot(board, answer, clues);
      for (const pos of chosen) {
        promote(board, answer, clues, pos, chooseDirection(board, answer, undefined, pos, rng));
      }
      const next = drawSolution(board, rng, maxNodes, blackBias);
      if (!next) {
        restore(board, answer, clues, saved);
        rejections++;
        batchCap = Math.max(1, Math.floor(chosen.length / 2));
        options.trace?.(
          `  no answer after promoting ${chosen.length}; rolled back, batch cap ${batchCap} (${rejections})`
        );
        if (rejections > PROMOTION_REJECTIONS) {
          failed = true;
          break;
        }
        continue;
      }
      answer = next;
      refreshCounts(board, answer, clues);
      options.trace?.(`  ${clues.length} clues, ${answer.blacks.size} blacks`);
    }
    if (failed) continue;

    // Phase 2 — make the answer unique. Two things can be wrong, and they need different
    // repairs: if the loop is interchangeable no arrow can help, so a clue is planted in
    // the ambiguous region and the answer redrawn around it; if the loop is pinned down
    // but rival black configurations survive, the arrows are re-aimed instead.
    let unique = false;
    const clueCeiling = clueLimit + Math.max(2, Math.ceil(clueLimit / 2));
    for (let retry = 0; retry <= REPAIR_ROUNDS; retry++) {
      const slack = loopSlack(board, answer, maxNodes);
      if (slack.forced) {
        if (steerDirections(board, answer, clues, rng, maxNodes)) {
          unique = true;
          break;
        }
        options.trace?.(`  steering failed, redrawing the answer`);
        const next = drawSolution(board, rng, maxNodes, blackBias);
        if (!next) break;
        answer = next;
        refreshCounts(board, answer, clues);
        continue;
      }

      if (slack.ambiguous.length === 0 || clues.length >= clueCeiling) {
        options.trace?.(`  interchangeable loop with no room left to repair`);
        break;
      }
      // Blocking a cell the two routings disagree about is what removes the slack; the
      // answer has to be redrawn afterwards because that cell was on the loop. Not every
      // such cell can carry a clue — some leave the board unsolvable — so the candidates
      // are tried in turn until one survives the redraw.
      const targets = [...slack.ambiguous];
      rng.shuffle(targets);
      let planted = false;
      for (const target of targets) {
        const saved = snapshot(board, answer, clues);
        promote(board, answer, clues, target, chooseDirection(board, answer, undefined, target, rng));
        const next = drawSolution(board, rng, maxNodes, blackBias);
        if (next) {
          answer = next;
          refreshCounts(board, answer, clues);
          planted = true;
          options.trace?.(
            `  planted a clue in the ambiguous region (${clues.length} clues, ${answer.blacks.size} blacks)`
          );
          break;
        }
        restore(board, answer, clues, saved);
      }
      if (!planted) {
        options.trace?.(`  no clue placement in the ambiguous region keeps the board solvable`);
        break;
      }
    }
    if (!unique) {
      // The greedy repair is cheap and settles most 10x10 boards; when it stalls, fall
      // back to annealing the clue layout, which is what carries the larger sizes.
      const rounds = options.anneal ?? annealRoundsFor(cols, rows);
      options.trace?.(`  greedy repair stalled at ${clues.length} clues, annealing`);
      unique = annealClues(
        board,
        answer,
        clues,
        rng,
        rounds,
        maxNodes,
        blackBias,
        true,
        options.varyClueCount ?? false,
        undefined,
        options.trace
      );
    }
    if (!unique) {
      options.trace?.(`  could not reach a unique puzzle with ${clues.length} clues`);
      continue;
    }

    options.trace?.(`  unique with ${clues.length} clues, finishing`);
    const generated = finish(board, answer, rng, clues, options, attempt);
    if (generated) return generated;
    options.trace?.(`  finish rejected the puzzle`);
  }
  return undefined;
};

/** The cells a position maps to under a symmetry, deduplicated and inside the board. */
const orbitOf = (
  cols: number,
  rows: number,
  symmetry: Symmetry,
  pos: Position
): Position[] => {
  const { x, y } = pos;
  const raw: Position[] =
    symmetry === "rot2"
      ? [pos, { x: cols - 1 - x, y: rows - 1 - y }]
      : symmetry === "rot4"
        ? [
            pos,
            { x: cols - 1 - y, y: x },
            { x: cols - 1 - x, y: rows - 1 - y },
            { x: y, y: rows - 1 - x },
          ]
        : symmetry === "mirror-h"
          ? [pos, { x: cols - 1 - x, y }]
          : symmetry === "mirror-v"
            ? [pos, { x, y: rows - 1 - y }]
            : [pos];
  const cells: Position[] = [];
  for (const cell of raw) {
    if (cell.x < 0 || cell.x >= cols || cell.y < 0 || cell.y >= rows) continue;
    if (cells.some((seen) => seen.x === cell.x && seen.y === cell.y)) continue;
    cells.push(cell);
  }
  return cells;
};

export const buildPattern = (
  cols: number,
  rows: number,
  count: number,
  symmetry: Symmetry,
  rng: Rng
): boolean[] => {
  const pattern = new Array<boolean>(cols * rows).fill(false);
  const orbit = (x: number, y: number): Position[] => {
    switch (symmetry) {
      case "rot2":
        return [
          { x, y },
          { x: cols - 1 - x, y: rows - 1 - y },
        ];
      case "rot4":
        return [
          { x, y },
          { x: cols - 1 - y, y: x },
          { x: cols - 1 - x, y: rows - 1 - y },
          { x: y, y: rows - 1 - x },
        ];
      case "mirror-h":
        return [
          { x, y },
          { x: cols - 1 - x, y },
        ];
      case "mirror-v":
        return [
          { x, y },
          { x, y: rows - 1 - y },
        ];
      default:
        return [{ x, y }];
    }
  };

  let placed = 0;
  let guard = cols * rows * 20;
  while (placed < count && guard-- > 0) {
    const x = rng.nextInt(cols);
    const y = rng.nextInt(rows);
    const cells: Position[] = [];
    for (const pos of orbit(x, y)) {
      if (pos.x < 0 || pos.x >= cols || pos.y < 0 || pos.y >= rows) continue;
      if (cells.some((c) => c.x === pos.x && c.y === pos.y)) continue;
      cells.push(pos);
    }
    if (cells.some((pos) => pattern[pos.y * cols + pos.x])) continue;
    if (placed + cells.length > count) continue;
    cells.forEach((pos) => {
      pattern[pos.y * cols + pos.x] = true;
    });
    // Half the patterns drawn at 12x12 have no answer at all, and each one costs a whole
    // generation attempt, so vetoing placements that propagation already rejects looks
    // like an obvious win. It was measured and it is not: success fell from 13 of 16 to
    // 10. The veto steers the draw towards denser, more clustered layouts, which are
    // harder to make unique even though they decide more (coverage rose from 38% to 47%).
    placed += cells.length;
  }
  return pattern;
};

export const generatePattern = (
  rng: Rng,
  options: GenerateOptions
): Generated | undefined => {
  const { cols, rows } = options;
  const attemptLimit = options.attempts ?? 100;
  const maxNodes = options.maxNodes ?? 0;
  const clueTarget =
    options.clues ??
    Math.max(1, Math.round(cols * rows * (options.clueRatio ?? DEFAULT_CLUE_RATIO)));

  let draws = 0;
  for (let attempt = 1; attemptLimit === 0 || attempt <= attemptLimit; ) {
    const pattern =
      options.pattern ??
      buildPattern(cols, rows, clueTarget, options.symmetry ?? "rot2", rng);

    const board = createBoard(cols, rows);
    const clues: Clue[] = [];
    pattern.forEach((flag, index) => {
      if (!flag) return;
      const pos = { x: index % cols, y: Math.floor(index / cols) };
      clues.push({ pos, index });
      const cell = board.cell[index]!;
      cell.qdir = 1;
      cell.qnum = -2;
    });
    if (clues.length === 0) {
      attempt++;
      continue;
    }

    const answer = findInitialSolution(
      board,
      rng,
      maxNodes,
      options.blackBias ?? DEFAULT_BLACK_BIAS
    );
    if (!answer) {
      // A clue layout is an obstacle course, and a scattered enough one has no answer at
      // all — three quarters of the symmetric patterns drawn at 15x15 are dead on
      // arrival. Redrawing costs almost nothing, so it does not consume an attempt; the
      // retry budget is meant for puzzles that could not be made unique, not for layouts
      // that were never solvable. Rejecting whole draws this way keeps the distribution
      // of patterns intact, which vetoing individual placements did not.
      options.trace?.(`attempt ${attempt}: no answer for the pattern`);
      if (options.pattern === undefined && draws < PATTERN_DRAWS) {
        draws++;
        continue;
      }
      draws = 0;
      attempt++;
      continue;
    }
    draws = 0;

    for (const clue of clues) {
      board.cell[clue.index]!.qdir = chooseDirection(
        board,
        answer,
        undefined,
        clue.pos,
        rng
      );
    }
    refreshCounts(board, answer, clues);

    if (!steerDirections(board, answer, clues, rng, maxNodes)) {
      // Same fallback loop mode gets, restricted to re-aiming: the clue positions belong
      // to the pattern and must not move. Without this, pattern mode simply gave up here,
      // which is why it was the weaker of the two modes at every size.
      options.trace?.(`attempt ${attempt}: steering stalled, annealing directions`);
      const annealed = annealClues(
        board,
        answer,
        clues,
        rng,
        options.anneal ?? annealRoundsFor(cols, rows),
        maxNodes,
        options.blackBias ?? DEFAULT_BLACK_BIAS,
        false,
        false,
        options.pattern === undefined ? (options.symmetry ?? "rot2") : undefined,
        options.trace
      );
      if (!annealed) {
        // Letting this mode grow the layout — adding a whole symmetry orbit when the
        // annealing stalls, the way loop mode keeps adding clues — was tried and is out.
        // It did not rescue 15x15 and it doubled the time at 12x12 (46s to 88s).
        {
          options.trace?.(`attempt ${attempt}: could not steer to a unique puzzle`);
          attempt++;
          continue;
        }
      }
    }

    const generated = finish(
      board,
      answer,
      rng,
      clues,
      { ...options, reduce: false },
      attempt
    );
    if (generated) return generated;
    attempt++;
  }
  return undefined;
};
