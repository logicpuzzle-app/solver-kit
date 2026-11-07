/**
 * Compass Solver
 *
 * Rules:
 * 1. Divide the grid into regions
 * 2. Each region contains exactly one compass
 * 3. Numbers on a compass indicate how many cells in that direction belong to its region
 *    - Up: cells strictly above the compass row
 *    - Down: cells strictly below the compass row
 *    - Left: cells strictly left of the compass column
 *    - Right: cells strictly right of the compass column
 * 4. All cells in a region must be orthogonally connected
 */

import {
  Position,
  Direction,
  posKey,
} from '../core/types.js';
import { FieldState, Grid } from '../core/field.js';
import { BaseSolver, BranchCandidate } from '../core/solver.js';

// ============================================
// Compass Types
// ============================================

export interface Compass {
  pos: Position;
  upCnt: number;    // -1 means unknown
  rightCnt: number;
  downCnt: number;
  leftCnt: number;
}

// ============================================
// Compass Field State
// ============================================

export class CompassField implements FieldState<CompassField> {
  readonly height: number;
  readonly width: number;
  /** Map of compass number to compass info */
  private compasses: Map<number, Compass>;
  /** Candidate numbers for each cell */
  private numbersCand: Grid<number[]>;

  constructor(height: number, width: number) {
    this.height = height;
    this.width = width;
    this.compasses = new Map();
    this.numbersCand = new Grid(height, width, () => []);
  }

  /** Add a compass */
  addCompass(number: number, pos: Position, upCnt: number, rightCnt: number, downCnt: number, leftCnt: number): void {
    this.compasses.set(number, { pos, upCnt, rightCnt, downCnt, leftCnt });
  }

