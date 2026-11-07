/*
 * Yajilin Kit — constraint engine.
 *
 * A second, purpose-built solver that exists for the generator rather than for the
 * player. The ported technique solver models how a human reasons and is what difficulty
 * is measured with, but it is not a decision procedure: it can stop short, and it is far
 * too slow to sit inside a generate-and-test loop. This engine instead keeps the whole
 * state in flat typed arrays and propagates only sound, cheap rules to a fixpoint:
 *
 *   - a black cell blanks its four edges and forces its neighbours onto the loop;
 *   - a loop cell has exactly two line edges — reaching two blanks the rest, and having
 *     only two candidates left promotes them to lines;
 *   - a cell with fewer than two usable edges must be black;
 *   - each arrow bounds the black count along its ray from both sides, using the
 *     ceil(run/2) packing limit, and forces the cells when a bound is tight;
 *   - closing the loop freezes everything else: the remaining unknown cells must be
 *     black, and every loop cell must already be part of the closed component.
 *
 * Search does not copy this state. Every write is logged to a trail, so a branch is
 * entered with `mark()` and undone with `undo()` — profiling the copying version put 23%
 * of generation time in the garbage collector, all of it from cloning six typed arrays
 * per node. For the same reason the union-find deliberately skips path compression:
 * lookups get slightly slower, but every parent write stays on the trail and undoable.
 *
 * Everything here is index-based, so unlike the technique solver there is no dependence
 * on hash iteration order and the Rust and Python ports are direct transcriptions.
 */

import { toId, type Board } from "./board.js";
import { dirs } from "./position.js";
import { createSolution, type Solution } from "./solution.js";

export const CellState = {
  Unknown: 0,
  Black: 1,
  Line: 2,
  Blocked: 3,
} as const;
export type CellState = (typeof CellState)[keyof typeof CellState];

export const EdgeState = {
  Unknown: 0,
  Line: 1,
  Blank: 2,
} as const;
export type EdgeState = (typeof EdgeState)[keyof typeof EdgeState];

const TRAIL_CELL = 0;
const TRAIL_EDGE = 1;
const TRAIL_LINE_COUNT = 2;
const TRAIL_BLANK_COUNT = 3;
const TRAIL_PARENT = 4;
const TRAIL_SIZE = 5;

export type Clue = {
  cell: number;
  dir: number;
  count: number;
  /** Cell indices from the clue to the board edge, precomputed once. */
  ray: Int32Array;
};

export type Engine = {
  cols: number;
  rows: number;
  cellCount: number;
  edgeCount: number;
  /** Horizontal edges occupy [0, hCount), vertical edges follow. */
  hCount: number;
  cell: Int8Array;
  edge: Int8Array;
  lineCount: Int8Array;
  blankCount: Int8Array;
  /** Four incident edge ids per cell, -1 outside the board. Order: up, down, left, right. */
  incident: Int32Array;
  /** Two cell ids per edge. */
  edgeCells: Int32Array;
  /** Four neighbour cell ids per cell, -1 outside the board. Order: up, down, left, right. */
  neighbours: Int32Array;
  parent: Int32Array;
  size: Int32Array;
  unknownCells: number;
  lineCells: number;
  contradiction: boolean;
  loopClosed: boolean;
  loopRoot: number;
  changed: boolean;
  clues: Clue[];
  /** Undo log: triples of (kind, index, previous value). */
  trail: number[];
  /** Scratch buffer reused by the arrow rule to avoid allocating per pass. */
  forced: number[];
  /**
   * Work lists. Propagation only revisits what a write actually touched; scanning every
   * cell and every arrow on each pass was 69% of generation time in the profile.
   */
  cellQueue: number[];
  inCellQueue: Uint8Array;
  clueQueue: number[];
  inClueQueue: Uint8Array;
  /** Flattened cell -> clue index: clues covering cell i live in [start[i], start[i+1]). */
  clueOfCellStart: Int32Array;
  clueOfCellData: Int32Array;
  /**
   * Edge ids grouped by the grid line they cross: `cuts[k]` holds the vertical edges
   * spanning one horizontal cut, or the horizontal edges spanning one vertical cut.
   */
  cuts: Int32Array[];
  /** Scratch state for the connectivity check; stamped per call instead of cleared. */
  visitStamp: Int32Array;
  visitGeneration: number;
  dfsStack: number[];
  /**
   * Whether the parity rule runs. Search always wants it on; the generator's objective
   * can ask for it off — see `analysePropagation`.
   */
  useParity: boolean;
};

