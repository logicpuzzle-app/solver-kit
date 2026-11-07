/**
 * Sukoro Solver
 *
 * Rules:
 * 1. Fill each white cell with a number 1-4 (or leave empty)
 * 2. Each number N indicates exactly N adjacent cells contain numbers (not empty)
 * 3. Same numbers cannot be orthogonally adjacent
 * 4. All numbered cells must be connected
 */

import { Position, posKey, DIRECTIONS, adjacent } from '../core/types.js';
import { FieldState, Grid } from '../core/field.js';
import { BaseSolver, BranchCandidate } from '../core/solver.js';

// ============================================
// Sukoro Cell State
// ============================================

export type SukoroCellState = number | 'empty' | 'unknown';

// ============================================
// Sukoro Field State
// ============================================

export class SukoroField implements FieldState<SukoroField> {
  readonly height: number;
  readonly width: number;
  /** Cell states: number (1-4), 'empty', or 'unknown' */
  private cells: Grid<SukoroCellState>;
  /** Candidates for each cell */
  private candidates: Grid<(number | 'empty')[]>;
  /** Clue cells (initial numbers) */
  private clues: Grid<number | null>;

  constructor(height: number, width: number) {
    this.height = height;
    this.width = width;
    this.cells = new Grid(height, width, () => 'unknown');
    this.candidates = new Grid(height, width, () => [1, 2, 3, 4, 'empty']);
    this.clues = new Grid(height, width, () => null);
  }

  /** Set a clue number */
  setClue(row: number, col: number, num: number): void {
    this.clues.set(row, col, num);
    this.cells.set(row, col, num);
    this.candidates.set(row, col, [num]);
  }

  /** Get adjacent cells */
  private getAdjacentCells(pos: Position): Position[] {
    const result: Position[] = [];
    for (const dir of DIRECTIONS) {
      const adj = adjacent(pos, dir);
      if (adj.row >= 0 && adj.row < this.height && adj.col >= 0 && adj.col < this.width) {
        result.push(adj);
      }
    }
    return result;
  }

  /** Count adjacent numbered cells (confirmed and possible) */
  private countAdjacentNumbered(
    y: number,
    x: number
  ): { confirmed: number; possible: number } {
    let confirmed = 0;
    let possible = 0;

    for (const adj of this.getAdjacentCells({ row: y, col: x })) {
      const cell = this.cells.get(adj.row, adj.col);
      if (typeof cell === 'number') {
        confirmed++;
        possible++;
      } else if (cell === 'unknown') {
        possible++;
      }
    }

    return { confirmed, possible };
  }

