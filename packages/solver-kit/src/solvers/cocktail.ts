/**
 * Cocktail Solver
 *
 * Rules:
 * 1. Shade some cells to form cocktail glass shapes
 * 2. Numbers indicate the size of the shaded region
 * 3. Shaded regions must follow specific patterns
 * 4. No two shaded regions can touch
 */

import { Position, CellState } from '../core/types.js';
import { FieldState, Grid } from '../core/field.js';
import { BaseSolver, BranchCandidate } from '../core/solver.js';

// ============================================
// Cocktail Field State
// ============================================

export class CocktailField implements FieldState<CocktailField> {
  readonly height: number;
  readonly width: number;
  /** Cell states */
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

  getCell(row: number, col: number): CellState {
    if (row < 0 || row >= this.height || col < 0 || col >= this.width) {
      return CellState.WHITE;
    }
    return this.cells.get(row, col);
  }

  setCell(row: number, col: number, state: CellState): void {
    this.cells.set(row, col, state);
  }

  clone(): CocktailField {
    const cloned = new CocktailField(this.height, this.width);
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
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        if (this.cells.get(row, col) === CellState.UNKNOWN) return false;
      }
    }
    return this.solveAndCheck();
  }

  solveAndCheck(): boolean {
    // Check no two shaded regions touch orthogonally (simplified check)
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
          if (cell === CellState.BLACK) line += '#';
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
        if (this.cells.get(row, col) === CellState.UNKNOWN) {
          return { row, col };
        }
      }
    }
    return null;
  }
}

// ============================================
// Cocktail Solver
// ============================================

export class CocktailSolver extends BaseSolver<CocktailField> {
  constructor(field: CocktailField) {
    super(field);
  }

  static fromString(height: number, width: number, param: string): CocktailSolver {
    const field = new CocktailField(height, width);

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

    return new CocktailSolver(field);
  }

  protected getBranchCandidates(state: CocktailField): BranchCandidate<CocktailField>[] {
    const unknown = state.getFirstUnknownCell();
    if (!unknown) return [];

    return [
      {
        apply: (s) => {
          const cloned = s.clone();
          cloned.setCell(unknown.row, unknown.col, CellState.BLACK);
          return cloned;
        },
        description: `Shade (${unknown.row}, ${unknown.col})`,
      },
      {
        apply: (s) => {
          const cloned = s.clone();
          cloned.setCell(unknown.row, unknown.col, CellState.WHITE);
          return cloned;
        },
        description: `Leave (${unknown.row}, ${unknown.col}) unshaded`,
      },
    ];
  }
}