export type Mark = {
  trail: number;
  unknownCells: number;
  lineCells: number;
  contradiction: boolean;
  loopClosed: boolean;
  loopRoot: number;
};

const hIndex = (cols: number, x: number, y: number): number => y * (cols - 1) + x;
const vIndex = (cols: number, hCount: number, x: number, y: number): number =>
  hCount + y * cols + x;

export const createEngine = (board: Board, useParity = true): Engine => {
  const { cols, rows } = board;
  const cellCount = cols * rows;
  const hCount = rows * Math.max(cols - 1, 0);
  const vCount = Math.max(rows - 1, 0) * cols;
  const edgeCount = hCount + vCount;

  const engine: Engine = {
    cols,
    rows,
    cellCount,
    edgeCount,
    hCount,
    cell: new Int8Array(cellCount),
    edge: new Int8Array(edgeCount),
    lineCount: new Int8Array(cellCount),
    blankCount: new Int8Array(cellCount),
    incident: new Int32Array(cellCount * 4),
    edgeCells: new Int32Array(edgeCount * 2),
    neighbours: new Int32Array(cellCount * 4),
    parent: new Int32Array(cellCount),
    size: new Int32Array(cellCount),
    unknownCells: cellCount,
    lineCells: 0,
    contradiction: false,
    loopClosed: false,
    loopRoot: -1,
    changed: false,
    clues: [],
    trail: [],
    forced: [],
    cellQueue: [],
    inCellQueue: new Uint8Array(cellCount),
    clueQueue: [],
    inClueQueue: new Uint8Array(0),
    clueOfCellStart: new Int32Array(cellCount + 1),
    clueOfCellData: new Int32Array(0),
    cuts: [],
    visitStamp: new Int32Array(cellCount),
    visitGeneration: 0,
    dfsStack: [],
    useParity,
  };

  for (let i = 0; i < cellCount; i++) {
    engine.parent[i] = i;
    engine.size[i] = 1;
    const x = i % cols;
    const y = Math.floor(i / cols);
    const up = y > 0 ? vIndex(cols, hCount, x, y - 1) : -1;
    const down = y < rows - 1 ? vIndex(cols, hCount, x, y) : -1;
    const left = x > 0 ? hIndex(cols, x - 1, y) : -1;
    const right = x < cols - 1 ? hIndex(cols, x, y) : -1;
    engine.incident[i * 4] = up;
    engine.incident[i * 4 + 1] = down;
    engine.incident[i * 4 + 2] = left;
    engine.incident[i * 4 + 3] = right;
    engine.neighbours[i * 4] = y > 0 ? i - cols : -1;
    engine.neighbours[i * 4 + 1] = y < rows - 1 ? i + cols : -1;
    engine.neighbours[i * 4 + 2] = x > 0 ? i - 1 : -1;
    engine.neighbours[i * 4 + 3] = x < cols - 1 ? i + 1 : -1;
    // Edges that fall off the board count as blank from the start.
    let outside = 0;
    if (up < 0) outside++;
    if (down < 0) outside++;
    if (left < 0) outside++;
    if (right < 0) outside++;
    engine.blankCount[i] = outside;
  }

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols - 1; x++) {
      const e = hIndex(cols, x, y);
      engine.edgeCells[e * 2] = y * cols + x;
      engine.edgeCells[e * 2 + 1] = y * cols + x + 1;
    }
  }
  for (let y = 0; y < rows - 1; y++) {
    for (let x = 0; x < cols; x++) {
      const e = vIndex(cols, hCount, x, y);
      engine.edgeCells[e * 2] = y * cols + x;
      engine.edgeCells[e * 2 + 1] = (y + 1) * cols + x;
    }
  }

  for (let i = 0; i < cellCount; i++) {
    const cell = board.cell[i]!;
    if (cell.qnum !== -1) {
      setCell(engine, i, CellState.Blocked);
    }
    if (cell.qdir >= 1 && cell.qdir <= 4 && cell.qnum >= 0) {
      const delta = dirs[cell.qdir]!;
      const ray: number[] = [];
      let x = (i % cols) + delta.x;
      let y = Math.floor(i / cols) + delta.y;
      while (x >= 0 && x < cols && y >= 0 && y < rows) {
        ray.push(y * cols + x);
        x += delta.x;
        y += delta.y;
      }
      engine.clues.push({
        cell: i,
        dir: cell.qdir,
        count: cell.qnum,
        ray: Int32Array.from(ray),
      });
    }
  }

  // Grid lines, for the parity rule. A horizontal cut between rows y and y+1 is crossed
  // by the vertical edges of row y; a vertical cut between columns x and x+1 by the
  // horizontal edges of column x.
  for (let y = 0; y < rows - 1; y++) {
    const cut = new Int32Array(cols);
    for (let x = 0; x < cols; x++) {
      cut[x] = vIndex(cols, hCount, x, y);
    }
    engine.cuts.push(cut);
  }
  for (let x = 0; x < cols - 1; x++) {
    const cut = new Int32Array(rows);
    for (let y = 0; y < rows; y++) {
      cut[y] = hIndex(cols, x, y);
    }
    engine.cuts.push(cut);
  }

  engine.inClueQueue = new Uint8Array(engine.clues.length);
  const counts = new Int32Array(cellCount);
  for (const clue of engine.clues) {
    for (let k = 0; k < clue.ray.length; k++) counts[clue.ray[k]!]!++;
  }
  let running = 0;
  for (let i = 0; i < cellCount; i++) {
    engine.clueOfCellStart[i] = running;
    running += counts[i]!;
  }
  engine.clueOfCellStart[cellCount] = running;
  engine.clueOfCellData = new Int32Array(running);
  const cursor = engine.clueOfCellStart.slice(0, cellCount);
  engine.clues.forEach((clue, index) => {
    for (let k = 0; k < clue.ray.length; k++) {
      const cell = clue.ray[k]!;
      engine.clueOfCellData[cursor[cell]!++] = index;
    }
  });

  // The board setup itself is not undoable; searches start from here.
  engine.trail.length = 0;
  for (let i = 0; i < cellCount; i++) enqueueCell(engine, i);
  for (let c = 0; c < engine.clues.length; c++) enqueueClue(engine, c);
  return engine;
};

