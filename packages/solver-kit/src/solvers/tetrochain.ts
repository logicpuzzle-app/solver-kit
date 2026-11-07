/**
 * Tetrochain Solver
 *
 * Rules:
 * 1. Divide the grid into tetrominoes (4-cell pieces)
 * 2. Tetrominoes of the same shape cannot share an edge
 * 3. All cells must be covered
 * 4. Numbers indicate constraints on adjacent tetrominoes
 */

import { Position } from '../core/types.js';
import { FieldState, Grid } from '../core/field.js';
import { BaseSolver, BranchCandidate } from '../core/solver.js';

// ============================================
// Tetrochain Types
// ============================================

type TetrominoShape = 'I' | 'O' | 'T' | 'S' | 'Z' | 'L' | 'J';

interface Tetromino {
  shape: TetrominoShape;
  cells: Position[];
}

// ============================================
// Tetrochain Field State
// ============================================

export class TetrochainField implements FieldState<TetrochainField> {
  readonly height: number;
  readonly width: number;
  /** Cell to tetromino assignment (-1 = unassigned) */
  private cellAssignment: Grid<number>;
  /** List of placed tetrominoes */
  private tetrominoes: Tetromino[];
  /** Number clues */
  private clues: Grid<number | null>;

  constructor(height: number, width: number) {
    this.height = height;
    this.width = width;
    this.cellAssignment = new Grid(height, width, () => -1);
    this.tetrominoes = [];
    this.clues = new Grid(height, width, () => null);
  }

  setClue(row: number, col: number, value: number): void {
    this.clues.set(row, col, value);
  }