  /** Number constraint: each number N has exactly N adjacent numbered cells */
  private numberSolve(): boolean {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const cell = this.cells.get(y, x);
        if (typeof cell !== 'number') continue;

        const { confirmed, possible } = this.countAdjacentNumbered(y, x);

        // Check constraints
        if (cell < confirmed) return false; // Too many adjacent numbers
        if (cell > possible) return false; // Not enough possible adjacent numbers

        const adjacents = this.getAdjacentCells({ row: y, col: x });

        // If confirmed equals the number, remaining unknowns must be empty
        if (cell === confirmed) {
          for (const adj of adjacents) {
            if (this.cells.get(adj.row, adj.col) === 'unknown') {
              this.cells.set(adj.row, adj.col, 'empty');
              this.candidates.set(adj.row, adj.col, ['empty']);
            }
          }
        }

        // If possible equals the number, all unknowns must be numbered
        if (cell === possible) {
          for (const adj of adjacents) {
            if (this.cells.get(adj.row, adj.col) === 'unknown') {
              // Remove 'empty' from candidates
              const cands = this.candidates.get(adj.row, adj.col);
              const filtered = cands.filter((c) => c !== 'empty') as (number | 'empty')[];
              if (filtered.length === 0) return false;
              this.candidates.set(adj.row, adj.col, filtered);
              if (filtered.length === 1) {
                this.cells.set(adj.row, adj.col, filtered[0]);
              }
            }
          }
        }
      }
    }
    return true;
  }

  /** Adjacent constraint: same numbers cannot be adjacent */
  private adjacentSolve(): boolean {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const cell = this.cells.get(y, x);
        if (typeof cell !== 'number') continue;

        // Eliminate same number from adjacent cells
        for (const adj of this.getAdjacentCells({ row: y, col: x })) {
          const adjCell = this.cells.get(adj.row, adj.col);
          if (typeof adjCell === 'number') {
            if (adjCell === cell) return false; // Same numbers adjacent
          } else if (adjCell === 'unknown') {
            const cands = this.candidates.get(adj.row, adj.col);
            const filtered = cands.filter((c) => c !== cell);
            if (filtered.length === 0) return false;
            this.candidates.set(adj.row, adj.col, filtered);
            if (filtered.length === 1) {
              this.cells.set(adj.row, adj.col, filtered[0]);
            }
          }
        }
      }
    }
    return true;
  }

  /** Candidate constraint: apply candidate to cell state */
  private candidateSolve(): boolean {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.cells.get(y, x) !== 'unknown') continue;

        const cands = this.candidates.get(y, x);
        if (cands.length === 0) return false;
        if (cands.length === 1) {
          this.cells.set(y, x, cands[0]);
        }

        // Check if any number is impossible due to adjacent count constraint
        const { confirmed, possible } = this.countAdjacentNumbered(y, x);
        const adjacentCount = this.getAdjacentCells({ row: y, col: x }).length;

        const filtered = cands.filter((c) => {
          if (c === 'empty') return true;
          // A number N is valid if confirmed <= N <= possible AND N <= adjacentCount
          return c >= confirmed && c <= possible && c <= adjacentCount;
        });

        if (filtered.length === 0) return false;
        this.candidates.set(y, x, filtered);
        if (filtered.length === 1) {
          this.cells.set(y, x, filtered[0]);
        }
      }
    }
    return true;
  }

  /** Connection constraint: all numbered cells must be connected */
  private connectSolve(): boolean {
    const numberedPositions: Position[] = [];
    let firstNumbered: Position | null = null;

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (typeof this.cells.get(y, x) === 'number') {
          const pos = { row: y, col: x };
          numberedPositions.push(pos);
          if (!firstNumbered) {
            firstNumbered = pos;
          }
        }
      }
    }

    if (numberedPositions.length === 0) return true;

    // BFS from first numbered cell through numbered and unknown cells
    const visited = new Set<string>();
    const queue: Position[] = [firstNumbered!];

    while (queue.length > 0) {
      const pos = queue.shift()!;
      const key = posKey(pos);
      if (visited.has(key)) continue;
      visited.add(key);

      for (const adj of this.getAdjacentCells(pos)) {
        const adjCell = this.cells.get(adj.row, adj.col);
        if (adjCell === 'empty') continue;
        if (!visited.has(posKey(adj))) {
          queue.push(adj);
        }
      }
    }

    // Check if all numbered cells are reachable
    for (const pos of numberedPositions) {
      if (!visited.has(posKey(pos))) {
        return false;
      }
    }

    return true;
  }

  // ========== FieldState implementation ==========

  clone(): SukoroField {
    const cloned = new SukoroField(this.height, this.width);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        cloned.cells.set(y, x, this.cells.get(y, x));
        cloned.candidates.set(y, x, [...this.candidates.get(y, x)]);
        cloned.clues.set(y, x, this.clues.get(y, x));
      }
    }
    return cloned;
  }

  getStateDump(): string {
    let dump = '';
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const cell = this.cells.get(y, x);
        dump += typeof cell === 'number' ? cell : cell === 'empty' ? 'e' : '?';
      }
    }
    return dump;
  }

  isSolved(): boolean {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.cells.get(y, x) === 'unknown') return false;
      }
    }
    return this.solveAndCheck();
  }

  solveAndCheck(): boolean {
    let changed = true;
    while (changed) {
      const befStr = this.getStateDump();
      if (!this.candidateSolve()) return false;
      if (!this.numberSolve()) return false;
      if (!this.adjacentSolve()) return false;
      changed = this.getStateDump() !== befStr;
    }

    if (!this.connectSolve()) return false;

    return true;
  }

  toString(): string {
    const lines: string[] = [];
    for (let y = 0; y < this.height; y++) {
      let line = '';
      for (let x = 0; x < this.width; x++) {
        const cell = this.cells.get(y, x);
        if (typeof cell === 'number') {
          line += String(cell);
        } else if (cell === 'empty') {
          line += '.';
        } else {
          line += '?';
        }
      }
      lines.push(line);
    }
    return lines.join('\n');
  }

  /** Get branching info */
  getBranchInfo(): { row: number; col: number; candidates: (number | 'empty')[] } | null {
    let minCount = Infinity;
    let bestPos: { row: number; col: number } | null = null;

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.cells.get(y, x) !== 'unknown') continue;
        const count = this.candidates.get(y, x).length;
        if (count > 1 && count < minCount) {
          minCount = count;
          bestPos = { row: y, col: x };
        }
      }
    }

    if (!bestPos) return null;
    return {
      row: bestPos.row,
      col: bestPos.col,
      candidates: this.candidates.get(bestPos.row, bestPos.col),
    };
  }

  /** Set cell to specific value */
  setCell(row: number, col: number, value: number | 'empty'): void {
    this.cells.set(row, col, value);
    this.candidates.set(row, col, [value]);
  }
}

// ============================================
// Sukoro Solver
// ============================================

export class SukoroSolver extends BaseSolver<SukoroField> {
  constructor(field: SukoroField) {
    super(field);
  }

  /** Create solver from pzprv3 URL parameter */
  static fromString(height: number, width: number, param: string): SukoroSolver {
    const field = new SukoroField(height, width);

    const ALPHABET_FROM_G = 'ghijklmnopqrstuvwxyz';
    let index = 0;

    for (let i = 0; i < param.length; i++) {
      const ch = param[i];
      const interval = ALPHABET_FROM_G.indexOf(ch);

      if (interval !== -1) {
        index += interval + 1;
      } else {
        const row = Math.floor(index / width);
        const col = index % width;

        if (row < height && col < width) {
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
          if (!isNaN(num) && num >= 1 && num <= 4) {
            field.setClue(row, col, num);
          }
        }
        index++;
      }
    }

    return new SukoroSolver(field);
  }

  protected getBranchCandidates(state: SukoroField): BranchCandidate<SukoroField>[] {
    const branchInfo = state.getBranchInfo();
    if (!branchInfo) return [];

    const { row, col, candidates } = branchInfo;

    return candidates.map((cand) => ({
      apply: (s) => {
        const cloned = s.clone();
        cloned.setCell(row, col, cand);
        return cloned;
      },
      description: `Set (${row}, ${col}) to ${cand}`,
    }));
  }
}
