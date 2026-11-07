/**
 * Kurodoko Solver
 *
 * Rules:
 * 1. Paint some cells black
 * 2. Numbers indicate how many cells are visible from that cell (including itself)
 *    in all 4 orthogonal directions (until a black cell blocks the view)
 * 3. Black cells cannot be adjacent orthogonally
 * 4. All white cells must be connected
 */

import {
  CellState,
  Position,
  DIRECTIONS,
  adjacent,
  posKey,
} from '../core/types.js';
import { FieldState, Grid } from '../core/field.js';
import { BaseSolver, BranchCandidate } from '../core/solver.js';

// ============================================
// Kurodoko Field State
// ============================================

export class KurodokoField implements FieldState<KurodokoField> {
  readonly height: number;
  readonly width: number;
  /** Cell states (UNKNOWN/WHITE/BLACK) */
  private cells: Grid<CellState>;
  /** Numbers in each cell (null = no number, -1 = unknown number) */
  private numbers: Grid<number | null>;

  constructor(height: number, width: number) {
    this.height = height;
    this.width = width;
    this.cells = new Grid(height, width, () => CellState.UNKNOWN);
    this.numbers = new Grid(height, width, () => null);
  }

  /** Set a number clue (also marks as white) */
  setNumber(row: number, col: number, num: number): void {
    this.numbers.set(row, col, num);
    this.cells.set(row, col, CellState.WHITE);
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
    // Can't make a number cell black
    if (this.numbers.get(row, col) === null) {
      this.cells.set(row, col, CellState.BLACK);
    }
  }

  /** Set cell to white */
  setWhite(row: number, col: number): void {
    this.cells.set(row, col, CellState.WHITE);
  }

  // ========== Helper methods ==========

  /** Count visible cells in one direction (non-black cells) */
  private countVisibleInDirection(
    row: number,
    col: number,
    dRow: number,
    dCol: number,
    stopAtBlack: boolean
  ): number {
    let count = 0;
    let r = row + dRow;
    let c = col + dCol;

    while (r >= 0 && r < this.height && c >= 0 && c < this.width) {
      const state = this.cells.get(r, c);
      if (state === CellState.BLACK) {
        break;
      }
      if (stopAtBlack && state !== CellState.WHITE) {
        // Count unknown as potentially visible
        count++;
      } else {
        count++;
      }
      r += dRow;
      c += dCol;
    }

    return count;
  }

  /** Count guaranteed visible cells (white only) in one direction */
  private countWhiteInDirection(row: number, col: number, dRow: number, dCol: number): number {
    let count = 0;
    let r = row + dRow;
    let c = col + dCol;

    while (r >= 0 && r < this.height && c >= 0 && c < this.width) {
      const state = this.cells.get(r, c);
      if (state !== CellState.WHITE) {
        break;
      }
      count++;
      r += dRow;
      c += dCol;
    }

    return count;
  }

  /** Get total visible cells from a position (including itself) */
  private getTotalVisible(row: number, col: number): number {
    return (
      1 +
      this.countVisibleInDirection(row, col, -1, 0, true) + // up
      this.countVisibleInDirection(row, col, 1, 0, true) + // down
      this.countVisibleInDirection(row, col, 0, -1, true) + // left
      this.countVisibleInDirection(row, col, 0, 1, true) // right
    );
  }

  /** Get guaranteed visible cells (white only) from a position */
  private getGuaranteedVisible(row: number, col: number): number {
    return (
      1 +
      this.countWhiteInDirection(row, col, -1, 0) +
      this.countWhiteInDirection(row, col, 1, 0) +
      this.countWhiteInDirection(row, col, 0, -1) +
      this.countWhiteInDirection(row, col, 0, 1)
    );
  }

  // ========== Constraint checking ==========

