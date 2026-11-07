/**
 * Archipelago Solver
 *
 * Rules:
 * 1. Paint some cells black to form islands
 * 2. Each number indicates the size of its island (orthogonally connected black cells)
 * 3. Islands connect diagonally to form archipelagos
 * 4. Each archipelago must contain islands of consecutive sizes starting from 1 (1, 2, 3, ..., N)
 * 5. No two islands in the same archipelago can have the same size
 */

import {
  CellState,
  Position,
  Direction,
  DIRECTIONS,
  adjacent,
  posKey,
  parsePos,
} from '../core/types.js';
import { FieldState, Grid } from '../core/field.js';
import { BaseSolver, BranchCandidate } from '../core/solver.js';

// ============================================
// Archipelago Field State
// ============================================

export class ArchipelagoField implements FieldState<ArchipelagoField> {
  readonly height: number;
  readonly width: number;
  /** Cell states (UNKNOWN/WHITE/BLACK) */
  private cells: Grid<CellState>;
  /** Numbers in each cell (null = no number) */
  private numbers: Grid<number | null>;
  /** Set of fixed island positions (for optimization) */
  private fixedIslands: Set<Set<string>>;

  constructor(height: number, width: number) {
    this.height = height;
    this.width = width;
    this.cells = new Grid(height, width, () => CellState.UNKNOWN);
    this.numbers = new Grid(height, width, () => null);
    this.fixedIslands = new Set();
  }

  /** Set a number clue (also marks as black) */
  setNumber(row: number, col: number, num: number): void {
    this.numbers.set(row, col, num);
    this.cells.set(row, col, CellState.BLACK);
  }

  /** Get number at position */
  getNumber(row: number, col: number): number | null {
    return this.numbers.get(row, col);
  }

  /** Get cell state */
  getCell(row: number, col: number): CellState {
    return this.cells.get(row, col);
  }

  /** Set cell to black */
  setBlack(row: number, col: number): void {
    this.cells.set(row, col, CellState.BLACK);
  }

  /** Set cell to white */
  setWhite(row: number, col: number): void {
    this.cells.set(row, col, CellState.WHITE);
  }

  // ========== Helper methods ==========

  /**
   * Get all orthogonally connected cells of the same color from a position
   */
  private getContinuePosSet(
    pos: Position,
    maxSize: number = Number.MAX_SAFE_INTEGER,
    from: Direction | null = null
  ): { positions: Set<string>; valid: boolean } {
    const positions = new Set<string>();
    positions.add(posKey(pos));

    const valid = this.setContinuePosSet(pos, positions, maxSize, from);
    return { positions, valid };
  }

