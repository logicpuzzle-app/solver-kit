/**
 * FieldState - Abstract base for puzzle state representation
 * Maps to SDVX's Field inner class pattern
 */

import { Position, posKey, parsePos } from './types.js';

/**
 * Result of constraint propagation
 */
export enum PropagationResult {
  /** State changed, continue propagation */
  CHANGED = 'changed',
  /** No change occurred */
  NO_CHANGE = 'no_change',
  /** Contradiction detected */
  CONTRADICTION = 'contradiction',
}

/**
 * Interface for puzzle field state
 * All puzzle solvers must implement this interface
 */
export interface FieldState<T extends FieldState<T>> {
  /** Grid dimensions */
  readonly height: number;
  readonly width: number;

  /**
   * Create a deep clone of this state
   * Used for speculative branching
   */
  clone(): T;

  /**
   * Get a string representation of current state
   * Used for progress detection (compare before/after propagation)
   */
  getStateDump(): string;

  /**
   * Check if puzzle is completely solved
   */
  isSolved(): boolean;

  /**
   * Apply constraint propagation rules
   * Returns false if contradiction is detected
   */
  solveAndCheck(): boolean;

  /**
   * Get human-readable string representation
   */
  toString(): string;
}

// ============================================
// Grid Utilities
// ============================================

/**
 * 2D Grid data structure with generic cell type
 */
export class Grid<T> {
  private readonly data: T[][];
  readonly height: number;
  readonly width: number;

  constructor(height: number, width: number, defaultValue: T | ((row: number, col: number) => T)) {
    this.height = height;
    this.width = width;
    this.data = [];
    for (let row = 0; row < height; row++) {
      this.data[row] = [];
      for (let col = 0; col < width; col++) {
        this.data[row][col] = typeof defaultValue === 'function'
          ? (defaultValue as (row: number, col: number) => T)(row, col)
          : defaultValue;
      }
    }
  }

  /** Get cell value (throws RangeError if out of bounds) */
  get(row: number, col: number): T;
  get(pos: Position): T;
  get(rowOrPos: number | Position, col?: number): T {
    let r: number, c: number;
    if (typeof rowOrPos === 'object') {
      r = rowOrPos.row;
      c = rowOrPos.col;
    } else {
      r = rowOrPos;
      c = col!;
    }
    if (r < 0 || r >= this.height || c < 0 || c >= this.width) {
      throw new RangeError(`Grid access out of bounds: (${r}, ${c}) in ${this.height}x${this.width} grid`);
    }
    return this.data[r][c];
  }

  /** Get cell value safely (returns undefined if out of bounds) */
  getSafe(row: number, col: number): T | undefined;
  getSafe(pos: Position): T | undefined;
  getSafe(rowOrPos: number | Position, col?: number): T | undefined {
    let r: number, c: number;
    if (typeof rowOrPos === 'object') {
      r = rowOrPos.row;
      c = rowOrPos.col;
    } else {
      r = rowOrPos;
      c = col!;
    }
    if (r < 0 || r >= this.height || c < 0 || c >= this.width) {
      return undefined;
    }
    return this.data[r][c];
  }

  /** Set cell value (throws RangeError if out of bounds) */
  set(row: number, col: number, value: T): void;
  set(pos: Position, value: T): void;
  set(rowOrPos: number | Position, colOrValue: number | T, value?: T): void {
    let r: number, c: number, v: T;
    if (typeof rowOrPos === 'object') {
      r = rowOrPos.row;
      c = rowOrPos.col;
      v = colOrValue as T;
    } else {
      r = rowOrPos;
      c = colOrValue as number;
      v = value!;
    }
    if (r < 0 || r >= this.height || c < 0 || c >= this.width) {
      throw new RangeError(`Grid set out of bounds: (${r}, ${c}) in ${this.height}x${this.width} grid`);
    }
    this.data[r][c] = v;
  }

  /** Check if position is within bounds */
  inBounds(row: number, col: number): boolean;
  inBounds(pos: Position): boolean;
  inBounds(rowOrPos: number | Position, col?: number): boolean {
    if (typeof rowOrPos === 'object') {
      return rowOrPos.row >= 0 && rowOrPos.row < this.height &&
             rowOrPos.col >= 0 && rowOrPos.col < this.width;
    }
    return rowOrPos >= 0 && rowOrPos < this.height &&
           col! >= 0 && col! < this.width;
  }

  /** Iterate all positions */
  *positions(): Generator<Position> {
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        yield { row, col };
      }
    }
  }

  /** Iterate all cells with positions */
  *entries(): Generator<[Position, T]> {
    for (const pos of this.positions()) {
      yield [pos, this.get(pos)];
    }
  }

  /** Find all positions matching predicate */
  findAll(predicate: (value: T, pos: Position) => boolean): Position[] {
    const result: Position[] = [];
    for (const [pos, value] of this.entries()) {
      if (predicate(value, pos)) {
        result.push(pos);
      }
    }
    return result;
  }

  /** Count cells matching predicate */
  count(predicate: (value: T, pos: Position) => boolean): number {
    let count = 0;
    for (const [pos, value] of this.entries()) {
      if (predicate(value, pos)) {
        count++;
      }
    }
    return count;
  }

  /** Create deep clone */
  clone(): Grid<T> {
    const cloned = new Grid<T>(this.height, this.width, null as unknown as T);
    this.copyTo(cloned);
    return cloned;
  }

  /** Copy data to another grid of the same dimensions */
  copyTo(target: Grid<T>): void {
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        target.data[row][col] = this.data[row][col];
      }
    }
  }

  /** Get state dump for comparison */
  dump(): string {
    return this.data.map(row => row.join(',')).join(';');
  }
}