  /** Get all possible tetromino placements starting from a cell */
  private getTetrominoCandidates(startRow: number, startCol: number): Tetromino[] {
    const candidates: Tetromino[] = [];

    // All 7 tetromino shapes with their relative offsets
    const shapes: { name: TetrominoShape; rotations: Position[][] }[] = [
      { name: 'I', rotations: [
        [{row: 0, col: 0}, {row: 0, col: 1}, {row: 0, col: 2}, {row: 0, col: 3}],
        [{row: 0, col: 0}, {row: 1, col: 0}, {row: 2, col: 0}, {row: 3, col: 0}],
      ]},
      { name: 'O', rotations: [
        [{row: 0, col: 0}, {row: 0, col: 1}, {row: 1, col: 0}, {row: 1, col: 1}],
      ]},
      { name: 'T', rotations: [
        [{row: 0, col: 0}, {row: 0, col: 1}, {row: 0, col: 2}, {row: 1, col: 1}],
        [{row: 0, col: 1}, {row: 1, col: 0}, {row: 1, col: 1}, {row: 2, col: 1}],
        [{row: 0, col: 1}, {row: 1, col: 0}, {row: 1, col: 1}, {row: 1, col: 2}],
        [{row: 0, col: 0}, {row: 1, col: 0}, {row: 1, col: 1}, {row: 2, col: 0}],
      ]},
      { name: 'S', rotations: [
        [{row: 0, col: 1}, {row: 0, col: 2}, {row: 1, col: 0}, {row: 1, col: 1}],
        [{row: 0, col: 0}, {row: 1, col: 0}, {row: 1, col: 1}, {row: 2, col: 1}],
      ]},
      { name: 'Z', rotations: [
        [{row: 0, col: 0}, {row: 0, col: 1}, {row: 1, col: 1}, {row: 1, col: 2}],
        [{row: 0, col: 1}, {row: 1, col: 0}, {row: 1, col: 1}, {row: 2, col: 0}],
      ]},
      { name: 'L', rotations: [
        [{row: 0, col: 0}, {row: 1, col: 0}, {row: 2, col: 0}, {row: 2, col: 1}],
        [{row: 0, col: 0}, {row: 0, col: 1}, {row: 0, col: 2}, {row: 1, col: 0}],
        [{row: 0, col: 0}, {row: 0, col: 1}, {row: 1, col: 1}, {row: 2, col: 1}],
        [{row: 0, col: 2}, {row: 1, col: 0}, {row: 1, col: 1}, {row: 1, col: 2}],
      ]},
      { name: 'J', rotations: [
        [{row: 0, col: 1}, {row: 1, col: 1}, {row: 2, col: 0}, {row: 2, col: 1}],
        [{row: 0, col: 0}, {row: 1, col: 0}, {row: 1, col: 1}, {row: 1, col: 2}],
        [{row: 0, col: 0}, {row: 0, col: 1}, {row: 1, col: 0}, {row: 2, col: 0}],
        [{row: 0, col: 0}, {row: 0, col: 1}, {row: 0, col: 2}, {row: 1, col: 2}],
      ]},
    ];

    for (const shape of shapes) {
      for (const rotation of shape.rotations) {
        // Try all positions where this rotation could include the start cell
        for (const offset of rotation) {
          const cells: Position[] = [];
          let valid = true;

          for (const cell of rotation) {
            const row = startRow - offset.row + cell.row;
            const col = startCol - offset.col + cell.col;

            if (row < 0 || row >= this.height || col < 0 || col >= this.width) {
              valid = false;
              break;
            }

            if (this.cellAssignment.get(row, col) !== -1) {
              valid = false;
              break;
            }

            cells.push({ row, col });
          }

          if (valid) {
            candidates.push({ shape: shape.name, cells });
          }
        }
      }
    }

    // Remove duplicates
    const seen = new Set<string>();
    return candidates.filter(t => {
      const key = t.cells.map(c => `${c.row},${c.col}`).sort().join(';') + ':' + t.shape;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /** Check if two tetrominoes of same shape are adjacent */
  private sameShapeAdjacent(): boolean {
    for (let i = 0; i < this.tetrominoes.length; i++) {
      for (let j = i + 1; j < this.tetrominoes.length; j++) {
        if (this.tetrominoes[i].shape !== this.tetrominoes[j].shape) continue;

        for (const cell1 of this.tetrominoes[i].cells) {
          for (const cell2 of this.tetrominoes[j].cells) {
            if (Math.abs(cell1.row - cell2.row) + Math.abs(cell1.col - cell2.col) === 1) {
              return true;
            }
          }
        }
      }
    }
    return false;
  }

  placeTetromino(tetromino: Tetromino): void {
    const index = this.tetrominoes.length;
    this.tetrominoes.push(tetromino);
    for (const cell of tetromino.cells) {
      this.cellAssignment.set(cell.row, cell.col, index);
    }
  }

  clone(): TetrochainField {
    const cloned = new TetrochainField(this.height, this.width);
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        cloned.cellAssignment.set(row, col, this.cellAssignment.get(row, col));
        cloned.clues.set(row, col, this.clues.get(row, col));
      }
    }
    cloned.tetrominoes = this.tetrominoes.map(t => ({
      shape: t.shape,
      cells: t.cells.map(c => ({ ...c })),
    }));
    return cloned;
  }

  getStateDump(): string {
    let dump = '';
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        dump += this.cellAssignment.get(row, col).toString(36);
      }
    }
    return dump;
  }

  isSolved(): boolean {
    // All cells must be assigned
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        if (this.cellAssignment.get(row, col) === -1) return false;
      }
    }

    // Same shapes cannot be adjacent
    if (this.sameShapeAdjacent()) return false;

    return true;
  }

  solveAndCheck(): boolean {
    if (this.sameShapeAdjacent()) return false;
    return true;
  }

  toString(): string {
    const lines: string[] = [];
    for (let row = 0; row < this.height; row++) {
      let line = '';
      for (let col = 0; col < this.width; col++) {
        const assign = this.cellAssignment.get(row, col);
        if (assign === -1) {
          line += '.';
        } else {
          line += this.tetrominoes[assign].shape;
        }
      }
      lines.push(line);
    }
    return lines.join('\n');
  }

  /** Get first unassigned cell */
  getFirstUnassignedCell(): Position | null {
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        if (this.cellAssignment.get(row, col) === -1) {
          return { row, col };
        }
      }
    }
    return null;
  }

  getCandidatesForCell(row: number, col: number): Tetromino[] {
    return this.getTetrominoCandidates(row, col);
  }
}

// ============================================
// Tetrochain Solver
// ============================================

export class TetrochainSolver extends BaseSolver<TetrochainField> {
  constructor(field: TetrochainField) {
    super(field);
  }

  static fromString(height: number, width: number, param: string): TetrochainSolver {
    const field = new TetrochainField(height, width);

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

    return new TetrochainSolver(field);
  }

  protected getBranchCandidates(state: TetrochainField): BranchCandidate<TetrochainField>[] {
    const unassigned = state.getFirstUnassignedCell();
    if (!unassigned) return [];

    const candidates = state.getCandidatesForCell(unassigned.row, unassigned.col);

    return candidates.map((tetromino) => ({
      apply: (s) => {
        const cloned = s.clone();
        cloned.placeTetromino(tetromino);
        return cloned;
      },
      description: `Place ${tetromino.shape} at (${unassigned.row},${unassigned.col})`,
    }));
  }
}