  /** Check if any black cells are adjacent */
  private hasAdjacentBlack(): boolean {
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        if (this.cells.get(row, col) !== CellState.BLACK) continue;

        for (const dir of DIRECTIONS) {
          const next = adjacent({ row, col }, dir);
          if (this.cells.inBounds(next) && this.cells.get(next) === CellState.BLACK) {
            return true;
          }
        }
      }
    }
    return false;
  }

  /** Mark neighbors of black cells as white */
  private markBlackNeighborsWhite(): boolean {
    let changed = false;

    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        if (this.cells.get(row, col) !== CellState.BLACK) continue;

        for (const dir of DIRECTIONS) {
          const next = adjacent({ row, col }, dir);
          if (this.cells.inBounds(next) && this.cells.get(next) === CellState.UNKNOWN) {
            this.setWhite(next.row, next.col);
            changed = true;
          }
        }
      }
    }

    return changed;
  }

  /** Check if white cells are connected */
  private isWhiteConnected(): boolean {
    const whiteCells: Position[] = [];
    for (const [pos, state] of this.cells.entries()) {
      if (state === CellState.WHITE) {
        whiteCells.push(pos);
      }
    }

    if (whiteCells.length === 0) return true;

    // BFS from first white cell
    const visited = new Set<string>();
    const queue: Position[] = [whiteCells[0]];
    visited.add(posKey(whiteCells[0]));

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const dir of DIRECTIONS) {
        const next = adjacent(current, dir);
        const key = posKey(next);
        if (
          this.cells.inBounds(next) &&
          this.cells.get(next) !== CellState.BLACK &&
          !visited.has(key)
        ) {
          visited.add(key);
          queue.push(next);
        }
      }
    }

    // All white cells must be reachable
    for (const pos of whiteCells) {
      if (!visited.has(posKey(pos))) {
        return false;
      }
    }

    return true;
  }

  /** Check number constraints validity */
  private checkNumberConstraints(): boolean {
    for (const [pos, num] of this.numbers.entries()) {
      if (num === null || num === -1) continue;

      const maxVisible = this.getTotalVisible(pos.row, pos.col);
      const minVisible = this.getGuaranteedVisible(pos.row, pos.col);

      if (maxVisible < num) return false; // Can't reach required count
      if (minVisible > num) return false; // Already exceeded
    }
    return true;
  }

  // ========== Solving methods ==========

  /** Solve number constraints */
  private solveNumberConstraints(): boolean {
    let changed = false;

    for (const [pos, num] of this.numbers.entries()) {
      if (num === null || num === -1) continue;

      const { row, col } = pos;

      // Count potential visible in each direction
      const upSpace = this.countVisibleInDirection(row, col, -1, 0, true);
      const downSpace = this.countVisibleInDirection(row, col, 1, 0, true);
      const leftSpace = this.countVisibleInDirection(row, col, 0, -1, true);
      const rightSpace = this.countVisibleInDirection(row, col, 0, 1, true);
      const totalSpace = 1 + upSpace + downSpace + leftSpace + rightSpace;

      // If total potential is less than number, contradiction
      if (totalSpace < num) {
        return false;
      }

      // Calculate how many cells must be visible in each direction
      // If removing a direction would make total < num, that direction is needed
      const neededUp = num - (1 + downSpace + leftSpace + rightSpace);
      const neededDown = num - (1 + upSpace + leftSpace + rightSpace);
      const neededLeft = num - (1 + upSpace + downSpace + rightSpace);
      const neededRight = num - (1 + upSpace + downSpace + leftSpace);

      // Mark required cells as white
      if (neededUp > 0) {
        for (let i = 1; i <= neededUp && row - i >= 0; i++) {
          if (this.cells.get(row - i, col) === CellState.UNKNOWN) {
            this.setWhite(row - i, col);
            changed = true;
          }
        }
      }
      if (neededDown > 0) {
        for (let i = 1; i <= neededDown && row + i < this.height; i++) {
          if (this.cells.get(row + i, col) === CellState.UNKNOWN) {
            this.setWhite(row + i, col);
            changed = true;
          }
        }
      }
      if (neededLeft > 0) {
        for (let i = 1; i <= neededLeft && col - i >= 0; i++) {
          if (this.cells.get(row, col - i) === CellState.UNKNOWN) {
            this.setWhite(row, col - i);
            changed = true;
          }
        }
      }
      if (neededRight > 0) {
        for (let i = 1; i <= neededRight && col + i < this.width; i++) {
          if (this.cells.get(row, col + i) === CellState.UNKNOWN) {
            this.setWhite(row, col + i);
            changed = true;
          }
        }
      }

      // Count guaranteed visible (white only)
      const upWhite = this.countWhiteInDirection(row, col, -1, 0);
      const downWhite = this.countWhiteInDirection(row, col, 1, 0);
      const leftWhite = this.countWhiteInDirection(row, col, 0, -1);
      const rightWhite = this.countWhiteInDirection(row, col, 0, 1);
      const totalWhite = 1 + upWhite + downWhite + leftWhite + rightWhite;

      // If we've reached the number, block further extension
      if (totalWhite === num) {
        // Block cells beyond white regions
        if (row - upWhite - 1 >= 0 && this.cells.get(row - upWhite - 1, col) === CellState.UNKNOWN) {
          this.setBlack(row - upWhite - 1, col);
          changed = true;
        }
        if (row + downWhite + 1 < this.height && this.cells.get(row + downWhite + 1, col) === CellState.UNKNOWN) {
          this.setBlack(row + downWhite + 1, col);
          changed = true;
        }
        if (col - leftWhite - 1 >= 0 && this.cells.get(row, col - leftWhite - 1) === CellState.UNKNOWN) {
          this.setBlack(row, col - leftWhite - 1);
          changed = true;
        }
        if (col + rightWhite + 1 < this.width && this.cells.get(row, col + rightWhite + 1) === CellState.UNKNOWN) {
          this.setBlack(row, col + rightWhite + 1);
          changed = true;
        }
      } else if (totalWhite > num) {
        return false;
      }
    }

    return changed;
  }

  // ========== FieldState implementation ==========

  clone(): KurodokoField {
    const cloned = new KurodokoField(this.height, this.width);
    for (const [pos, state] of this.cells.entries()) {
      cloned.cells.set(pos, state);
    }
    cloned.numbers = this.numbers; // Shared (immutable)
    return cloned;
  }

  getStateDump(): string {
    return this.cells.dump();
  }

  isSolved(): boolean {
    // All cells must be determined
    for (const [, state] of this.cells.entries()) {
      if (state === CellState.UNKNOWN) return false;
    }

    // No adjacent blacks
    if (this.hasAdjacentBlack()) return false;

    // White cells must be connected
    if (!this.isWhiteConnected()) return false;

    // Check number constraints
    for (const [pos, num] of this.numbers.entries()) {
      if (num === null || num === -1) continue;

      const visible = this.getGuaranteedVisible(pos.row, pos.col);
      if (visible !== num) return false;
    }

    return true;
  }

  solveAndCheck(): boolean {
    // Check for immediate contradictions
    if (this.hasAdjacentBlack()) return false;
    if (!this.checkNumberConstraints()) return false;

    let changed = true;
    while (changed) {
      changed = false;

      // Mark neighbors of black cells as white
      if (this.markBlackNeighborsWhite()) changed = true;

      // Solve number constraints
      const numResult = this.solveNumberConstraints();
      if (numResult === false) return false;
      if (numResult === true) changed = true;

      // Check for contradictions
      if (this.hasAdjacentBlack()) return false;
      if (!this.checkNumberConstraints()) return false;
    }

    // Check connectivity
    if (!this.isWhiteConnected()) return false;

    return true;
  }

  toString(): string {
    const lines: string[] = [];
    for (let row = 0; row < this.height; row++) {
      let line = '';
      for (let col = 0; col < this.width; col++) {
        const num = this.numbers.get(row, col);
        if (num !== null) {
          if (num === -1) {
            line += '○';
          } else {
            line += num < 10 ? String(num) : '+';
          }
        } else {
          const state = this.cells.get(row, col);
          line += state === CellState.BLACK ? '█' : state === CellState.WHITE ? '·' : '?';
        }
      }
      lines.push(line);
    }
    return lines.join('\n');
  }

  /** Get unknown cells for branching */
  getUnknownCells(): Position[] {
    const unknowns: Position[] = [];
    for (const [pos, state] of this.cells.entries()) {
      if (state === CellState.UNKNOWN) {
        unknowns.push(pos);
      }
    }
    return unknowns;
  }
}

