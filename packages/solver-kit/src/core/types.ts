/**
 * Core types for solver-kit
 * Mapped from SDVX's Common.java abstractions
 */

// ============================================
// Cell State Types (Masu equivalent)
// ============================================

/**
 * Cell shading state - for puzzles with black/white cell painting
 * Maps to SDVX Masu enum
 */
export enum CellState {
  /** Unknown/undetermined */
  UNKNOWN = 'unknown',
  /** Definitely not black (white/empty) */
  WHITE = 'white',
  /** Definitely black (filled) */
  BLACK = 'black',
}

/**
 * Generic tri-state for any binary decision
 */
export enum TriState {
  UNKNOWN = 'unknown',
  FALSE = 'false',
  TRUE = 'true',
}

// ============================================
// Edge/Wall Types (Wall equivalent)
// ============================================

/**
 * Edge/wall state - for line-drawing puzzles (Slither Link, etc.)
 * Maps to SDVX Wall enum
 */
export enum EdgeState {
  /** Unknown/undetermined */
  UNKNOWN = 'unknown',
  /** Definitely no edge */
  EMPTY = 'empty',
  /** Definitely has edge */
  LINE = 'line',
}

/**
 * Wall state - for region division puzzles (Fillomino, etc.)
 * Maps to SDVX Wall enum for region boundaries
 */
export enum WallState {
  /** Unknown/undetermined */
  UNKNOWN = 'unknown',
  /** Definitely no wall (cells connected) */
  NO_WALL = 'no_wall',
  /** Definitely has wall (cells separated) */
  WALL = 'wall',
}

// ============================================
// Direction Types (Direction equivalent)
// ============================================

/**
 * Cardinal directions
 * Maps to SDVX Direction enum
 */
export enum Direction {
  UP = 'up',
  RIGHT = 'right',
  DOWN = 'down',
  LEFT = 'left',
}

/** Direction delta vectors */
export const DIRECTION_DELTA: Record<Direction, { dy: number; dx: number }> = {
  [Direction.UP]: { dy: -1, dx: 0 },
  [Direction.RIGHT]: { dy: 0, dx: 1 },
  [Direction.DOWN]: { dy: 1, dx: 0 },
  [Direction.LEFT]: { dy: 0, dx: -1 },
};

/** All four cardinal directions */
export const DIRECTIONS: Direction[] = [Direction.UP, Direction.RIGHT, Direction.DOWN, Direction.LEFT];

/**
 * Diagonal direction enum
 */
export enum DiagonalDirection {
  UP_RIGHT = 'up_right',
  DOWN_RIGHT = 'down_right',
  DOWN_LEFT = 'down_left',
  UP_LEFT = 'up_left',
}

/** Diagonal direction deltas */
export const DIAGONAL_DIRECTION_DELTA: Record<DiagonalDirection, { dy: number; dx: number }> = {
  [DiagonalDirection.UP_RIGHT]: { dy: -1, dx: 1 },
  [DiagonalDirection.DOWN_RIGHT]: { dy: 1, dx: 1 },
  [DiagonalDirection.DOWN_LEFT]: { dy: 1, dx: -1 },
  [DiagonalDirection.UP_LEFT]: { dy: -1, dx: -1 },
};

/** All four diagonal directions */
export const DIAGONAL_DIRECTIONS: DiagonalDirection[] = [
  DiagonalDirection.UP_RIGHT,
  DiagonalDirection.DOWN_RIGHT,
  DiagonalDirection.DOWN_LEFT,
  DiagonalDirection.UP_LEFT,
];

/** 8-direction delta type (cardinal + diagonal) */
export type Direction8 = Direction | DiagonalDirection;

/** All 8 directions (cardinal + diagonal) */
export const DIRECTIONS_8: Direction8[] = [
  Direction.UP,
  DiagonalDirection.UP_RIGHT,
  Direction.RIGHT,
  DiagonalDirection.DOWN_RIGHT,
  Direction.DOWN,
  DiagonalDirection.DOWN_LEFT,
  Direction.LEFT,
  DiagonalDirection.UP_LEFT,
];

