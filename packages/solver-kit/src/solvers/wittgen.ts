/**
 * Wittgen Solver
 *
 * Rules:
 * 1. Place 1x3 (horizontal) or 3x1 (vertical) black rectangles in the grid
 * 2. Numbers indicate how many black cells surround that cell (up/right/down/left)
 * 3. Black rectangles cannot overlap
 * 4. White cells (non-black) must form a single connected region
 */

import {
  Position,
  CellState,
  Direction,
  posKey,
} from '../core/types.js';
import { FieldState, Grid } from '../core/field.js';
import { BaseSolver, BranchCandidate } from '../core/solver.js';

// ============================================
// Sikaku (Rectangle) helper
// ============================================

class Sikaku {
  constructor(
    public leftUp: Position,
    public rightDown: Position
  ) {}

  /** Get all positions in this rectangle */
  getPositions(): Position[] {
    const positions: Position[] = [];
    for (let row = this.leftUp.row; row <= this.rightDown.row; row++) {
      for (let col = this.leftUp.col; col <= this.rightDown.col; col++) {
        positions.push({ row, col });
      }
    }
    return positions;
  }

  /** Check if this rectangle overlaps with another */
  isDuplicate(other: Sikaku): boolean {
    // Check if rectangles don't overlap
    if (this.rightDown.col < other.leftUp.col || other.rightDown.col < this.leftUp.col) {
      return false;
    }
    if (this.rightDown.row < other.leftUp.row || other.rightDown.row < this.leftUp.row) {
      return false;
    }
    return true; // They overlap
  }

  toString(): string {
    return `[${this.leftUp.row},${this.leftUp.col}]-[${this.rightDown.row},${this.rightDown.col}]`;
  }
}

// ============================================
// Wittgen Field State
// ============================================

export class WittgenField implements FieldState<WittgenField> {
  readonly height: number;
  readonly width: number;
  /** Number clues (-1 = no clue) */
  private numbers: Grid<number | null>;
  /** Candidate rectangles (3x1 or 1x3 black cells) */
  squareCand: Sikaku[];
  /** Fixed rectangles */
  squareFixed: Sikaku[];

  constructor(height: number, width: number) {
    this.height = height;
    this.width = width;
    this.numbers = new Grid(height, width, () => null);
    this.squareCand = [];
    this.squareFixed = [];
  }

  /** Set number clue */
  setNumber(row: number, col: number, num: number | null): void {
    this.numbers.set(row, col, num);
  }

  /** Get number clue */
  getNumber(row: number, col: number): number | null {
    return this.numbers.get(row, col);
  }

  /** Initialize candidates */
  initCand(): void {
    this.squareCand = this.makeSquareCandBase();
    this.squareFixed = [];
  }

  /** Generate all valid rectangle candidates (3x1 or 1x3) */
  private makeSquareCandBase(): Sikaku[] {
    const result: Sikaku[] = [];

    for (let yIndex = 0; yIndex < this.height; yIndex++) {
      for (let xIndex = 0; xIndex < this.width; xIndex++) {
        // Horizontal 1x3 rectangle
        if (xIndex < this.width - 2) {
          const sikaku = new Sikaku(
            { row: yIndex, col: xIndex },
            { row: yIndex, col: xIndex + 2 }
          );

          // Cannot place on number cells
          if (
            this.numbers.get(yIndex, xIndex) === null &&
            this.numbers.get(yIndex, xIndex + 1) === null &&
            this.numbers.get(yIndex, xIndex + 2) === null
          ) {
            result.push(sikaku);
          }
        }

        // Vertical 3x1 rectangle
        if (yIndex < this.height - 2) {
          const sikaku = new Sikaku(
            { row: yIndex, col: xIndex },
            { row: yIndex + 2, col: xIndex }
          );

          // Cannot place on number cells
          if (
            this.numbers.get(yIndex, xIndex) === null &&
            this.numbers.get(yIndex + 1, xIndex) === null &&
            this.numbers.get(yIndex + 2, xIndex) === null
          ) {
            result.push(sikaku);
          }
        }
      }
    }

    return result;
  }

  /** Get cell states based on current rectangles */
  getMasu(): Grid<CellState> {
    const masu = new Grid(this.height, this.width, () => CellState.WHITE);

    // Mark fixed rectangles as black
    for (const fixed of this.squareFixed) {
      for (const pos of fixed.getPositions()) {
        masu.set(pos.row, pos.col, CellState.BLACK);
      }
    }

    // Mark candidate rectangles as unknown
    for (const cand of this.squareCand) {
      for (const pos of cand.getPositions()) {
        if (masu.get(pos.row, pos.col) !== CellState.BLACK) {
          masu.set(pos.row, pos.col, CellState.UNKNOWN);
        }
      }
    }

    return masu;
  }