  /** Initialize candidates after all compasses are added */
  initCandidates(): void {
    const compassNumbers = Array.from(this.compasses.keys());

    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        this.numbersCand.set(row, col, [...compassNumbers]);
      }
    }

    // Compass cells are fixed to their own number
    for (const [num, compass] of this.compasses) {
      this.numbersCand.set(compass.pos.row, compass.pos.col, [num]);
    }
  }

  /** Get candidates for a cell */
  getCandidates(row: number, col: number): number[] {
    return this.numbersCand.get(row, col);
  }

  /** Set candidates for a cell */
  setCandidates(row: number, col: number, cands: number[]): void {
    this.numbersCand.set(row, col, cands);
  }

  /** Remove a candidate from a cell */
  removeCandidate(row: number, col: number, num: number): boolean {
    const cands = this.numbersCand.get(row, col);
    const idx = cands.indexOf(num);
    if (idx !== -1) {
      cands.splice(idx, 1);
      return cands.length === 0;
    }
    return false;
  }

  /** Fix a cell to a specific number */
  fixCell(row: number, col: number, num: number): void {
    this.numbersCand.set(row, col, [num]);
  }

  // ========== Constraint solving ==========

  /** Check compass direction constraints */
  private numberSolve(): boolean {
    for (const [number, compass] of this.compasses) {
      // Up direction
      if (compass.upCnt !== -1) {
        let fixedCnt = 0;
        let candCnt = 0;
        for (let row = 0; row < compass.pos.row; row++) {
          for (let col = 0; col < this.width; col++) {
            const cands = this.numbersCand.get(row, col);
            if (cands.includes(number)) {
              if (cands.length === 1) fixedCnt++;
              else candCnt++;
            }
          }
        }
        if (fixedCnt > compass.upCnt) return false;
        if (fixedCnt + candCnt < compass.upCnt) return false;

        if (fixedCnt === compass.upCnt) {
          // Remove from non-fixed cells
          for (let row = 0; row < compass.pos.row; row++) {
            for (let col = 0; col < this.width; col++) {
              const cands = this.numbersCand.get(row, col);
              if (cands.includes(number) && cands.length !== 1) {
                if (this.removeCandidate(row, col, number)) return false;
              }
            }
          }
        }
        if (fixedCnt + candCnt === compass.upCnt) {
          // Fix all candidates
          for (let row = 0; row < compass.pos.row; row++) {
            for (let col = 0; col < this.width; col++) {
              const cands = this.numbersCand.get(row, col);
              if (cands.includes(number) && cands.length !== 1) {
                this.fixCell(row, col, number);
              }
            }
          }
        }
      }

      // Right direction
      if (compass.rightCnt !== -1) {
        let fixedCnt = 0;
        let candCnt = 0;
        for (let row = 0; row < this.height; row++) {
          for (let col = compass.pos.col + 1; col < this.width; col++) {
            const cands = this.numbersCand.get(row, col);
            if (cands.includes(number)) {
              if (cands.length === 1) fixedCnt++;
              else candCnt++;
            }
          }
        }
        if (fixedCnt > compass.rightCnt) return false;
        if (fixedCnt + candCnt < compass.rightCnt) return false;

        if (fixedCnt === compass.rightCnt) {
          for (let row = 0; row < this.height; row++) {
            for (let col = compass.pos.col + 1; col < this.width; col++) {
              const cands = this.numbersCand.get(row, col);
              if (cands.includes(number) && cands.length !== 1) {
                if (this.removeCandidate(row, col, number)) return false;
              }
            }
          }
        }
        if (fixedCnt + candCnt === compass.rightCnt) {
          for (let row = 0; row < this.height; row++) {
            for (let col = compass.pos.col + 1; col < this.width; col++) {
              const cands = this.numbersCand.get(row, col);
              if (cands.includes(number) && cands.length !== 1) {
                this.fixCell(row, col, number);
              }
            }
          }
        }
      }

      // Down direction
      if (compass.downCnt !== -1) {
        let fixedCnt = 0;
        let candCnt = 0;
        for (let row = compass.pos.row + 1; row < this.height; row++) {
          for (let col = 0; col < this.width; col++) {
            const cands = this.numbersCand.get(row, col);
            if (cands.includes(number)) {
              if (cands.length === 1) fixedCnt++;
              else candCnt++;
            }
          }
        }
        if (fixedCnt > compass.downCnt) return false;
        if (fixedCnt + candCnt < compass.downCnt) return false;

        if (fixedCnt === compass.downCnt) {
          for (let row = compass.pos.row + 1; row < this.height; row++) {
            for (let col = 0; col < this.width; col++) {
              const cands = this.numbersCand.get(row, col);
              if (cands.includes(number) && cands.length !== 1) {
                if (this.removeCandidate(row, col, number)) return false;
              }
            }
          }
        }
        if (fixedCnt + candCnt === compass.downCnt) {
          for (let row = compass.pos.row + 1; row < this.height; row++) {
            for (let col = 0; col < this.width; col++) {
              const cands = this.numbersCand.get(row, col);
              if (cands.includes(number) && cands.length !== 1) {
                this.fixCell(row, col, number);
              }
            }
          }
        }
      }

      // Left direction
      if (compass.leftCnt !== -1) {
        let fixedCnt = 0;
        let candCnt = 0;
        for (let row = 0; row < this.height; row++) {
          for (let col = 0; col < compass.pos.col; col++) {
            const cands = this.numbersCand.get(row, col);
            if (cands.includes(number)) {
              if (cands.length === 1) fixedCnt++;
              else candCnt++;
            }
          }
        }
        if (fixedCnt > compass.leftCnt) return false;
        if (fixedCnt + candCnt < compass.leftCnt) return false;

        if (fixedCnt === compass.leftCnt) {
          for (let row = 0; row < this.height; row++) {
            for (let col = 0; col < compass.pos.col; col++) {
              const cands = this.numbersCand.get(row, col);
              if (cands.includes(number) && cands.length !== 1) {
                if (this.removeCandidate(row, col, number)) return false;
              }
            }
          }
        }
        if (fixedCnt + candCnt === compass.leftCnt) {
          for (let row = 0; row < this.height; row++) {
            for (let col = 0; col < compass.pos.col; col++) {
              const cands = this.numbersCand.get(row, col);
              if (cands.includes(number) && cands.length !== 1) {
                this.fixCell(row, col, number);
              }
            }
          }
        }
      }
    }
    return true;
  }

  /** Check connectivity - cells must be reachable from compass */
  private connectSolve(): boolean {
    for (const [number, compass] of this.compasses) {
      const reachable = new Set<string>();
      const startPos = compass.pos;
      reachable.add(posKey(startPos));
      this.setContinuePosSet(number, startPos, reachable, null);

      for (let row = 0; row < this.height; row++) {
        for (let col = 0; col < this.width; col++) {
          if (!reachable.has(posKey({ row, col }))) {
            if (this.removeCandidate(row, col, number)) return false;
          }
        }
      }
    }
    return true;
  }

  /** Flood fill cells that can belong to a number */
  private setContinuePosSet(number: number, pos: Position, continuePosSet: Set<string>, from: Direction | null): void {
    const { row, col } = pos;

    if (row > 0 && from !== Direction.UP) {
      const nextPos = { row: row - 1, col };
      if (!continuePosSet.has(posKey(nextPos)) && this.numbersCand.get(row - 1, col).includes(number)) {
        continuePosSet.add(posKey(nextPos));
        this.setContinuePosSet(number, nextPos, continuePosSet, Direction.DOWN);
      }
    }

    if (col < this.width - 1 && from !== Direction.RIGHT) {
      const nextPos = { row, col: col + 1 };
      if (!continuePosSet.has(posKey(nextPos)) && this.numbersCand.get(row, col + 1).includes(number)) {
        continuePosSet.add(posKey(nextPos));
        this.setContinuePosSet(number, nextPos, continuePosSet, Direction.LEFT);
      }
    }

    if (row < this.height - 1 && from !== Direction.DOWN) {
      const nextPos = { row: row + 1, col };
      if (!continuePosSet.has(posKey(nextPos)) && this.numbersCand.get(row + 1, col).includes(number)) {
        continuePosSet.add(posKey(nextPos));
        this.setContinuePosSet(number, nextPos, continuePosSet, Direction.UP);
      }
    }

    if (col > 0 && from !== Direction.LEFT) {
      const nextPos = { row, col: col - 1 };
      if (!continuePosSet.has(posKey(nextPos)) && this.numbersCand.get(row, col - 1).includes(number)) {
        continuePosSet.add(posKey(nextPos));
        this.setContinuePosSet(number, nextPos, continuePosSet, Direction.RIGHT);
      }
    }
  }

  // ========== FieldState implementation ==========

  clone(): CompassField {
    const cloned = new CompassField(this.height, this.width);
    cloned.compasses = this.compasses; // Shared (immutable)
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        cloned.numbersCand.set(row, col, [...this.numbersCand.get(row, col)]);
      }
    }
    return cloned;
  }

  getStateDump(): string {
    let dump = '';
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        dump += this.numbersCand.get(row, col).length.toString();
      }
    }
    return dump;
  }

  isSolved(): boolean {
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        if (this.numbersCand.get(row, col).length !== 1) return false;
      }
    }
    return this.solveAndCheck();
  }

  solveAndCheck(): boolean {
    let changed = true;
    while (changed) {
      const beforeDump = this.getStateDump();

      if (!this.numberSolve()) return false;
      if (!this.connectSolve()) return false;

      changed = this.getStateDump() !== beforeDump;
    }
    return true;
  }

  toString(): string {
    const lines: string[] = [];
    for (let row = 0; row < this.height; row++) {
      let line = '';
      for (let col = 0; col < this.width; col++) {
        const cands = this.numbersCand.get(row, col);
        if (cands.length === 0) {
          line += '×';
        } else if (cands.length === 1) {
          line += cands[0].toString(36);
        } else {
          line += '?';
        }
      }
      lines.push(line);
    }
    return lines.join('\n');
  }

  /** Get cells with multiple candidates for branching */
  getUnfixedCells(): Array<{ row: number; col: number; cands: number[] }> {
    const unfixed: Array<{ row: number; col: number; cands: number[] }> = [];
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        const cands = this.numbersCand.get(row, col);
        if (cands.length > 1) {
          unfixed.push({ row, col, cands: [...cands] });
        }
      }
    }
    return unfixed;
  }
}

