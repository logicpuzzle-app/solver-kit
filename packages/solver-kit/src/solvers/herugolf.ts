/**
 * Herugolf (Golf) Solver
 *
 * Rules:
 * 1. Draw paths from each ball to a hole
 * 2. Numbers on balls indicate the number of moves to reach the hole
 * 3. The ball moves in a straight line until it hits a wall or obstacle
 * 4. Paths cannot cross each other
 */

import { Position } from '../core/types.js';
import { FieldState, Grid } from '../core/field.js';
import { BaseSolver, BranchCandidate } from '../core/solver.js';

// ============================================
// Herugolf Types
// ============================================

export enum HerugolfCell {
  EMPTY = 0,
  WALL = 1,
  HOLE = 2,
  BALL = 3,
}

// ============================================
// Herugolf Field State
// ============================================

export class HerugolfField implements FieldState<HerugolfField> {
  readonly height: number;
  readonly width: number;
  /** Cell types */
  private cells: Grid<HerugolfCell>;
  /** Ball hit counts */
  private ballHits: Grid<number | null>;
  /** Path assignments (ball index) */
  private pathAssignment: Grid<number>;

  constructor(height: number, width: number) {
    this.height = height;
    this.width = width;
    this.cells = new Grid(height, width, () => HerugolfCell.EMPTY);
    this.ballHits = new Grid(height, width, () => null);
    this.pathAssignment = new Grid(height, width, () => -1);
  }

  setCell(row: number, col: number, cell: HerugolfCell): void {
    this.cells.set(row, col, cell);
  }

  setBallHits(row: number, col: number, hits: number): void {
    this.ballHits.set(row, col, hits);
    this.cells.set(row, col, HerugolfCell.BALL);
  }

  getCell(row: number, col: number): HerugolfCell {
    if (row < 0 || row >= this.height || col < 0 || col >= this.width) {
      return HerugolfCell.WALL;
    }
    return this.cells.get(row, col);
  }

  getBallHits(row: number, col: number): number | null {
    return this.ballHits.get(row, col);
  }

  getPathAssignment(row: number, col: number): number {
    return this.pathAssignment.get(row, col);
  }

  setPathAssignment(row: number, col: number, ballIndex: number): void {
    this.pathAssignment.set(row, col, ballIndex);
  }

  /** Get all balls */
  getBalls(): Array<{ pos: Position; hits: number }> {
    const balls: Array<{ pos: Position; hits: number }> = [];
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        const hits = this.ballHits.get(row, col);
        if (hits !== null) {
          balls.push({ pos: { row, col }, hits });
        }
      }
    }
    return balls;
  }

  /** Get all holes */
  getHoles(): Position[] {
    const holes: Position[] = [];
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        if (this.cells.get(row, col) === HerugolfCell.HOLE) {
          holes.push({ row, col });
        }
      }
    }
    return holes;
  }

  clone(): HerugolfField {
    const cloned = new HerugolfField(this.height, this.width);
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        cloned.cells.set(row, col, this.cells.get(row, col));
        cloned.ballHits.set(row, col, this.ballHits.get(row, col));
        cloned.pathAssignment.set(row, col, this.pathAssignment.get(row, col));
      }
    }
    return cloned;
  }

  getStateDump(): string {
    let dump = '';
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        dump += this.pathAssignment.get(row, col).toString(36);
      }
    }
    return dump;
  }

  isSolved(): boolean {
    const balls = this.getBalls();

    // Each ball must have a path to a hole
    for (let i = 0; i < balls.length; i++) {
      let foundHole = false;
      for (let row = 0; row < this.height && !foundHole; row++) {
        for (let col = 0; col < this.width && !foundHole; col++) {
          if (this.pathAssignment.get(row, col) === i &&
              this.cells.get(row, col) === HerugolfCell.HOLE) {
            foundHole = true;
          }
        }
      }
      if (!foundHole) return false;
    }

    return true;
  }

  solveAndCheck(): boolean {
    // Basic validation
    const balls = this.getBalls();
    const holes = this.getHoles();

    if (balls.length > holes.length) return false;

    return true;
  }

  toString(): string {
    const lines: string[] = [];
    for (let row = 0; row < this.height; row++) {
      let line = '';
      for (let col = 0; col < this.width; col++) {
        const cell = this.cells.get(row, col);
        const hits = this.ballHits.get(row, col);
        if (hits !== null) {
          line += String(hits % 10);
        } else if (cell === HerugolfCell.HOLE) {
          line += 'H';
        } else if (cell === HerugolfCell.WALL) {
          line += '#';
        } else {
          line += '.';
        }
      }
      lines.push(line);
    }
    return lines.join('\n');
  }
}

// ============================================
// Herugolf Solver
// ============================================

export class HerugolfSolver extends BaseSolver<HerugolfField> {
  constructor(field: HerugolfField) {
    super(field);
  }

  static fromString(height: number, width: number, param: string): HerugolfSolver {
    const field = new HerugolfField(height, width);

    const ALPHABET_FROM_G = 'ghijklmnopqrstuvwxyz';
    let index = 0;

    for (let i = 0; i < param.length && index < height * width; i++) {
      const ch = param[i];
      const interval = ALPHABET_FROM_G.indexOf(ch);

      if (interval !== -1) {
        index += interval + 1;
      } else if (ch === '#' || ch === '+') {
        const row = Math.floor(index / width);
        const col = index % width;
        field.setCell(row, col, HerugolfCell.WALL);
        index++;
      } else if (ch === 'H' || ch === 'h') {
        const row = Math.floor(index / width);
        const col = index % width;
        field.setCell(row, col, HerugolfCell.HOLE);
        index++;
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

        if (!isNaN(num) && num >= 0 && row < height && col < width) {
          field.setBallHits(row, col, num);
        }
        index++;
      }
    }

    return new HerugolfSolver(field);
  }

  protected getBranchCandidates(state: HerugolfField): BranchCandidate<HerugolfField>[] {
    // Find first ball without complete path
    const balls = state.getBalls();
    const holes = state.getHoles();

    for (let i = 0; i < balls.length; i++) {
      const ball = balls[i];
      // Try connecting to each hole
      for (const hole of holes) {
        return [{
          apply: (s) => {
            const cloned = s.clone();
            // Mark path from ball to hole
            cloned.setPathAssignment(ball.pos.row, ball.pos.col, i);
            cloned.setPathAssignment(hole.row, hole.col, i);
            return cloned;
          },
          description: `Connect ball ${i} at (${ball.pos.row},${ball.pos.col}) to hole at (${hole.row},${hole.col})`,
        }];
      }
    }

    return [];
  }
}