const enqueueCell = (engine: Engine, i: number): void => {
  if (i < 0 || engine.inCellQueue[i] === 1) return;
  engine.inCellQueue[i] = 1;
  engine.cellQueue.push(i);
};

const enqueueClue = (engine: Engine, c: number): void => {
  if (engine.inClueQueue[c] === 1) return;
  engine.inClueQueue[c] = 1;
  engine.clueQueue.push(c);
};

/** Re-examines every arrow whose ray passes through this cell. */
const enqueueCluesOf = (engine: Engine, i: number): void => {
  const start = engine.clueOfCellStart[i]!;
  const end = engine.clueOfCellStart[i + 1]!;
  for (let k = start; k < end; k++) {
    enqueueClue(engine, engine.clueOfCellData[k]!);
  }
};

export const mark = (engine: Engine): Mark => ({
  trail: engine.trail.length,
  unknownCells: engine.unknownCells,
  lineCells: engine.lineCells,
  contradiction: engine.contradiction,
  loopClosed: engine.loopClosed,
  loopRoot: engine.loopRoot,
});

/** Re-points an existing mark at the current state, so search can reuse one per depth. */
export const remark = (engine: Engine, saved: Mark): void => {
  saved.trail = engine.trail.length;
  saved.unknownCells = engine.unknownCells;
  saved.lineCells = engine.lineCells;
  saved.contradiction = engine.contradiction;
  saved.loopClosed = engine.loopClosed;
  saved.loopRoot = engine.loopRoot;
};