  // ========== Constraint solving ==========

  /**
   * Remove candidates that overlap with fixed rectangles
   */
  private sikakuSolve(): boolean {
    // Check for overlap between fixed rectangles
    for (let i = 0; i < this.squareFixed.length; i++) {
      for (let j = i + 1; j < this.squareFixed.length; j++) {
        if (this.squareFixed[i].isDuplicate(this.squareFixed[j])) {
          return false;
        }
      }
    }

    // Remove candidates that overlap with fixed rectangles
    this.squareCand = this.squareCand.filter(cand => {
      for (const fixed of this.squareFixed) {
        if (cand.isDuplicate(fixed)) {
          return false;
        }
      }
      return true;
    });

    return true;
  }

  /**
   * Check number constraints
   */
  private countSolve(): boolean {
    const masu = this.getMasu();

    for (let yIndex = 0; yIndex < this.height; yIndex++) {
      for (let xIndex = 0; xIndex < this.width; xIndex++) {
        const num = this.numbers.get(yIndex, xIndex);
        if (num === null || num === -1) continue;

        let blackCnt = 0;
        let spaceCnt = 0;

        // Check all 4 neighbors
        const neighbors = [
          { row: yIndex - 1, col: xIndex }, // up
          { row: yIndex, col: xIndex + 1 }, // right
          { row: yIndex + 1, col: xIndex }, // down
          { row: yIndex, col: xIndex - 1 }, // left
        ];

        for (const neighbor of neighbors) {
          let masuState = CellState.WHITE;
          if (neighbor.row < 0 || neighbor.row >= this.height ||
              neighbor.col < 0 || neighbor.col >= this.width) {
            masuState = CellState.WHITE; // Border counts as white
          } else {
            masuState = masu.get(neighbor.row, neighbor.col);
          }

          if (masuState === CellState.BLACK) blackCnt++;
          else if (masuState === CellState.UNKNOWN) spaceCnt++;
        }

        // Too many black cells
        if (num < blackCnt) {
          return false;
        }
        // Not enough potential black cells
        if (num > blackCnt + spaceCnt) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Check if white cells are connected
   */
  private connectSolve(): boolean {
    const masu = this.getMasu();
    const whitePosSet = new Set<string>();
    let typicalWhitePos: Position | null = null;

    // Find all white cells
    for (let yIndex = 0; yIndex < this.height; yIndex++) {
      for (let xIndex = 0; xIndex < this.width; xIndex++) {
        if (masu.get(yIndex, xIndex) === CellState.WHITE) {
          const pos = { row: yIndex, col: xIndex };
          whitePosSet.add(posKey(pos));
          if (typicalWhitePos === null) {
            typicalWhitePos = pos;
          }
        }
      }
    }

    if (typicalWhitePos === null) {
      return true; // No white cells (shouldn't happen)
    }

    // BFS to find connected white cells
    const continuePosSet = new Set<string>();
    continuePosSet.add(posKey(typicalWhitePos));
    this.setContinueWhitePosSet(masu, typicalWhitePos, continuePosSet, null);

    // Check if all white cells are connected
    for (const key of whitePosSet) {
      if (!continuePosSet.has(key)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Recursively find connected white cells
   */
  private setContinueWhitePosSet(
    masu: Grid<CellState>,
    pos: Position,
    continuePosSet: Set<string>,
    from: Direction | null
  ): void {
    const { row, col } = pos;

    // Check up
    if (row !== 0 && from !== Direction.UP) {
      const nextPos: Position = { row: row - 1, col };
      const nextKey = posKey(nextPos);
      if (!continuePosSet.has(nextKey) && masu.get(nextPos.row, nextPos.col) !== CellState.BLACK) {
        continuePosSet.add(nextKey);
        this.setContinueWhitePosSet(masu, nextPos, continuePosSet, Direction.DOWN);
      }
    }

    // Check right
    if (col !== this.width - 1 && from !== Direction.RIGHT) {
      const nextPos: Position = { row, col: col + 1 };
      const nextKey = posKey(nextPos);
      if (!continuePosSet.has(nextKey) && masu.get(nextPos.row, nextPos.col) !== CellState.BLACK) {
        continuePosSet.add(nextKey);
        this.setContinueWhitePosSet(masu, nextPos, continuePosSet, Direction.LEFT);
      }
    }

    // Check down
    if (row !== this.height - 1 && from !== Direction.DOWN) {
      const nextPos: Position = { row: row + 1, col };
      const nextKey = posKey(nextPos);
      if (!continuePosSet.has(nextKey) && masu.get(nextPos.row, nextPos.col) !== CellState.BLACK) {
        continuePosSet.add(nextKey);
        this.setContinueWhitePosSet(masu, nextPos, continuePosSet, Direction.UP);
      }
    }

    // Check left
    if (col !== 0 && from !== Direction.LEFT) {
      const nextPos: Position = { row, col: col - 1 };
      const nextKey = posKey(nextPos);
      if (!continuePosSet.has(nextKey) && masu.get(nextPos.row, nextPos.col) !== CellState.BLACK) {
        continuePosSet.add(nextKey);
        this.setContinueWhitePosSet(masu, nextPos, continuePosSet, Direction.RIGHT);
      }
    }
  }

  // ========== FieldState implementation ==========

  clone(): WittgenField {
    const cloned = new WittgenField(this.height, this.width);

    // Clone numbers
    for (const [pos, num] of this.numbers.entries()) {
      cloned.numbers.set(pos, num);
    }

    // Clone candidates and fixed (shallow copy is fine)
    cloned.squareCand = [...this.squareCand];
    cloned.squareFixed = [...this.squareFixed];

    return cloned;
  }

  getStateDump(): string {
    return `${this.squareFixed.length}:${this.squareCand.length}`;
  }

  isSolved(): boolean {
    return this.squareCand.length === 0 && this.solveAndCheck();
  }

  solveAndCheck(): boolean {
    if (!this.sikakuSolve()) return false;
    if (!this.countSolve()) return false;
    if (!this.connectSolve()) return false;

    return true;
  }

  toString(): string {
    const lines: string[] = [];
    const masu = this.getMasu();

    for (let row = 0; row < this.height; row++) {
      let line = '';
      for (let col = 0; col < this.width; col++) {
        const num = this.numbers.get(row, col);
        if (num !== null && num !== -1) {
          line += num;
        } else {
          const state = masu.get(row, col);
          line += state === CellState.BLACK ? '�' :
                  state === CellState.WHITE ? '�' : '?';
        }
      }
      lines.push(line);
    }

    return lines.join('\n');
  }
}

// ============================================
// Wittgen Solver
// ============================================

export class WittgenSolver extends BaseSolver<WittgenField> {
  constructor(field: WittgenField) {
    super(field);
  }

  /**
   * Create solver from puzz.link URL format
   * Format: wittgen/width/height/param
   * Param encoding: number clues with gaps (g-z = 1-20 empty cells)
   * Each value encodes both the number (mod 5) and skip count (div 5)
   */
  static fromString(height: number, width: number, param: string): WittgenSolver {
    const field = new WittgenField(height, width);
    const ALPHABET_FROM_G = 'ghijklmnopqrstuvwxyz';

    let index = 0;
    let i = 0;

    while (i < param.length && index < height * width) {
      const ch = param[i];
      const gapIndex = ALPHABET_FROM_G.indexOf(ch);

      if (gapIndex !== -1) {
        // Gap: skip cells
        index += gapIndex + 1;
        i++;
      } else {
        // Parse value
        let value: number;
        if (ch === '.') {
          const row = Math.floor(index / width);
          const col = index % width;
          field.setNumber(row, col, -1);
          i++;
          index++;
          continue;
        } else {
          value = parseInt(ch, 16);
        }

        const num = value % 5; // Number clue (0-4)
        const skip = Math.floor(value / 5); // Additional skip

        const row = Math.floor(index / width);
        const col = index % width;
        field.setNumber(row, col, num);
        index += skip + 1;
        i++;
      }
    }

    field.initCand();
    return new WittgenSolver(field);
  }

  protected getBranchCandidates(state: WittgenField): BranchCandidate<WittgenField>[] {
    if (state.squareCand.length === 0) return [];

    // Pick the first candidate rectangle
    const cand = state.squareCand[0];

    return [
      {
        apply: (s) => {
          const cloned = s.clone();
          cloned.squareCand = cloned.squareCand.filter(c => c !== cand);
          cloned.squareFixed.push(cand);
          return cloned;
        },
        description: `Fix rectangle: ${cand.toString()}`,
      },
      {
        apply: (s) => {
          const cloned = s.clone();
          cloned.squareCand = cloned.squareCand.filter(c => c !== cand);
          return cloned;
        },
        description: `Remove rectangle: ${cand.toString()}`,
      },
    ];
  }
}