// ============================================
// Compass Solver
// ============================================

export class CompassSolver extends BaseSolver<CompassField> {
  constructor(field: CompassField) {
    super(field);
  }

  /** Create solver from pzv.jp URL format */
  static fromString(height: number, width: number, param: string): CompassSolver {
    const field = new CompassField(height, width);
    const ALPHABET_FROM_G = 'ghijklmnopqrstuvwxyz';

    let index = 0;
    let compassNum = 0;

    const parseNum = (param: string, i: number): { val: number; skip: number } => {
      const ch = param[i];
      if (ch === '.') {
        return { val: -1, skip: 0 };
      } else if (ch === '-') {
        return { val: parseInt(param.substring(i + 1, i + 3), 16), skip: 2 };
      } else if (ch === '+') {
        return { val: parseInt(param.substring(i + 1, i + 4), 16), skip: 3 };
      } else {
        return { val: parseInt(ch, 16), skip: 0 };
      }
    };

    for (let i = 0; i < param.length && index < height * width; ) {
      const ch = param[i];
      const interval = ALPHABET_FROM_G.indexOf(ch);

      if (interval !== -1) {
        index += interval + 1;
        i++;
      } else {
        const row = Math.floor(index / width);
        const col = index % width;

        // Parse 4 numbers: up, down, left, right
        const up = parseNum(param, i);
        i += 1 + up.skip;
        const down = parseNum(param, i);
        i += 1 + down.skip;
        const left = parseNum(param, i);
        i += 1 + left.skip;
        const right = parseNum(param, i);
        i += 1 + right.skip;

        field.addCompass(compassNum, { row, col }, up.val, right.val, down.val, left.val);
        compassNum++;
        index++;
      }
    }

    field.initCandidates();
    return new CompassSolver(field);
  }

  protected getBranchCandidates(state: CompassField): BranchCandidate<CompassField>[] {
    const unfixed = state.getUnfixedCells();
    if (unfixed.length === 0) return [];

    // Pick cell with fewest candidates
    unfixed.sort((a, b) => a.cands.length - b.cands.length);
    const cell = unfixed[0];

    return cell.cands.map((num) => ({
      apply: (s) => {
        const cloned = s.clone();
        cloned.fixCell(cell.row, cell.col, num);
        return cloned;
      },
      description: `Set (${cell.row}, ${cell.col}) to region ${num}`,
    }));
  }
}