export const undo = (engine: Engine, saved: Mark): void => {
  const trail = engine.trail;
  for (let i = trail.length - 3; i >= saved.trail; i -= 3) {
    const kind = trail[i]!;
    const index = trail[i + 1]!;
    const value = trail[i + 2]!;
    switch (kind) {
      case TRAIL_CELL:
        engine.cell[index] = value;
        break;
      case TRAIL_EDGE:
        engine.edge[index] = value;
        break;
      case TRAIL_LINE_COUNT:
        engine.lineCount[index] = value;
        break;
      case TRAIL_BLANK_COUNT:
        engine.blankCount[index] = value;
        break;
      case TRAIL_PARENT:
        engine.parent[index] = value;
        break;
      default:
        engine.size[index] = value;
        break;
    }
  }
  trail.length = saved.trail;
  engine.unknownCells = saved.unknownCells;
  engine.lineCells = saved.lineCells;
  engine.contradiction = saved.contradiction;
  engine.loopClosed = saved.loopClosed;
  engine.loopRoot = saved.loopRoot;
};

const find = (engine: Engine, a: number): number => {
  let root = a;
  while (engine.parent[root] !== root) {
    root = engine.parent[root]!;
  }
  return root;
};

const unite = (engine: Engine, a: number, b: number): void => {
  const ra = find(engine, a);
  const rb = find(engine, b);
  if (ra === rb) {
    engine.loopClosed = true;
    engine.loopRoot = ra;
    return;
  }
  const [large, small] = engine.size[ra]! < engine.size[rb]! ? [rb, ra] : [ra, rb];
  engine.trail.push(TRAIL_PARENT, small, engine.parent[small]!);
  engine.trail.push(TRAIL_SIZE, large, engine.size[large]!);
  engine.parent[small] = large;
  engine.size[large] = engine.size[large]! + engine.size[small]!;
};

export const setEdge = (engine: Engine, e: number, value: EdgeState): void => {
  if (engine.contradiction || e < 0) return;
  const current = engine.edge[e]!;
  if (current === value) return;
  if (current !== EdgeState.Unknown) {
    engine.contradiction = true;
    return;
  }
  engine.trail.push(TRAIL_EDGE, e, current);
  engine.edge[e] = value;
  engine.changed = true;
  const a = engine.edgeCells[e * 2]!;
  const b = engine.edgeCells[e * 2 + 1]!;
  enqueueCell(engine, a);
  enqueueCell(engine, b);
  if (value === EdgeState.Line) {
    engine.trail.push(TRAIL_LINE_COUNT, a, engine.lineCount[a]!);
    engine.trail.push(TRAIL_LINE_COUNT, b, engine.lineCount[b]!);
    engine.lineCount[a]!++;
    engine.lineCount[b]!++;
    setCell(engine, a, CellState.Line);
    setCell(engine, b, CellState.Line);
    if (engine.contradiction) return;
    unite(engine, a, b);
  } else {
    engine.trail.push(TRAIL_BLANK_COUNT, a, engine.blankCount[a]!);
    engine.trail.push(TRAIL_BLANK_COUNT, b, engine.blankCount[b]!);
    engine.blankCount[a]!++;
    engine.blankCount[b]!++;
  }
};

export const setCell = (engine: Engine, i: number, value: CellState): void => {
  if (engine.contradiction || i < 0) return;
  const current = engine.cell[i]!;
  if (current === value) return;
  if (current !== CellState.Unknown) {
    engine.contradiction = true;
    return;
  }
  engine.trail.push(TRAIL_CELL, i, current);
  engine.cell[i] = value;
  engine.unknownCells--;
  engine.changed = true;
  enqueueCell(engine, i);
  enqueueCluesOf(engine, i);

  if (value === CellState.Black || value === CellState.Blocked) {
    for (let d = 0; d < 4; d++) {
      setEdge(engine, engine.incident[i * 4 + d]!, EdgeState.Blank);
    }
  }
  if (value === CellState.Black) {
    for (let d = 0; d < 4; d++) {
      const j = engine.neighbours[i * 4 + d]!;
      if (j < 0) continue;
      const state = engine.cell[j]!;
      if (state === CellState.Black) {
        engine.contradiction = true;
        return;
      }
      if (state === CellState.Unknown) {
        setCell(engine, j, CellState.Line);
        if (engine.contradiction) return;
      }
    }
  } else if (value === CellState.Line) {
    engine.lineCells++;
  }
};