  /**
   * Recursively add connected black cells to the set
   * Returns false if size exceeded or different numbered island encountered
   */
  private setContinuePosSet(
    pos: Position,
    continuePosSet: Set<string>,
    maxSize: number,
    from: Direction | null
  ): boolean {
    if (continuePosSet.size > maxSize) {
      return false;
    }

    const targetNum = this.numbers.get(pos.row, pos.col);

    for (const dir of DIRECTIONS) {
      if (from === dir) continue;

      const next = adjacent(pos, dir);
      if (!this.cells.inBounds(next)) continue;

      const nextKey = posKey(next);
      if (continuePosSet.has(nextKey)) continue;

      if (this.cells.get(next) !== CellState.BLACK) continue;

      const nextNum = this.numbers.get(next.row, next.col);
      if (nextNum !== null && nextNum !== targetNum) {
        return false; // Different numbered island
      }

      continuePosSet.add(nextKey);
      const opposite = this.getOppositeDirection(dir);
      if (!this.setContinuePosSet(next, continuePosSet, maxSize, opposite)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get all potentially connected cells (black or unknown) from a position
   */
  private getContinueCandPosSet(
    pos: Position,
    size: number,
    from: Direction | null = null
  ): { positions: Set<string>; canReachSize: boolean } {
    const positions = new Set<string>();
    positions.add(posKey(pos));

    const canReachSize = this.setContinueCandPosSet(pos, positions, size, from);
    return { positions, canReachSize };
  }

  /**
   * Recursively add potentially connected cells
   * Returns true if we can potentially reach the required size
   */
  private setContinueCandPosSet(
    pos: Position,
    continuePosSet: Set<string>,
    size: number,
    from: Direction | null
  ): boolean {
    if (continuePosSet.size > size) {
      return true; // Already reached size
    }

    for (const dir of DIRECTIONS) {
      if (from === dir) continue;

      const next = adjacent(pos, dir);
      if (!this.cells.inBounds(next)) continue;

      const nextKey = posKey(next);
      if (continuePosSet.has(nextKey)) continue;

      const nextState = this.cells.get(next);
      if (nextState === CellState.WHITE) continue;

      const nextNum = this.numbers.get(next.row, next.col);
      if (nextNum !== null && nextNum !== size) continue;

      continuePosSet.add(nextKey);
      const opposite = this.getOppositeDirection(dir);
      if (this.setContinueCandPosSet(next, continuePosSet, size, opposite)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get connected black cells containing a number
   */
  private setContinuePosSetContainsNumber(
    pos: Position,
    continuePosSet: Set<string>,
    from: Direction | null
  ): boolean {
    if (this.numbers.get(pos.row, pos.col) !== null) {
      return true;
    }

    for (const dir of DIRECTIONS) {
      if (from === dir) continue;

      const next = adjacent(pos, dir);
      if (!this.cells.inBounds(next)) continue;

      const nextKey = posKey(next);
      if (continuePosSet.has(nextKey)) continue;

      const nextState = this.cells.get(next);
      if (nextState === CellState.WHITE) continue;

      continuePosSet.add(nextKey);
      const opposite = this.getOppositeDirection(dir);
      if (this.setContinuePosSetContainsNumber(next, continuePosSet, opposite)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check and set continue white pos set with size limit
   */
  private checkAndSetContinueWhitePosSet(
    pos: Position,
    continuePosSet: Set<string>,
    from: Direction | null,
    maxSize: number
  ): boolean {
    if (continuePosSet.size > maxSize) {
      return false;
    }

    for (const dir of DIRECTIONS) {
      if (from === dir) continue;

      const next = adjacent(pos, dir);
      if (!this.cells.inBounds(next)) continue;

      const nextKey = posKey(next);
      if (continuePosSet.has(nextKey)) continue;

      if (this.cells.get(next) !== CellState.BLACK) continue;

      continuePosSet.add(nextKey);
      const opposite = this.getOppositeDirection(dir);
      if (!this.checkAndSetContinueWhitePosSet(next, continuePosSet, opposite, maxSize)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get opposite direction
   */
  private getOppositeDirection(dir: Direction): Direction {
    switch (dir) {
      case Direction.UP:
        return Direction.DOWN;
      case Direction.DOWN:
        return Direction.UP;
      case Direction.LEFT:
        return Direction.RIGHT;
      case Direction.RIGHT:
        return Direction.LEFT;
    }
  }

  // ========== Constraint solving ==========

  /**
   * Solve island size constraints
   */
  private countSolve(): boolean {
    for (const [pos, num] of this.numbers.entries()) {
      if (num === null) continue;

      const { positions, valid } = this.getContinuePosSet(pos, num);

      if (!valid) {
        return false; // Size exceeded
      }

      if (positions.size === num) {
        // Island size is exactly right - mark surrounding cells as white
        this.fixedIslands.add(positions);
        for (const key of positions) {
          const p = parsePos(key);
          for (const dir of DIRECTIONS) {
            const next = adjacent(p, dir);
            if (!this.cells.inBounds(next)) continue;
            if (!positions.has(posKey(next))) {
              this.setWhite(next.row, next.col);
            }
          }
        }
      } else {
        // Check if we can potentially reach the size
        const { positions: candPos, canReachSize } = this.getContinueCandPosSet(pos, num);

        if (!canReachSize) {
          if (candPos.size === num) {
            // Must use all candidate positions
            this.fixedIslands.add(candPos);
            for (const key of candPos) {
              const p = parsePos(key);
              this.setBlack(p.row, p.col);
              for (const dir of DIRECTIONS) {
                const next = adjacent(p, dir);
                if (!this.cells.inBounds(next)) continue;
                if (!candPos.has(posKey(next))) {
                  this.setWhite(next.row, next.col);
                }
              }
            }
          } else {
            return false; // Can't reach required size
          }
        }
      }
    }
    return true;
  }

  /**
   * Add isolated black cells to fixed islands
   */
  private standAloneSolve(): boolean {
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        if (this.cells.get(row, col) !== CellState.BLACK) continue;
        if (this.numbers.get(row, col) !== null) continue;

        const pos = { row, col };
        const continueNotBlackPosSet = new Set<string>();
        continueNotBlackPosSet.add(posKey(pos));

        if (!this.setContinuePosSetContainsNumber(pos, continueNotBlackPosSet, null)) {
          // This black cell group has no number
          const continueWhitePosSet = new Set<string>();
          continueWhitePosSet.add(posKey(pos));

          if (
            this.checkAndSetContinueWhitePosSet(
              pos,
              continueWhitePosSet,
              null,
              continueNotBlackPosSet.size
            )
          ) {
            if (continueWhitePosSet.size === continueNotBlackPosSet.size) {
              this.fixedIslands.add(continueNotBlackPosSet);
            }
          }
        }
      }
    }
    return true;
  }

  /**
   * Check archipelago constraints
   * Each archipelago must contain islands of sizes 1, 2, 3, ..., N
   */
  private archipelagoSolve(): boolean {
    for (const fixedIsland of this.fixedIslands) {
      const archipelagoIslands = new Set<Set<string>>();
      archipelagoIslands.add(fixedIsland);

      const isComplete = this.setContinueArchSet(fixedIsland, archipelagoIslands);

      const sizes: number[] = [];
      for (const island of archipelagoIslands) {
        if (sizes.includes(island.size)) {
          return false; // Duplicate size in archipelago
        }
        sizes.push(island.size);
      }

      if (isComplete) {
        // Check that we have all sizes from 1 to max
        for (let i = 1; i <= sizes.length; i++) {
          if (!sizes.includes(i)) {
            return false; // Missing size in sequence
          }
        }
      }
    }
    return true;
  }

  /**
   * Build archipelago by connecting diagonally adjacent islands
   * Returns true if all diagonal neighbors are determined
   */
  private setContinueArchSet(island: Set<string>, archipelago: Set<Set<string>>): boolean {
    let allFixed = true;

    for (const key of island) {
      const pos = parsePos(key);

      // Check all 4 diagonal neighbors
      const diagonals = [
        { row: pos.row - 1, col: pos.col + 1 }, // up-right
        { row: pos.row + 1, col: pos.col + 1 }, // down-right
        { row: pos.row + 1, col: pos.col - 1 }, // down-left
        { row: pos.row - 1, col: pos.col - 1 }, // up-left
      ];

      for (const diag of diagonals) {
        if (!this.cells.inBounds(diag)) continue;

        const diagKey = posKey(diag);
        let foundInFixed = false;
        let connectedIsland: Set<string> | null = null;

        // Check if this diagonal is in any fixed island
        for (const fixedIsland of this.fixedIslands) {
          if (fixedIsland === island) continue;
          if (fixedIsland.has(diagKey)) {
            foundInFixed = true;
            connectedIsland = fixedIsland;
            break;
          }
        }

        if (foundInFixed && connectedIsland) {
          if (!archipelago.has(connectedIsland)) {
            archipelago.add(connectedIsland);
            if (!this.setContinueArchSet(connectedIsland, archipelago)) {
              allFixed = false;
            }
          }
        } else if (this.cells.get(diag) !== CellState.WHITE) {
          // Unknown cell on diagonal
          allFixed = false;
        }
      }
    }

    return allFixed;
  }

  // ========== FieldState implementation ==========

  clone(): ArchipelagoField {
    const cloned = new ArchipelagoField(this.height, this.width);
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        cloned.cells.set(row, col, this.cells.get(row, col));
        cloned.numbers.set(row, col, this.numbers.get(row, col));
      }
    }
    cloned.fixedIslands = new Set();
    for (const island of this.fixedIslands) {
      cloned.fixedIslands.add(new Set(island));
    }
    return cloned;
  }

  getStateDump(): string {
    let dump = '';
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        dump += this.cells.get(row, col);
      }
    }
    return dump;
  }

  isSolved(): boolean {
    // Check that all cells are determined
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        if (this.cells.get(row, col) === CellState.UNKNOWN) {
          return false;
        }
      }
    }

    // Final validation
    return this.solveAndCheck();
  }

  solveAndCheck(): boolean {
    const str = this.getStateDump();

    if (!this.countSolve()) return false;
    if (!this.standAloneSolve()) return false;
    if (!this.archipelagoSolve()) return false;

    if (this.getStateDump() !== str) {
      return this.solveAndCheck();
    }

    return true;
  }

  toString(): string {
    const HALF_NUMS = '0 1 2 3 4 5 6 7 8 9';
    const FULL_NUMS = '０１２３４５６７８９';

    const lines: string[] = [];
    for (let row = 0; row < this.height; row++) {
      let line = '';
      for (let col = 0; col < this.width; col++) {
        const num = this.numbers.get(row, col);
        if (num !== null) {
          if (num > 99) {
            line += '99';
          } else {
            const numStr = String(num);
            const index = HALF_NUMS.indexOf(numStr);
            if (index >= 0) {
              line += FULL_NUMS[Math.floor(index / 2)];
            } else {
              line += numStr;
            }
          }
        } else {
          const state = this.cells.get(row, col);
          if (state === CellState.BLACK) {
            line += '■';
          } else if (state === CellState.WHITE) {
            line += '□';
          } else {
            line += '・';
          }
        }
      }
      lines.push(line);
    }
    return lines.join('\n');
  }
}

// ============================================
// Archipelago Solver
// ============================================

export class ArchipelagoSolver extends BaseSolver<ArchipelagoField> {
  constructor(field: ArchipelagoField) {
    super(field);
  }

  /** Create solver from simple string format */
  static fromString(height: number, width: number, numbersData: string): ArchipelagoSolver {
    const field = new ArchipelagoField(height, width);

    // Parse numbers data
    // Format: "num1,row1,col1;num2,row2,col2;..."
    const entries = numbersData.split(';').filter(e => e.trim());
    for (const entry of entries) {
      const parts = entry.split(',').map(s => s.trim());
      if (parts.length === 3) {
        const num = parseInt(parts[0]);
        const row = parseInt(parts[1]);
        const col = parseInt(parts[2]);
        if (!isNaN(num) && !isNaN(row) && !isNaN(col)) {
          field.setNumber(row, col, num);
        }
      }
    }

    return new ArchipelagoSolver(field);
  }

  protected getBranchCandidates(state: ArchipelagoField): BranchCandidate<ArchipelagoField>[] {
    // Find first unknown cell
    for (let row = 0; row < state.height; row++) {
      for (let col = 0; col < state.width; col++) {
        if (state.getCell(row, col) === CellState.UNKNOWN) {
          return [
            {
              apply: (s) => {
                const cloned = s.clone();
                cloned.setBlack(row, col);
                return cloned;
              },
              description: `Set (${row},${col}) to BLACK`,
            },
            {
              apply: (s) => {
                const cloned = s.clone();
                cloned.setWhite(row, col);
                return cloned;
              },
              description: `Set (${row},${col}) to WHITE`,
            },
          ];
        }
      }
    }
    return [];
  }
}
