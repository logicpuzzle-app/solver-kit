/**
 * Nibunnogo (二分の五) Solver
 *
 * Rules:
 * 1. Shade some cells in the grid
 * 2. Each row and column must have exactly 2/5 of cells shaded
 * 3. Shaded cells form specific patterns
 */

import { Position, CellState } from '../core/types.js';
import { FieldState, Grid } from '../core/field.js';
import { BaseSolver, BranchCandidate } from '../core/solver.js';

export class NibunnogoField implements FieldState<NibunnogoField> {
  readonly height: number;
  readonly width: number;
  private cells: Grid<CellState>;
  private rowCounts: number[];
  private colCounts: number[];

  constructor(height: number, width: number) {
    this.height = height;
    this.width = width;
    this.cells = new Grid(height, width, () => CellState.UNKNOWN);
    this.rowCounts = new Array(height).fill(Math.floor(width * 2 / 5));
    this.colCounts = new Array(width).fill(Math.floor(height * 2 / 5));
  }

  setRowCount(row: number, count: number): void {
    this.rowCounts[row] = count;
  }

  setColCount(col: number, count: number): void {
    this.colCounts[col] = count;
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

  private countInRow(row: number): { shaded: number; unknown: number } {
    let shaded = 0;
    let unknown = 0;
    for (let col = 0; col < this.width; col++) {
      const cell = this.cells.get(row, col);
      if (cell === CellState.BLACK) shaded++;
      else if (cell === CellState.UNKNOWN) unknown++;
    }
    return { shaded, unknown };
  }

  private countInCol(col: number): { shaded: number; unknown: number } {
    let shaded = 0;
    let unknown = 0;
    for (let row = 0; row < this.height; row++) {
      const cell = this.cells.get(row, col);
      if (cell === CellState.BLACK) shaded++;
      else if (cell === CellState.UNKNOWN) unknown++;
    }
    return { shaded, unknown };
  }

  private lineSolve(): boolean {
    for (let row = 0; row < this.height; row++) {
      const { shaded, unknown } = this.countInRow(row);
      const required = this.rowCounts[row];
      if (shaded > required) return false;
      if (shaded + unknown < required) return false;
      if (shaded === required) {
        for (let col = 0; col < this.width; col++) {
          if (this.cells.get(row, col) === CellState.UNKNOWN) {
            this.cells.set(row, col, CellState.WHITE);
          }
        }
      }
      if (shaded + unknown === required) {
        for (let col = 0; col < this.width; col++) {
          if (this.cells.get(row, col) === CellState.UNKNOWN) {
            this.cells.set(row, col, CellState.BLACK);
          }
        }
      }
    }
    for (let col = 0; col < this.width; col++) {
      const { shaded, unknown } = this.countInCol(col);
      const required = this.colCounts[col];
      if (shaded > required) return false;
      if (shaded + unknown < required) return false;
      if (shaded === required) {
        for (let row = 0; row < this.height; row++) {
          if (this.cells.get(row, col) === CellState.UNKNOWN) {
            this.cells.set(row, col, CellState.WHITE);
          }
        }
      }
      if (shaded + unknown === required) {
        for (let row = 0; row < this.height; row++) {
          if (this.cells.get(row, col) === CellState.UNKNOWN) {
            this.cells.set(row, col, CellState.BLACK);
          }
        }
      }
    }
    return true;
  }

  clone(): NibunnogoField {
    const cloned = new NibunnogoField(this.height, this.width);
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        cloned.cells.set(row, col, this.cells.get(row, col));
      }
    }
    cloned.rowCounts = [...this.rowCounts];
    cloned.colCounts = [...this.colCounts];
    return cloned;
  }

  getStateDump(): string {
    return this.cells.dump();
  }

  isSolved(): boolean {
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        if (this.cells.get(row, col) === CellState.UNKNOWN) return false;
      }
    }
    for (let row = 0; row < this.height; row++) {
      const { shaded } = this.countInRow(row);
      if (shaded !== this.rowCounts[row]) return false;
    }
    for (let col = 0; col < this.width; col++) {
      const { shaded } = this.countInCol(col);
      if (shaded !== this.colCounts[col]) return false;
    }
    return true;
  }

  solveAndCheck(): boolean {
    let changed = true;
    while (changed) {
      const before = this.getStateDump();
      if (!this.lineSolve()) return false;
      changed = this.getStateDump() !== before;
    }
    return true;
  }

  toString(): string {
    const lines: string[] = [];
    for (let row = 0; row < this.height; row++) {
      let line = '';
      for (let col = 0; col < this.width; col++) {
        const cell = this.cells.get(row, col);
        line += cell === CellState.BLACK ? '#' : cell === CellState.WHITE ? '.' : '?';
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

export class NibunnogoSolver extends BaseSolver<NibunnogoField> {
  constructor(field: NibunnogoField) {
    super(field);
  }

  static fromString(height: number, width: number): NibunnogoSolver {
    const field = new NibunnogoField(height, width);
    return new NibunnogoSolver(field);
  }

  protected getBranchCandidates(state: NibunnogoField): BranchCandidate<NibunnogoField>[] {
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