const propagateCell = (engine: Engine, i: number): void => {
  const state = engine.cell[i]!;
  if (state === CellState.Black || state === CellState.Blocked) {
    return;
  }
  const available = 4 - engine.blankCount[i]!;
  const lines = engine.lineCount[i]!;
  if (state === CellState.Line) {
    if (lines > 2 || available < 2) {
      engine.contradiction = true;
      return;
    }
    if (lines === 2) {
      for (let d = 0; d < 4; d++) {
        const e = engine.incident[i * 4 + d]!;
        if (e >= 0 && engine.edge[e] === EdgeState.Unknown) {
          setEdge(engine, e, EdgeState.Blank);
        }
      }
    } else if (available === 2) {
      for (let d = 0; d < 4; d++) {
        const e = engine.incident[i * 4 + d]!;
        if (e >= 0 && engine.edge[e] === EdgeState.Unknown) {
          setEdge(engine, e, EdgeState.Line);
        }
      }
    }
  } else if (lines > 0) {
    setCell(engine, i, CellState.Line);
  } else if (available < 2) {
    setCell(engine, i, CellState.Black);
  }
};

const propagateClue = (engine: Engine, clueIndex: number): void => {
  const clue = engine.clues[clueIndex]!;
  const ray = clue.ray;
  let known = 0;
  let capacity = 0;
  let run = 0;
  for (let k = 0; k < ray.length; k++) {
    const state = engine.cell[ray[k]!]!;
    if (state === CellState.Black) {
      known++;
      capacity += (run + 1) >> 1;
      run = 0;
    } else if (state === CellState.Unknown) {
      run++;
    } else {
      capacity += (run + 1) >> 1;
      run = 0;
    }
  }
  capacity += (run + 1) >> 1;

  if (known > clue.count || known + capacity < clue.count) {
    engine.contradiction = true;
    return;
  }
  if (known === clue.count) {
    for (let k = 0; k < ray.length; k++) {
      if (engine.cell[ray[k]!] === CellState.Unknown) {
        setCell(engine, ray[k]!, CellState.Line);
        if (engine.contradiction) return;
      }
    }
    return;
  }
  if (known + capacity === clue.count) {
    // Every run is packed as tightly as possible, so odd runs are fully determined: split
    // a run into consecutive pairs and each pair, being adjacent cells, holds at most one
    // black, so reaching the maximum means every pair holds exactly one.
    //
    // The even-run half of that argument needs no code. A run only ever contains undecided
    // cells, so the moment one of them is settled the run splits and the capacities are
    // recomputed — a length-4 run losing its second cell becomes a length-1 run plus a
    // length-2 run, and the length-1 run is odd and forces its cell. Adding an explicit
    // pairing rule was tried and was dead code for exactly this reason.
    //
    // Run boundaries are collected before anything is written: placing a black cell
    // immediately promotes its neighbours to Line and would truncate the scan.
    const forced = engine.forced;
    forced.length = 0;
    let start = -1;
    for (let k = 0; k <= ray.length; k++) {
      const inRun = k < ray.length && engine.cell[ray[k]!] === CellState.Unknown;
      if (inRun && start < 0) {
        start = k;
      } else if (!inRun && start >= 0) {
        const length = k - start;
        if (length % 2 === 1) {
          for (let offset = 0; offset < length; offset += 2) {
            forced.push(ray[start + offset]!);
          }
        }
        start = -1;
      }
    }
    for (let k = 0; k < forced.length; k++) {
      setCell(engine, forced[k]!, CellState.Black);
      if (engine.contradiction) return;
    }
  }
};

const settleClosedLoop = (engine: Engine): void => {
  if (!engine.loopClosed || engine.contradiction) return;
  for (let i = 0; i < engine.cellCount; i++) {
    if (engine.cell[i] === CellState.Unknown) {
      setCell(engine, i, CellState.Black);
      if (engine.contradiction) return;
    }
  }
  const root = find(engine, engine.loopRoot);
  if (engine.size[root]! !== engine.lineCells) {
    engine.contradiction = true;
  }
};