/** Get opposite direction */
export function oppositeDirection(dir: Direction): Direction {
  switch (dir) {
    case Direction.UP: return Direction.DOWN;
    case Direction.DOWN: return Direction.UP;
    case Direction.LEFT: return Direction.RIGHT;
    case Direction.RIGHT: return Direction.LEFT;
  }
}

/** Get clockwise direction */
export function clockwiseDirection(dir: Direction): Direction {
  switch (dir) {
    case Direction.UP: return Direction.RIGHT;
    case Direction.RIGHT: return Direction.DOWN;
    case Direction.DOWN: return Direction.LEFT;
    case Direction.LEFT: return Direction.UP;
  }
}

// ============================================
// Position Types (Position equivalent)
// ============================================

/**
 * Grid position
 * Maps to SDVX Position class
 */
export interface Position {
  row: number;
  col: number;
}

/** Create a position */
export function pos(row: number, col: number): Position {
  return { row, col };
}

/** Check position equality */
export function posEqual(a: Position, b: Position): boolean {
  return a.row === b.row && a.col === b.col;
}

/** Get adjacent position in given direction */
export function adjacent(p: Position, dir: Direction): Position {
  const delta = DIRECTION_DELTA[dir];
  return { row: p.row + delta.dy, col: p.col + delta.dx };
}

/** Get adjacent position in any 8 direction */
export function adjacent8(p: Position, dir: Direction8): Position {
  if (dir in DIRECTION_DELTA) {
    const delta = DIRECTION_DELTA[dir as Direction];
    return { row: p.row + delta.dy, col: p.col + delta.dx };
  }
  const delta = DIAGONAL_DIRECTION_DELTA[dir as DiagonalDirection];
  return { row: p.row + delta.dy, col: p.col + delta.dx };
}

/** Get all adjacent positions */
export function adjacentPositions(p: Position): Position[] {
  return DIRECTIONS.map(dir => adjacent(p, dir));
}

/** Convert position to string key */
export function posKey(p: Position): string {
  return `${p.row},${p.col}`;
}

/** Parse position from string key */
export function parsePos(key: string): Position {
  const [row, col] = key.split(',').map(Number);
  return { row, col };
}

// ============================================
// Position Collections
// ============================================

/**
 * Set of positions with efficient lookup by coordinates
 */
export class PositionSet implements Iterable<Position> {
  private inner = new Set<string>();

  constructor(positions?: Iterable<Position>) {
    if (positions) {
      for (const pos of positions) {
        this.add(pos);
      }
    }
  }

  /** Add a position to the set */
  add(pos: Position): this {
    this.inner.add(posKey(pos));
    return this;
  }

  /** Check if the set contains a position */
  has(pos: Position): boolean {
    return this.inner.has(posKey(pos));
  }

  /** Remove a position from the set */
  delete(pos: Position): boolean {
    return this.inner.delete(posKey(pos));
  }

  /** Clear all positions */
  clear(): void {
    this.inner.clear();
  }

  /** Number of positions in the set */
  get size(): number {
    return this.inner.size;
  }

  /** Iterate over all positions */
  *[Symbol.iterator](): Iterator<Position> {
    for (const key of this.inner) {
      yield parsePos(key);
    }
  }

  /** Get all positions as an array */
  toArray(): Position[] {
    return Array.from(this);
  }

  /** Create a clone of this set */
  clone(): PositionSet {
    const cloned = new PositionSet();
    cloned.inner = new Set(this.inner);
    return cloned;
  }
}

/**
 * Map from positions to values with efficient lookup by coordinates
 */
export class PositionMap<T> implements Iterable<[Position, T]> {
  private inner = new Map<string, T>();

  constructor(entries?: Iterable<[Position, T]>) {
    if (entries) {
      for (const [pos, value] of entries) {
        this.set(pos, value);
      }
    }
  }

  /** Set a value at a position */
  set(pos: Position, value: T): this {
    this.inner.set(posKey(pos), value);
    return this;
  }

  /** Get the value at a position */
  get(pos: Position): T | undefined {
    return this.inner.get(posKey(pos));
  }

  /** Check if the map contains a position */
  has(pos: Position): boolean {
    return this.inner.has(posKey(pos));
  }

