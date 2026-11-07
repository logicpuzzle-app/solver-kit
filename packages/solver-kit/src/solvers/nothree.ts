/**
 * Nothree (No Three in a Row) Solver
 *
 * Rules:
 * 1. Place circles in some cells
 * 2. No three circles can be in a row horizontally, vertically, or diagonally
 * 3. Numbers indicate constraints about circle placement
 * 4. All constraints must be satisfied
 */

import { Position, CellState } from '../core/types.js';
import { FieldState, Grid } from '../core/field.js';
import { BaseSolver, BranchCandidate } from '../core/solver.js';

// ============================================
// Nothree Field State
// ============================================

export class NothreeField implements FieldState<NothreeField> {
  readonly height: number;
  readonly width: number;
  /** Cell states (circle or empty) */
  private cells: Grid<CellState>;
  /** Number clues */
  private clues: Grid<number | null>;

  constructor(height: number, width: number) {
    this.height = height;
    this.width = width;
    this.cells = new Grid(height, width, () => CellState.UNKNOWN);
    this.clues = new Grid(height, width, () => null);
  }

  setClue(row: number, col: number, value: number): void {
    this.clues.set(row, col, value);
  }

  getClue(row: number, col: number): number | null {
    return this.clues.get(row, col);
  }

  getCell(row: number, col: number): CellState {
    if (row < 0 || row >= this.height || col < 0 || col >= this.width) {
      return CellState.WHITE;
    }
    return this.cells.get(row, col);
  }

  setCell(row: number, col: number, state: CellState): void {
    this.cells.set(row, col, state);
  }

  /** Check if there are three in a row in any direction */
  private hasThreeInRow(): boolean {
    // Horizontal check
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col <= this.width - 3; col++) {
        if (
          this.cells.get(row, col) === CellState.BLACK &&
          this.cells.get(row, col + 1) === CellState.BLACK &&
          this.cells.get(row, col + 2) === CellState.BLACK
        ) {
          return true;
        }
      }
    }

    // Vertical check
    for (let row = 0; row <= this.height - 3; row++) {
      for (let col = 0; col < this.width; col++) {
        if (
          this.cells.get(row, col) === CellState.BLACK &&
          this.cells.get(row + 1, col) === CellState.BLACK &&
          this.cells.get(row + 2, col) === CellState.BLACK
        ) {
          return true;
        }
      }
    }

    // Diagonal check (top-left to bottom-right)
    for (let row = 0; row <= this.height - 3; row++) {
      for (let col = 0; col <= this.width - 3; col++) {
        if (
          this.cells.get(row, col) === CellState.BLACK &&
          this.cells.get(row + 1, col + 1) === CellState.BLACK &&
          this.cells.get(row + 2, col + 2) === CellState.BLACK
        ) {
          return true;
        }
      }
    }

    // Diagonal check (top-right to bottom-left)
    for (let row = 0; row <= this.height - 3; row++) {
      for (let col = 2; col < this.width; col++) {
        if (
          this.cells.get(row, col) === CellState.BLACK &&
          this.cells.get(row + 1, col - 1) === CellState.BLACK &&
          this.cells.get(row + 2, col - 2) === CellState.BLACK
        ) {
          return true;
        }
      }
    }

    return false;
  }

  clone(): NothreeField {
    const cloned = new NothreeField(this.height, this.width);
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        cloned.cells.set(row, col, this.cells.get(row, col));
        cloned.clues.set(row, col, this.clues.get(row, col));
      }
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
    // Check no unknown cells
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        if (this.cells.get(row, col) === CellState.UNKNOWN) return false;
      }
    }

    // Check no three in a row
    if (this.hasThreeInRow()) return false;

    return true;
  }

  solveAndCheck(): boolean {
    // Check no three in a row
    if (this.hasThreeInRow()) return false;

    return true;
  }

  toString(): string {
    const lines: string[] = [];
    for (let row = 0; row < this.height; row++) {
      let line = '';
      for (let col = 0; col < this.width; col++) {
        const clue = this.clues.get(row, col);
        if (clue !== null) {
          line += String(clue);
        } else {
          const cell = this.cells.get(row, col);
          if (cell === CellState.BLACK) line += 'O';
          else if (cell === CellState.WHITE) line += '.';
          else line += '?';
        }
      }
      lines.push(line);
    }
    return lines.join('\n');
  }

  getFirstUnknownCell(): Position | null {
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        if (this.cells.get(row, col) === CellState.UNKNOWN && this.clues.get(row, col) === null) {
          return { row, col };
        }
      }
    }
    return null;
  }
}

// ============================================
// Nothree Solver
// ============================================

export class NothreeSolver extends BaseSolver<NothreeField> {
  constructor(field: NothreeField) {
    super(field);
  }

  static fromString(height: number, width: number, param: string): NothreeSolver {
    const field = new NothreeField(height, width);

    const ALPHABET_FROM_G = 'ghijklmnopqrstuvwxyz';
    let index = 0;

    for (let i = 0; i < param.length && index < height * width; i++) {
      const ch = param[i];
      const interval = ALPHABET_FROM_G.indexOf(ch);

      if (interval !== -1) {
        index += interval + 1;
      } else {
        const row = Math.floor(index / width);
        const col = index % width;

        let num: number;
        if (ch === '-') {
          num = parseInt(param[i + 1] + param[i + 2], 16);
          i += 2;
        } else {
          num = parseInt(ch, 16);
        }

        if (!isNaN(num) && row < height && col < width) {
          field.setClue(row, col, num);
        }
        index++;
      }
    }

    return new NothreeSolver(field);
  }

  protected getBranchCandidates(state: NothreeField): BranchCandidate<NothreeField>[] {
    const unknown = state.getFirstUnknownCell();
    if (!unknown) return [];

    return [
      {
        apply: (s) => {
          const cloned = s.clone();
          cloned.setCell(unknown.row, unknown.col, CellState.BLACK);
          return cloned;
        },
        description: `Place circle at (${unknown.row}, ${unknown.col})`,
      },
      {
        apply: (s) => {
          const cloned = s.clone();
          cloned.setCell(unknown.row, unknown.col, CellState.WHITE);
          return cloned;
        },
        description: `Leave (${unknown.row}, ${unknown.col}) empty`,
      },
    ];
  }
}