/**
 * The finished loop is one connected component, so every cell already committed to the
 * loop has to stay mutually reachable through cells that can still carry it. Two line
 * fragments walled off from each other by black and blocked cells can never be joined,
 * and noticing that here prunes the search far earlier than waiting for a loop to close —
 * without it the search has almost nothing to go on until the very end, and boards past
 * about 12x12 become unsearchable.
 *
 * Returns false on contradiction. Traversal crosses any edge that is not blank, into any
 * cell that is Line or still Unknown.
 */
const checkConnectivity = (engine: Engine): boolean => {
  if (engine.lineCells === 0) return true;
  let start = -1;
  for (let i = 0; i < engine.cellCount; i++) {
    if (engine.cell[i] === CellState.Line) {
      start = i;
      break;
    }
  }
  if (start < 0) return true;

  engine.visitGeneration++;
  const stamp = engine.visitGeneration;
  const stack = engine.dfsStack;
  stack.length = 0;
  stack.push(start);
  engine.visitStamp[start] = stamp;
  let reachedLineCells = 1;

  while (stack.length > 0) {
    const i = stack.pop()!;
    for (let d = 0; d < 4; d++) {
      const e = engine.incident[i * 4 + d]!;
      if (e < 0 || engine.edge[e] === EdgeState.Blank) continue;
      const j = engine.neighbours[i * 4 + d]!;
      if (j < 0 || engine.visitStamp[j] === stamp) continue;
      const state = engine.cell[j]!;
      if (state !== CellState.Line && state !== CellState.Unknown) continue;
      engine.visitStamp[j] = stamp;
      if (state === CellState.Line) reachedLineCells++;
      stack.push(j);
    }
  }

  return reachedLineCells === engine.lineCells;
};

/**
 * The parity rule: a closed loop crosses any grid line an even number of times.
 *
 * For each cut, count the edges already committed to the line. If none are left open the
 * count must be even, and if exactly one is open its state is decided outright. It is a
 * cheap O(cells) sweep and it is what a solver of this puzzle notices first, which is why
 * the engine without it left roughly half of a finished board undecided.
 */
const propagateParity = (engine: Engine): void => {
  if (!engine.useParity) return;
  const edges = engine.edge;
  for (const cut of engine.cuts) {
    let lines = 0;
    let unknown = -1;
    let unknownCount = 0;
    for (let k = 0; k < cut.length; k++) {
      const state = edges[cut[k]!]!;
      if (state === EdgeState.Line) {
        lines++;
      } else if (state === EdgeState.Unknown) {
        unknown = cut[k]!;
        unknownCount++;
        if (unknownCount > 1) break;
      }
    }
    if (unknownCount === 0) {
      if (lines % 2 === 1) {
        engine.contradiction = true;
        return;
      }
    } else if (unknownCount === 1) {
      setEdge(engine, unknown, lines % 2 === 1 ? EdgeState.Line : EdgeState.Blank);
      if (engine.contradiction) return;
    }
  }
};

/**
 * Small-loop ban: an edge whose two ends already belong to the same line fragment would
 * close that fragment into a loop, which is only ever allowed for the final loop. As long
 * as line cells exist outside the fragment, the edge cannot be drawn.
 *
 * The engine could already detect a premature closure, but only after the edge had been
 * committed; refusing it up front prunes the branch before the search enters it. Worth
 * between 1.1x and 2.5x on generation depending on the board.
 */
const propagateSmallLoopBan = (engine: Engine): void => {
  for (let e = 0; e < engine.edgeCount; e++) {
    if (engine.edge[e] !== EdgeState.Unknown) continue;
    const a = engine.edgeCells[e * 2]!;
    const b = engine.edgeCells[e * 2 + 1]!;
    if (engine.cell[a] !== CellState.Line || engine.cell[b] !== CellState.Line) continue;
    const root = find(engine, a);
    if (root !== find(engine, b)) continue;
    if (engine.size[root]! === engine.lineCells) continue;
    setEdge(engine, e, EdgeState.Blank);
    if (engine.contradiction) return;
  }
};

const drainQueues = (engine: Engine): void => {
  engine.cellQueue.length = 0;
  engine.inCellQueue.fill(0);
  engine.clueQueue.length = 0;
  engine.inClueQueue.fill(0);
};

