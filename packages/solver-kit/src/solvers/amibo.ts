/**
 * Amibo Solver
 *
 * Rules:
 * 1. Each cell can be: empty (0), vertical bar (1), horizontal bar (2), or cross (3)
 * 2. Circles (with optional numbers) must connect to exactly one bar
 * 3. Numbered circles indicate the length of the bar extending from them
 * 4. Bars must cross other bars of the same length
 */

import { FieldState, Grid } from '../core/field.js';
import { BaseSolver, BranchCandidate } from '../core/solver.js';

// ============================================
// Amibo Types
// ============================================

/** Cell types: 0=empty, 1=vertical, 2=horizontal, 3=cross */
type AmiboCell = 0 | 1 | 2 | 3;

// ============================================
// Amibo Field State
// ============================================

export class AmiboField implements FieldState<AmiboField> {
  readonly height: number;
  readonly width: number;
  /** Number clues: null=no circle, -1=circle without number, n=circle with number n */
  private numbers: Grid<number | null>;
  /** Cell candidates */
  private cellCand: number[][][];

  constructor(height: number, width: number) {
    this.height = height;
    this.width = width;
    this.numbers = new Grid(height, width, () => null);
    this.cellCand = Array.from({ length: height }, () =>
      Array.from({ length: width }, () => [0, 1, 2, 3])
    );
  }

  /** Parse puzzle from pzv.jp format */
  parseParam(param: string): void {
    const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';
    const ALPHABET_FROM_G = 'ghijklmnopqrstuvwxyz';

    let useAlphabet = ALPHABET;
    let readPos = 0;
    let index = 0;

    if (param.charAt(0) === '-') {
      readPos++;
      useAlphabet = ALPHABET_FROM_G;
    }

    for (let i = readPos; i < param.length; i++) {
      const ch = param.charAt(i);
      const interval = useAlphabet.indexOf(ch);

      if (interval !== -1) {
        index += interval + 1;
      } else if (ch === '.') {
        const row = Math.floor(index / this.width);
        const col = index % this.width;
        if (row < this.height) {
          this.numbers.set(row, col, -1);
          // Circle cells are empty (no bar)
          this.cellCand[row][col] = [0];
        }
        index++;
      } else {
        let num: number;
        if (ch === '-') {
          num = parseInt(param.substring(i + 1, i + 3), 16);
          i += 2;
        } else if (ch === '+') {
          num = parseInt(param.substring(i + 1, i + 4), 16);
          i += 3;
        } else {
          num = parseInt(ch, 16);
        }

        const row = Math.floor(index / this.width);
        const col = index % this.width;
        if (row < this.height) {
          this.numbers.set(row, col, num);
          // Circle cells are empty (no bar)
          this.cellCand[row][col] = [0];
        }
        index++;
      }
    }
  }

  /** Get candidates for a cell */
  getCandidates(row: number, col: number): number[] {
    return this.cellCand[row][col];
  }

  /** Set cell to specific value */
  setCell(row: number, col: number, value: AmiboCell): void {
    this.cellCand[row][col] = [value];
  }

  /** Remove a candidate from a cell */
  removeCandidate(row: number, col: number, value: number): void {
    const idx = this.cellCand[row][col].indexOf(value);
    if (idx !== -1) {
      this.cellCand[row][col].splice(idx, 1);
    }
  }

  // ========== Connection helpers ==========

  /** Check if cell can connect upward (has vertical or cross) */
  private canConnectUp(row: number, col: number): boolean | null {
    if (row <= 0) return false;
    const cands = this.cellCand[row - 1][col];
    const canConnect = cands.includes(1) || cands.includes(3);
    const cannotConnect = cands.includes(0) || cands.includes(2);
    if (canConnect && cannotConnect) return null; // Unknown
    return canConnect;
  }

  /** Check if cell can connect rightward (has horizontal or cross) */
  private canConnectRight(row: number, col: number): boolean | null {
    if (col >= this.width - 1) return false;
    const cands = this.cellCand[row][col + 1];
    const canConnect = cands.includes(2) || cands.includes(3);
    const cannotConnect = cands.includes(0) || cands.includes(1);
    if (canConnect && cannotConnect) return null;
    return canConnect;
  }

  /** Check if cell can connect downward (has vertical or cross) */
  private canConnectDown(row: number, col: number): boolean | null {
    if (row >= this.height - 1) return false;
    const cands = this.cellCand[row + 1][col];
    const canConnect = cands.includes(1) || cands.includes(3);
    const cannotConnect = cands.includes(0) || cands.includes(2);
    if (canConnect && cannotConnect) return null;
    return canConnect;
  }

