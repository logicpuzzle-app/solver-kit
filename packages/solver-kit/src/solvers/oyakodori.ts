/**
 * Oyakodori (Parent-Child Birds) Solver
 *
 * Rules:
 * 1. Place parent and child birds in the grid
 * 2. Each parent bird must have a specified number of child birds nearby
 * 3. Birds cannot overlap
 * 4. Numbers indicate constraints
 */

import { Position } from '../core/types.js';
import { FieldState, Grid } from '../core/field.js';
import { BaseSolver, BranchCandidate } from '../core/solver.js';

// ============================================
// Oyakodori Types
// ============================================

export enum OyakodoriCell {
  EMPTY = 0,
  PARENT = 1,
  CHILD = 2,
}

// ============================================
// Oyakodori Field State
// ============================================

export class OyakodoriField implements FieldState<OyakodoriField> {
  readonly height: number;
  readonly width: number;
  /** Cell contents */
  private cells: Grid<OyakodoriCell>;
  /** Number clues */
  private clues: Grid<number | null>;

  constructor(height: number, width: number) {
    this.height = height;
    this.width = width;
    this.cells = new Grid(height, width, () => OyakodoriCell.EMPTY);
    this.clues = new Grid(height, width, () => null);
  }

  setClue(row: number, col: number, value: number): void {
    this.clues.set(row, col, value);
  }

  getCell(row: number, col: number): OyakodoriCell {
    if (row < 0 || row >= this.height || col < 0 || col >= this.width) {
      return OyakodoriCell.EMPTY;
    }
    return this.cells.get(row, col);
  }

  setCell(row: number, col: number, cell: OyakodoriCell): void {
    this.cells.set(row, col, cell);
  }

  private countAdjacentChildren(row: number, col: number): number {
    let count = 0;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = row + dr;
        const nc = col + dc;
        if (nr >= 0 && nr < this.height && nc >= 0 && nc < this.width) {
          if (this.cells.get(nr, nc) === OyakodoriCell.CHILD) {
            count++;
          }
        }
      }
    }
    return count;
  }

  clone(): OyakodoriField {
    const cloned = new OyakodoriField(this.height, this.width);
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
    // Check each parent has correct number of children
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        if (this.cells.get(row, col) === OyakodoriCell.PARENT) {
          const clue = this.clues.get(row, col);
          if (clue !== null) {
            if (this.countAdjacentChildren(row, col) !== clue) return false;
          }
        }
      }
    }
    return true;
  }

  solveAndCheck(): boolean {
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        if (this.cells.get(row, col) === OyakodoriCell.PARENT) {
          const clue = this.clues.get(row, col);
          if (clue !== null) {
            const count = this.countAdjacentChildren(row, col);
            if (count > clue) return false;
          }
        }
      }
    }
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
          if (cell === OyakodoriCell.PARENT) line += 'P';
          else if (cell === OyakodoriCell.CHILD) line += 'c';
          else line += '.';
        }
      }
      lines.push(line);
    }
    return lines.join('\n');
  }

  getFirstEmptyCell(): Position | null {
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        if (this.cells.get(row, col) === OyakodoriCell.EMPTY && this.clues.get(row, col) === null) {
          return { row, col };
        }
      }
    }
    return null;
  }
}

// ============================================
// Oyakodori Solver
// ============================================

export class OyakodoriSolver extends BaseSolver<OyakodoriField> {
  constructor(field: OyakodoriField) {
    super(field);
  }

  static fromString(height: number, width: number, param: string): OyakodoriSolver {
    const field = new OyakodoriField(height, width);

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
          field.setCell(row, col, OyakodoriCell.PARENT);
        }
        index++;
      }
    }

    return new OyakodoriSolver(field);
  }

  protected getBranchCandidates(state: OyakodoriField): BranchCandidate<OyakodoriField>[] {
    const empty = state.getFirstEmptyCell();
    if (!empty) return [];

    return [
      {
        apply: (s) => {
          const cloned = s.clone();
          cloned.setCell(empty.row, empty.col, OyakodoriCell.CHILD);
          return cloned;
        },
        description: `Place CHILD at (${empty.row}, ${empty.col})`,
      },
      {
        apply: (s) => {
          const cloned = s.clone();
          // Keep empty
          return cloned;
        },
        description: `Keep (${empty.row}, ${empty.col}) empty`,
      },
    ];
  }
}
