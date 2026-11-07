/**
 * View (Viewpoint) Solver
 *
 * Rules:
 * 1. Divide the grid into white and black cells
 * 2. Numbers in white cells indicate the total count of continuous black cells
 *    visible in all 4 directions from that cell
 * 3. All white cells must be connected
 * 4. White cells with the same number cannot be orthogonally adjacent
 */

import { CellState, Position, posKey, DIRECTIONS, adjacent } from '../core/types.js';
import { FieldState, Grid } from '../core/field.js';
import { BaseSolver, BranchCandidate } from '../core/solver.js';

// ============================================
// View Field State
// ============================================

export class ViewField implements FieldState<ViewField> {
  readonly height: number;
  readonly width: number;
  /** Cell states */
  private cells: Grid<CellState>;
  /** Numbers (null = no clue, inferred numbers stored when determined) */
  private numbers: Grid<number | null>;
  /** Fixed positions (clue cells) */
  private fixedPosSet: Set<string>;

  constructor(height: number, width: number) {
    this.height = height;
    this.width = width;
    this.cells = new Grid(height, width, () => CellState.UNKNOWN);
    this.numbers = new Grid(height, width, () => null);
    this.fixedPosSet = new Set();
  }

  /** Set a clue cell */
  setClue(row: number, col: number, num: number | null): void {
    this.cells.set(row, col, CellState.WHITE);
    this.numbers.set(row, col, num);
    this.fixedPosSet.add(posKey({ row, col }));
  }

  /** Count continuous black cells in a direction */
  private countBlackInDirection(
    y: number,
    x: number,
    dy: number,
    dx: number
  ): { confirmed: number; possible: number } {
    let confirmed = 0;
    let possible = 0;
    let blackContinue = true;

    let ty = y + dy;
    let tx = x + dx;

    while (ty >= 0 && ty < this.height && tx >= 0 && tx < this.width) {
      const cell = this.cells.get(ty, tx);
      if (cell === CellState.WHITE) break;

      if (cell === CellState.UNKNOWN) {
        blackContinue = false;
      }

      if (blackContinue) {
        confirmed++;
      }
      possible++;

      ty += dy;
      tx += dx;
    }

    return { confirmed, possible };
  }

  /** Count constraint: check/update based on number clues */
  private countSolve(): boolean {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.cells.get(y, x) !== CellState.WHITE) continue;

        // Count in all 4 directions
        const up = this.countBlackInDirection(y, x, -1, 0);
        const right = this.countBlackInDirection(y, x, 0, 1);
        const down = this.countBlackInDirection(y, x, 1, 0);
        const left = this.countBlackInDirection(y, x, 0, -1);

        const blackCnt = up.confirmed + right.confirmed + down.confirmed + left.confirmed;
        const spaceCnt = up.possible + right.possible + down.possible + left.possible;

        const num = this.numbers.get(y, x);