// ============================================
// Kurodoko Solver
// ============================================

export class KurodokoSolver extends BaseSolver<KurodokoField> {
  constructor(field: KurodokoField) {
    super(field);
  }

  /** Create solver from puzzle string */
  static fromString(height: number, width: number, puzzle: string[]): KurodokoSolver {
    const field = new KurodokoField(height, width);

    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const ch = puzzle[row]?.[col];
        if (ch && ch >= '1' && ch <= '9') {
          field.setNumber(row, col, parseInt(ch));
        } else if (ch && ch.toLowerCase() >= 'a' && ch.toLowerCase() <= 'z') {
          // Letters represent 10+ (a=10, b=11, etc.)
          field.setNumber(row, col, ch.toLowerCase().charCodeAt(0) - 'a'.charCodeAt(0) + 10);
        } else if (ch === '.' || ch === '○') {
          // Unknown number
          field.setNumber(row, col, -1);
        }
      }
    }

    return new KurodokoSolver(field);
  }

  protected getBranchCandidates(state: KurodokoField): BranchCandidate<KurodokoField>[] {
    const unknowns = state.getUnknownCells();
    if (unknowns.length === 0) return [];

    // Pick first unknown cell
    const pos = unknowns[0];

    return [
      {
        apply: (s) => {
          const cloned = s.clone();
          cloned.setBlack(pos.row, pos.col);
          return cloned;
        },
        description: `Set (${pos.row}, ${pos.col}) to BLACK`,
      },
      {
        apply: (s) => {
          const cloned = s.clone();
          cloned.setWhite(pos.row, pos.col);
          return cloned;
        },
        description: `Set (${pos.row}, ${pos.col}) to WHITE`,
      },
    ];
  }
}