/**
 * Propagates to a fixpoint. Returns false on contradiction.
 *
 * Work is driven by the queues rather than by rescanning the board: a write enqueues the
 * cells and arrows it can affect, and the loop runs until nothing is left. On
 * contradiction the queues are dropped, because the caller is about to undo back to a
 * state that was already a fixpoint.
 */
export const propagateEngine = (engine: Engine): boolean => {
  for (;;) {
    while (engine.cellQueue.length > 0 || engine.clueQueue.length > 0) {
      while (engine.cellQueue.length > 0) {
        const i = engine.cellQueue.pop()!;
        engine.inCellQueue[i] = 0;
        propagateCell(engine, i);
        if (engine.contradiction) {
          drainQueues(engine);
          return false;
        }
      }
      while (engine.clueQueue.length > 0) {
        const c = engine.clueQueue.pop()!;
        engine.inClueQueue[c] = 0;
        propagateClue(engine, c);
        if (engine.contradiction) {
          drainQueues(engine);
          return false;
        }
        if (engine.cellQueue.length > 0) break;
      }
    }
    const beforeRules = engine.trail.length;
    // Rectangle parity — the even-crossings argument applied to every rectangle anchored
    // at the top-left corner — was tried here as well and is out. It is sound and raises
    // coverage, but it made 12x12 generation slower (182s against 149s for the same 16 of
    // 16), so it is paying for deductions the generator does not need.
    propagateParity(engine);
    if (engine.contradiction) {
      drainQueues(engine);
      return false;
    }
    propagateSmallLoopBan(engine);
    if (engine.contradiction) {
      drainQueues(engine);
      return false;
    }
    if (engine.trail.length !== beforeRules || engine.cellQueue.length > 0) {
      continue;
    }

    if (!engine.loopClosed) {
      if (!checkConnectivity(engine)) {
        engine.contradiction = true;
        drainQueues(engine);
        return false;
      }
      return true;
    }
    const before = engine.unknownCells;
    settleClosedLoop(engine);
    if (engine.contradiction) {
      drainQueues(engine);
      return false;
    }
    if (before === engine.unknownCells && engine.cellQueue.length === 0) {
      if (!checkConnectivity(engine)) {
        engine.contradiction = true;
        drainQueues(engine);
        return false;
      }
      return true;
    }
  }
};

export const isDecided = (engine: Engine): boolean => engine.unknownCells === 0;

/** True when the state is a finished, rule-satisfying answer. */
export const isSolved = (engine: Engine): boolean => {
  if (engine.contradiction || engine.unknownCells > 0) return false;
  if (engine.lineCells === 0) return false;
  for (let i = 0; i < engine.cellCount; i++) {
    if (engine.cell[i] === CellState.Line && engine.lineCount[i] !== 2) {
      return false;
    }
  }
  let root = -1;
  for (let i = 0; i < engine.cellCount; i++) {
    if (engine.cell[i] === CellState.Line) {
      root = find(engine, i);
      break;
    }
  }
  if (root < 0 || engine.size[root] !== engine.lineCells) return false;
  for (const clue of engine.clues) {
    let count = 0;
    for (let k = 0; k < clue.ray.length; k++) {
      if (engine.cell[clue.ray[k]!] === CellState.Black) count++;
    }
    if (count !== clue.count) return false;
  }
  return true;
};

export const toSolution = (engine: Engine): Solution => {
  const solution = createSolution();
  for (let i = 0; i < engine.cellCount; i++) {
    if (engine.cell[i] === CellState.Black) {
      solution.blacks.add(toId({ x: i % engine.cols, y: Math.floor(i / engine.cols) }));
    }
  }
  for (let e = 0; e < engine.edgeCount; e++) {
    if (engine.edge[e] !== EdgeState.Line) continue;
    const a = engine.edgeCells[e * 2]!;
    const pos = { x: a % engine.cols, y: Math.floor(a / engine.cols) };
    if (e < engine.hCount) {
      solution.horizontal.add(toId(pos));
    } else {
      solution.vertical.add(toId(pos));
    }
  }
  return solution;
};