        if (num === null) {
          // Infer number if all directions are determined
          if (blackCnt === spaceCnt) {
            this.numbers.set(y, x, blackCnt);
          }
        } else {
          // Check constraints
          if (num < blackCnt) return false; // Too many black
          if (num > spaceCnt) return false; // Not enough possible black

          // If confirmed equals number, stop extending black
          if (num === blackCnt) {
            this.stopBlackExtension(y, x, -1, 0);
            this.stopBlackExtension(y, x, 0, 1);
            this.stopBlackExtension(y, x, 1, 0);
            this.stopBlackExtension(y, x, 0, -1);
          }

          // If possible equals number, extend all to black
          if (num === spaceCnt) {
            this.extendBlack(y, x, -1, 0);
            this.extendBlack(y, x, 0, 1);
            this.extendBlack(y, x, 1, 0);
            this.extendBlack(y, x, 0, -1);
          }
        }
      }
    }
    return true;
  }

  /** Stop black extension in a direction (set first UNKNOWN after black to WHITE) */
  private stopBlackExtension(y: number, x: number, dy: number, dx: number): void {
    let ty = y + dy;
    let tx = x + dx;

    while (ty >= 0 && ty < this.height && tx >= 0 && tx < this.width) {
      const cell = this.cells.get(ty, tx);
      if (cell === CellState.WHITE) break;
      if (cell === CellState.UNKNOWN) {
        this.cells.set(ty, tx, CellState.WHITE);
        break;
      }
      ty += dy;
      tx += dx;
    }
  }

  /** Extend black cells in a direction */
  private extendBlack(y: number, x: number, dy: number, dx: number): void {
    let ty = y + dy;
    let tx = x + dx;

    while (ty >= 0 && ty < this.height && tx >= 0 && tx < this.width) {
      const cell = this.cells.get(ty, tx);
      if (cell === CellState.WHITE) break;
      if (cell === CellState.UNKNOWN) {
        this.cells.set(ty, tx, CellState.BLACK);
      }
      ty += dy;
      tx += dx;
    }
  }

  /** Adjacent same numbers are not allowed */
  private nextSolve(): boolean {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.cells.get(y, x) !== CellState.WHITE) continue;
        const num = this.numbers.get(y, x);
        if (num === null) continue;

        // Check adjacent white cells
        const neighbors: [number, number][] = [
          [y - 1, x],
          [y, x + 1],
          [y + 1, x],
          [y, x - 1],
        ];

        for (const [ny, nx] of neighbors) {
          if (ny < 0 || ny >= this.height || nx < 0 || nx >= this.width) continue;
          if (this.cells.get(ny, nx) === CellState.BLACK) continue;
          const neighborNum = this.numbers.get(ny, nx);
          if (neighborNum !== null && num === neighborNum) {
            return false;
          }
        }
      }
    }
    return true;
  }

  /** White cells must be connected */
  private connectSolve(): boolean {
    const whitePosSet = new Set<string>();
    let firstWhitePos: Position | null = null;

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.cells.get(y, x) === CellState.WHITE) {
          const pos = { row: y, col: x };
          if (!firstWhitePos) {
            firstWhitePos = pos;
            this.floodFillWhite(pos, whitePosSet);
          } else if (!whitePosSet.has(posKey(pos))) {
            return false;
          }
        }
      }
    }
    return true;
  }

  /** Flood fill through non-black cells */
  private floodFillWhite(pos: Position, visited: Set<string>): void {
    const key = posKey(pos);
    if (visited.has(key)) return;
    visited.add(key);

    for (const dir of DIRECTIONS) {
      const next = adjacent(pos, dir);
      if (next.row < 0 || next.row >= this.height || next.col < 0 || next.col >= this.width) {
        continue;
      }
      if (this.cells.get(next.row, next.col) !== CellState.BLACK) {
        this.floodFillWhite(next, visited);
      }
    }
  }

  // ========== FieldState implementation ==========

  clone(): ViewField {
    const cloned = new ViewField(this.height, this.width);
    for (const [pos, state] of this.cells.entries()) {
      cloned.cells.set(pos, state);
    }
    for (const [pos, num] of this.numbers.entries()) {
      cloned.numbers.set(pos, num);
    }
    cloned.fixedPosSet = new Set(this.fixedPosSet);
    return cloned;
  }

  getStateDump(): string {
    let dump = '';
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        dump += this.cells.get(y, x);
      }
    }
    return dump;
  }

  isSolved(): boolean {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.cells.get(y, x) === CellState.UNKNOWN) return false;
      }
    }
    return this.solveAndCheck();
  }

  solveAndCheck(): boolean {
    let changed = true;
    while (changed) {
      const befStr = this.getStateDump();
      if (!this.countSolve()) return false;
      changed = this.getStateDump() !== befStr;
    }

    if (!this.nextSolve()) return false;
    if (!this.connectSolve()) return false;

    return true;
  }

  toString(): string {
    const lines: string[] = [];
    for (let y = 0; y < this.height; y++) {
      let line = '';
      for (let x = 0; x < this.width; x++) {
        const cell = this.cells.get(y, x);
        const num = this.numbers.get(y, x);
        if (cell === CellState.BLACK) {
          line += '#';
        } else if (cell === CellState.WHITE) {
          line += num !== null ? String(num % 10) : '.';
        } else {
          line += '?';
        }
      }
      lines.push(line);
    }
    return lines.join('\n');
  }

  /** Get branching info */
  getBranchInfo(): { row: number; col: number } | null {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.cells.get(y, x) === CellState.UNKNOWN) {
          return { row: y, col: x };
        }
      }
    }
    return null;
  }

  /** Set cell state */
  setCell(row: number, col: number, state: CellState): void {
    this.cells.set(row, col, state);
  }
}

// ============================================
// View Solver
// ============================================

export class ViewSolver extends BaseSolver<ViewField> {
  constructor(field: ViewField) {
    super(field);
  }

  /** Create solver from pzprv3 URL parameter */
  static fromString(height: number, width: number, param: string): ViewSolver {
    const field = new ViewField(height, width);
    const ALPHABET_FROM_G = 'ghijklmnopqrstuvwxyz';

    let index = 0;
    for (let i = 0; i < param.length; i++) {
      const ch = param[i];
      const interval = ALPHABET_FROM_G.indexOf(ch);

      if (interval !== -1) {
        index = index + interval + 1;
      } else {
        const row = Math.floor(index / width);
        const col = index % width;

        if (row < height && col < width) {
          if (ch === '.') {
            field.setClue(row, col, null);
          } else {
            let num: number;
            if (ch === '-') {
              num = parseInt(param[i + 1] + param[i + 2], 16);
              i += 2;
            } else if (ch === '+') {
              num = parseInt(param[i + 1] + param[i + 2] + param[i + 3], 16);
              i += 3;
            } else {
              num = parseInt(ch, 16);
            }
            field.setClue(row, col, num);
          }
        }
        index++;
      }
    }

    return new ViewSolver(field);
  }

  protected getBranchCandidates(state: ViewField): BranchCandidate<ViewField>[] {
    const branchInfo = state.getBranchInfo();
    if (!branchInfo) return [];

    const { row, col } = branchInfo;

    return [
      {
        apply: (s) => {
          const cloned = s.clone();
          cloned.setCell(row, col, CellState.BLACK);
          return cloned;
        },
        description: `Set (${row}, ${col}) to BLACK`,
      },
      {
        apply: (s) => {
          const cloned = s.clone();
          cloned.setCell(row, col, CellState.WHITE);
          return cloned;
        },
        description: `Set (${row}, ${col}) to WHITE`,
      },
    ];
  }
}