  /** Check if cell can connect leftward (has horizontal or cross) */
  private canConnectLeft(row: number, col: number): boolean | null {
    if (col <= 0) return false;
    const cands = this.cellCand[row][col - 1];
    const canConnect = cands.includes(2) || cands.includes(3);
    const cannotConnect = cands.includes(0) || cands.includes(1);
    if (canConnect && cannotConnect) return null;
    return canConnect;
  }

  // ========== Constraint solving ==========

  /**
   * Circle constraint: each circle must connect to exactly one bar
   */
  private nextSolve(): boolean {
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        const num = this.numbers.get(row, col);
        if (num === null) continue;

        const up = this.canConnectUp(row, col);
        const right = this.canConnectRight(row, col);
        const down = this.canConnectDown(row, col);
        const left = this.canConnectLeft(row, col);

        // Count definite connections
        let definiteCount = 0;
        let possibleCount = 0;
        if (up === true) definiteCount++;
        else if (up !== false) possibleCount++;
        if (right === true) definiteCount++;
        else if (right !== false) possibleCount++;
        if (down === true) definiteCount++;
        else if (down !== false) possibleCount++;
        if (left === true) definiteCount++;
        else if (left !== false) possibleCount++;

        // Must have exactly one connection
        if (definiteCount > 1) return false;
        if (definiteCount === 0 && possibleCount === 0) return false;

        // If one definite, others must not connect
        if (definiteCount === 1) {
          if (up === null) {
            this.removeCandidate(row - 1, col, 1);
            this.removeCandidate(row - 1, col, 3);
          }
          if (right === null) {
            this.removeCandidate(row, col + 1, 2);
            this.removeCandidate(row, col + 1, 3);
          }
          if (down === null) {
            this.removeCandidate(row + 1, col, 1);
            this.removeCandidate(row + 1, col, 3);
          }
          if (left === null) {
            this.removeCandidate(row, col - 1, 2);
            this.removeCandidate(row, col - 1, 3);
          }
        }

        // If only one possible, it must connect
        if (definiteCount === 0 && possibleCount === 1) {
          if (up === null) {
            this.removeCandidate(row - 1, col, 0);
            this.removeCandidate(row - 1, col, 2);
          }
          if (right === null) {
            this.removeCandidate(row, col + 1, 0);
            this.removeCandidate(row, col + 1, 1);
          }
          if (down === null) {
            this.removeCandidate(row + 1, col, 0);
            this.removeCandidate(row + 1, col, 2);
          }
          if (left === null) {
            this.removeCandidate(row, col - 1, 0);
            this.removeCandidate(row, col - 1, 1);
          }
        }
      }
    }
    return true;
  }

  /**
   * Number constraint: numbered circles have bars of specific length
   */
  private numberSolve(): boolean {
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        const num = this.numbers.get(row, col);
        if (num === null || num === -1) continue;

        // Count how far bars can extend in each direction
        const countDir = (
          dr: number,
          dc: number,
          barType: number
        ): { definite: number; possible: number } => {
          let definite = 0;
          let possible = 0;
          let r = row + dr;
          let c = col + dc;
          let foundUncertain = false;

          while (r >= 0 && r < this.height && c >= 0 && c < this.width) {
            const cands = this.cellCand[r][c];
            const canHaveBar = cands.includes(barType) || cands.includes(3);
            const mustHaveBar =
              !cands.includes(0) &&
              !cands.includes(barType === 1 ? 2 : 1);

            if (!canHaveBar) break;

            if (mustHaveBar && !foundUncertain) {
              definite++;
            }
            if (!mustHaveBar) {
              foundUncertain = true;
            }
            possible++;

            r += dr;
            c += dc;
          }

          return { definite, possible };
        };

        const upStats = countDir(-1, 0, 1);
        const downStats = countDir(1, 0, 1);
        const leftStats = countDir(0, -1, 2);
        const rightStats = countDir(0, 1, 2);

        // Check if any direction is too long
        if (
          upStats.definite > num ||
          downStats.definite > num ||
          leftStats.definite > num ||
          rightStats.definite > num
        ) {
          return false;
        }

        // Check if bar can reach required length
        if (
          upStats.possible < num &&
          downStats.possible < num &&
          leftStats.possible < num &&
          rightStats.possible < num
        ) {
          return false;
        }

        // If only one direction is possible, extend the bar
        const viableDirections = [
          upStats.possible >= num,
          rightStats.possible >= num,
          downStats.possible >= num,
          leftStats.possible >= num,
        ].filter(Boolean).length;

        if (viableDirections === 1) {
          if (upStats.possible >= num) {
            for (let i = 1; i <= num; i++) {
              this.removeCandidate(row - i, col, 0);
              this.removeCandidate(row - i, col, 2);
              if (this.cellCand[row - i][col].length === 0) return false;
            }
            if (row - num - 1 >= 0) {
              this.removeCandidate(row - num - 1, col, 1);
              this.removeCandidate(row - num - 1, col, 3);
              if (this.cellCand[row - num - 1][col].length === 0) return false;
            }
          } else if (rightStats.possible >= num) {
            for (let i = 1; i <= num; i++) {
              this.removeCandidate(row, col + i, 0);
              this.removeCandidate(row, col + i, 1);
              if (this.cellCand[row][col + i].length === 0) return false;
            }
            if (col + num + 1 < this.width) {
              this.removeCandidate(row, col + num + 1, 2);
              this.removeCandidate(row, col + num + 1, 3);
              if (this.cellCand[row][col + num + 1].length === 0) return false;
            }
          } else if (downStats.possible >= num) {
            for (let i = 1; i <= num; i++) {
              this.removeCandidate(row + i, col, 0);
              this.removeCandidate(row + i, col, 2);
              if (this.cellCand[row + i][col].length === 0) return false;
            }
            if (row + num + 1 < this.height) {
              this.removeCandidate(row + num + 1, col, 1);
              this.removeCandidate(row + num + 1, col, 3);
              if (this.cellCand[row + num + 1][col].length === 0) return false;
            }
          } else if (leftStats.possible >= num) {
            for (let i = 1; i <= num; i++) {
              this.removeCandidate(row, col - i, 0);
              this.removeCandidate(row, col - i, 1);
              if (this.cellCand[row][col - i].length === 0) return false;
            }
            if (col - num - 1 >= 0) {
              this.removeCandidate(row, col - num - 1, 2);
              this.removeCandidate(row, col - num - 1, 3);
              if (this.cellCand[row][col - num - 1].length === 0) return false;
            }
          }
        }
      }
    }
    return true;
  }

  // ========== FieldState implementation ==========

  clone(): AmiboField {
    const cloned = new AmiboField(this.height, this.width);
    for (const [pos, val] of this.numbers.entries()) {
      cloned.numbers.set(pos, val);
    }
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        cloned.cellCand[row][col] = [...this.cellCand[row][col]];
      }
    }
    return cloned;
  }

  getStateDump(): string {
    let dump = '';
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        dump += this.cellCand[row][col].length + ',';
      }
    }
    return dump;
  }

  isSolved(): boolean {
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        if (this.cellCand[row][col].length !== 1) return false;
      }
    }
    return this.solveAndCheck();
  }

  solveAndCheck(): boolean {
    const beforeState = this.getStateDump();

    if (!this.nextSolve()) return false;
    if (!this.numberSolve()) return false;

    // Check for empty candidates
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        if (this.cellCand[row][col].length === 0) return false;
      }
    }

    if (this.getStateDump() !== beforeState) {
      return this.solveAndCheck();
    }

    return true;
  }

  toString(): string {
    const lines: string[] = [];
    for (let row = 0; row < this.height; row++) {
      let line = '';
      for (let col = 0; col < this.width; col++) {
        const num = this.numbers.get(row, col);
        if (num !== null) {
          line += num === -1 ? '○' : String(num);
        } else {
          const cands = this.cellCand[row][col];
          if (cands.length === 1) {
            line += cands[0] === 0 ? '・' : cands[0] === 1 ? '│' : cands[0] === 2 ? '─' : '┼';
          } else {
            line += '?';
          }
        }
      }
      lines.push(line);
    }
    return lines.join('\n');
  }

  /** Get unknown cells for branching */
  getUnknownCells(): Array<{ row: number; col: number; cands: number[] }> {
    const unknowns: Array<{ row: number; col: number; cands: number[] }> = [];
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        if (this.cellCand[row][col].length > 1) {
          unknowns.push({ row, col, cands: this.cellCand[row][col] });
        }
      }
    }
    unknowns.sort((a, b) => a.cands.length - b.cands.length);
    return unknowns;
  }
}

// ============================================
// Amibo Solver
// ============================================

export class AmiboSolver extends BaseSolver<AmiboField> {
  constructor(field: AmiboField) {
    super(field);
  }

  /** Create solver from pzv.jp URL format */
  static fromURL(height: number, width: number, param: string): AmiboSolver {
    const field = new AmiboField(height, width);
    field.parseParam(param);
    return new AmiboSolver(field);
  }

  protected getBranchCandidates(state: AmiboField): BranchCandidate<AmiboField>[] {
    const unknowns = state.getUnknownCells();
    if (unknowns.length === 0) return [];

    const cell = unknowns[0];

    return cell.cands.map((value) => ({
      apply: (s) => {
        const cloned = s.clone();
        cloned.setCell(cell.row, cell.col, value as AmiboCell);
        return cloned;
      },
      description: `Set (${cell.row}, ${cell.col}) to ${value}`,
    }));
  }
}