// ============================================
// Edge Grid (for line-drawing puzzles)
// ============================================

/**
 * Edge grid for puzzles like Slither Link
 * Separate grids for horizontal and vertical edges
 */
export class EdgeGrid<T> {
  /** Horizontal edges (between vertically adjacent cells) */
  readonly horizontal: Grid<T>;
  /** Vertical edges (between horizontally adjacent cells) */
  readonly vertical: Grid<T>;

  constructor(
    height: number,
    width: number,
    defaultValue: T
  ) {
    // Horizontal edges: (height+1) rows × width columns
    this.horizontal = new Grid(height + 1, width, defaultValue);
    // Vertical edges: height rows × (width+1) columns
    this.vertical = new Grid(height, width + 1, defaultValue);
  }

  /** Get horizontal edge above cell (row, col) */
  getTop(row: number, col: number): T {
    return this.horizontal.get(row, col);
  }

  /** Get horizontal edge below cell (row, col) */
  getBottom(row: number, col: number): T {
    return this.horizontal.get(row + 1, col);
  }

  /** Get vertical edge left of cell (row, col) */
  getLeft(row: number, col: number): T {
    return this.vertical.get(row, col);
  }

  /** Get vertical edge right of cell (row, col) */
  getRight(row: number, col: number): T {
    return this.vertical.get(row, col + 1);
  }

  /** Set horizontal edge */
  setHorizontal(row: number, col: number, value: T): void {
    this.horizontal.set(row, col, value);
  }

  /** Set vertical edge */
  setVertical(row: number, col: number, value: T): void {
    this.vertical.set(row, col, value);
  }

  /** Create deep clone */
  clone(): EdgeGrid<T> {
    const cloned = new EdgeGrid<T>(
      this.horizontal.height - 1,
      this.horizontal.width,
      null as unknown as T
    );
    this.copyTo(cloned);
    return cloned;
  }

  /** Copy data to another EdgeGrid of the same dimensions */
  copyTo(target: EdgeGrid<T>): void {
    this.horizontal.copyTo(target.horizontal);
    this.vertical.copyTo(target.vertical);
  }

  /** Get state dump */
  dump(): string {
    return `H:${this.horizontal.dump()}|V:${this.vertical.dump()}`;
  }
}

// ============================================
// Candidate Set (for constraint propagation)
// ============================================

/**
 * Set of candidates for a cell
 * Used for constraint propagation with elimination
 */
export class CandidateSet<T> {
  private candidates: Set<T>;

  constructor(initialCandidates: Iterable<T>) {
    this.candidates = new Set(initialCandidates);
  }

  /** Number of remaining candidates */
  get size(): number {
    return this.candidates.size;
  }

  /** Check if value is still a candidate */
  has(value: T): boolean {
    return this.candidates.has(value);
  }

  /** Remove a candidate */
  eliminate(value: T): boolean {
    return this.candidates.delete(value);
  }

  /** Check if determined (only one candidate) */
  isDetermined(): boolean {
    return this.candidates.size === 1;
  }

  /** Get determined value (throws if not determined) */
  getValue(): T {
    if (this.candidates.size !== 1) {
      throw new Error('CandidateSet is not determined');
    }
    return this.candidates.values().next().value as T;
  }

  /** Get all remaining candidates */
  getAll(): T[] {
    return Array.from(this.candidates);
  }

  /** Check if contradiction (no candidates) */
  isContradiction(): boolean {
    return this.candidates.size === 0;
  }

  /** Create clone */
  clone(): CandidateSet<T> {
    return new CandidateSet(this.candidates);
  }

  /** Set to single value */
  setTo(value: T): void {
    this.candidates.clear();
    this.candidates.add(value);
  }
}

// ============================================
// Room/Region tracking
// ============================================

/**
 * Union-Find data structure for tracking connected regions
 */
export class UnionFind {
  private parent: Map<string, string>;
  private rank: Map<string, number>;
  private _size: Map<string, number>;

  constructor() {
    this.parent = new Map();
    this.rank = new Map();
    this._size = new Map();
  }

  /** Make a new set with single element */
  makeSet(pos: Position): void {
    const key = posKey(pos);
    if (!this.parent.has(key)) {
      this.parent.set(key, key);
      this.rank.set(key, 0);
      this._size.set(key, 1);
    }
  }

  /** Find root with path compression */
  find(pos: Position): string {
    const key = posKey(pos);
    if (!this.parent.has(key)) {
      this.makeSet(pos);
    }
    if (this.parent.get(key) !== key) {
      this.parent.set(key, this.find(parsePos(this.parent.get(key)!)));
    }
    return this.parent.get(key)!;
  }

  /** Union two sets */
  union(a: Position, b: Position): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) return;

    const rankA = this.rank.get(rootA)!;
    const rankB = this.rank.get(rootB)!;
    const sizeA = this._size.get(rootA)!;
    const sizeB = this._size.get(rootB)!;

    if (rankA < rankB) {
      this.parent.set(rootA, rootB);
      this._size.set(rootB, sizeA + sizeB);
    } else if (rankA > rankB) {
      this.parent.set(rootB, rootA);
      this._size.set(rootA, sizeA + sizeB);
    } else {
      this.parent.set(rootB, rootA);
      this.rank.set(rootA, rankA + 1);
      this._size.set(rootA, sizeA + sizeB);
    }
  }

  /** Check if two positions are in the same set */
  connected(a: Position, b: Position): boolean {
    return this.find(a) === this.find(b);
  }

  /** Get size of set containing position */
  size(pos: Position): number {
    const root = this.find(pos);
    return this._size.get(root)!;
  }
}