  /** Remove a position from the map */
  delete(pos: Position): boolean {
    return this.inner.delete(posKey(pos));
  }

  /** Clear all entries */
  clear(): void {
    this.inner.clear();
  }

  /** Number of entries in the map */
  get size(): number {
    return this.inner.size;
  }

  /** Iterate over all entries */
  *[Symbol.iterator](): Iterator<[Position, T]> {
    for (const [key, value] of this.inner) {
      yield [parsePos(key), value];
    }
  }

  /** Get all entries as an array */
  entries(): IterableIterator<[Position, T]> {
    return this[Symbol.iterator]() as IterableIterator<[Position, T]>;
  }

  /** Get all positions */
  *keys(): Generator<Position> {
    for (const key of this.inner.keys()) {
      yield parsePos(key);
    }
  }

  /** Get all values */
  values(): IterableIterator<T> {
    return this.inner.values();
  }

  /** Create a clone of this map */
  clone(): PositionMap<T> {
    const cloned = new PositionMap<T>();
    cloned.inner = new Map(this.inner);
    return cloned;
  }
}

// ============================================
// Rectangle Types (Sikaku equivalent)
// ============================================

/**
 * Rectangle defined by top-left and bottom-right corners
 * Maps to SDVX Sikaku class
 */
export interface Rectangle {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/** Create rectangle from corners */
export function rect(top: number, left: number, bottom: number, right: number): Rectangle {
  return { top, left, bottom, right };
}

/** Get rectangle width */
export function rectWidth(r: Rectangle): number {
  return r.right - r.left + 1;
}

/** Get rectangle height */
export function rectHeight(r: Rectangle): number {
  return r.bottom - r.top + 1;
}

/** Get rectangle area (cell count) */
export function rectArea(r: Rectangle): number {
  return rectWidth(r) * rectHeight(r);
}

/** Check if position is inside rectangle */
export function rectContains(r: Rectangle, p: Position): boolean {
  return p.row >= r.top && p.row <= r.bottom && p.col >= r.left && p.col <= r.right;
}

/** Iterate all positions in rectangle */
export function* rectPositions(r: Rectangle): Generator<Position> {
  for (let row = r.top; row <= r.bottom; row++) {
    for (let col = r.left; col <= r.right; col++) {
      yield { row, col };
    }
  }
}

// ============================================
// Difficulty Types
// ============================================

/**
 * Puzzle difficulty levels
 * Maps to SDVX Difficulty enum (Japanese puzzle difficulty scale)
 */
export enum Difficulty {
  /** Very easy - らくらく */
  EASY = 'easy',
  /** Moderate - おてごろ */
  MEDIUM = 'medium',
  /** Hard - たいへん */
  HARD = 'hard',
  /** Very hard - アゼン */
  EXPERT = 'expert',
  /** Extreme - ハバネロ */
  EXTREME = 'extreme',
}

// ============================================
// Solver Result Types
// ============================================

/**
 * Solver result status
 */
export enum SolveStatus {
  /** Found unique solution */
  SOLVED = 'solved',
  /** No solution exists */
  UNSOLVABLE = 'unsolvable',
  /** Multiple solutions exist */
  MULTIPLE = 'multiple',
  /** Solver gave up (too complex) */
  TIMEOUT = 'timeout',
  /** Error during solving */
  ERROR = 'error',
}

/**
 * Result of solving attempt
 */
export interface SolveResult<TState> {
  status: SolveStatus;
  /** Final state (solution if solved) */
  state?: TState;
  /** Estimated difficulty based on solving steps */
  difficulty?: Difficulty;
  /** Number of constraint propagation steps */
  propagationCount: number;
  /** Number of branch/guess attempts */
  branchCount: number;
  /** Error message if status is ERROR */
  error?: string;
}

// ============================================
// Generator Result Types
// ============================================

/**
 * Result of puzzle generation
 */
export interface GeneratorResult<TState> {
  /** Whether generation succeeded */
  success: boolean;
  /** Generated puzzle state */
  state?: TState;
  /** Difficulty level achieved */
  difficulty?: Difficulty;
  /** Error message if failed */
  error?: string;
}
