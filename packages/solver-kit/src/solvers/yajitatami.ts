/**
 * Yajitatami (矢印畳) Solver
 *
 * Rules:
 * 1. Divide the grid into rectangular regions (tatami mats)
 * 2. Arrows indicate the direction and count of cells in that region
 * 3. Each region must be a rectangle of the indicated size
 * 4. Regions cannot form T or + junctions (tatami rule)
 */

import { Position, Direction, adjacent } from '../core/types.js';
import { FieldState, Grid } from '../core/field.js';
import { BaseSolver, BranchCandidate } from '../core/solver.js';

// ============================================
// Yajitatami Types
// ============================================

export interface YajitatamiClue {
  direction: Direction;
  count: number;
}

export enum YajitatamiBorderState {
  UNKNOWN = 0,
  BORDER = 1,
  NO_BORDER = 2,
}

// ============================================
// Yajitatami Field State
// ============================================

export class YajitatamiField implements FieldState<YajitatamiField> {
  readonly height: number;
  readonly width: number;
  private clues: Grid<YajitatamiClue | null>;
  private hBorders: Grid<YajitatamiBorderState>;
  private vBorders: Grid<YajitatamiBorderState>;

  constructor(height: number, width: number) {
    this.height = height;
    this.width = width;
    this.clues = new Grid(height, width, () => null);
    this.hBorders = new Grid(height - 1, width, () => YajitatamiBorderState.UNKNOWN);
    this.vBorders = new Grid(height, width - 1, () => YajitatamiBorderState.UNKNOWN);
  }

  setClue(row: number, col: number, direction: Direction, count: number): void {
    this.clues.set(row, col, { direction, count });
  }

  getClue(row: number, col: number): YajitatamiClue | null {
    return this.clues.get(row, col);
  }

  setHBorder(row: number, col: number, state: YajitatamiBorderState): void {
    if (row >= 0 && row < this.height - 1 && col >= 0 && col < this.width) {
      this.hBorders.set(row, col, state);
    }
  }

  getHBorder(row: number, col: number): YajitatamiBorderState {
    if (row < 0 || row >= this.height - 1 || col < 0 || col >= this.width) {
      return YajitatamiBorderState.BORDER;
    }
    return this.hBorders.get(row, col);
  }

  setVBorder(row: number, col: number, state: YajitatamiBorderState): void {
    if (row >= 0 && row < this.height && col >= 0 && col < this.width - 1) {
      this.vBorders.set(row, col, state);
    }
  }

  getVBorder(row: number, col: number): YajitatamiBorderState {
    if (row < 0 || row >= this.height || col < 0 || col >= this.width - 1) {
      return YajitatamiBorderState.BORDER;
    }
    return this.vBorders.get(row, col);
  }

  hasBorder(pos1: Position, pos2: Position): YajitatamiBorderState {
    if (pos1.row === pos2.row) {
      const col = Math.min(pos1.col, pos2.col);
      return this.getVBorder(pos1.row, col);
    } else if (pos1.col === pos2.col) {
      const row = Math.min(pos1.row, pos2.row);
      return this.getHBorder(row, pos1.col);
    }
    return YajitatamiBorderState.BORDER;
  }

  private countInDirection(pos: Position, dir: Direction): { count: number; hasUnknown: boolean } {
    let count = 1;
    let hasUnknown = false;
    let current = pos;

    while (true) {
      const next = adjacent(current, dir);
      if (next.row < 0 || next.row >= this.height || next.col < 0 || next.col >= this.width) {
        break;
      }
      const border = this.hasBorder(current, next);
      if (border === YajitatamiBorderState.BORDER) break;
      if (border === YajitatamiBorderState.UNKNOWN) hasUnknown = true;
      count++;
      current = next;
    }
    return { count, hasUnknown };
  }

  private checkTatamiRule(): boolean {
    for (let row = 0; row < this.height - 1; row++) {
      for (let col = 0; col < this.width - 1; col++) {
        let borderCount = 0;
        const top = this.getVBorder(row, col);
        if (top === YajitatamiBorderState.BORDER) borderCount++;
        const bottom = this.getVBorder(row + 1, col);
        if (bottom === YajitatamiBorderState.BORDER) borderCount++;
        const left = this.getHBorder(row, col);
        if (left === YajitatamiBorderState.BORDER) borderCount++;
        const right = this.getHBorder(row, col + 1);
        if (right === YajitatamiBorderState.BORDER) borderCount++;
        if (borderCount >= 3) return false;
      }
    }
    return true;
  }

  clone(): YajitatamiField {
    const cloned = new YajitatamiField(this.height, this.width);
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        cloned.clues.set(row, col, this.clues.get(row, col));
      }
    }
    for (let row = 0; row < this.height - 1; row++) {
      for (let col = 0; col < this.width; col++) {
        cloned.hBorders.set(row, col, this.hBorders.get(row, col));
      }
    }
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width - 1; col++) {
        cloned.vBorders.set(row, col, this.vBorders.get(row, col));
      }
    }
    return cloned;
  }

  getStateDump(): string {
    let dump = '';
    for (let row = 0; row < this.height - 1; row++) {
      for (let col = 0; col < this.width; col++) {
        dump += this.hBorders.get(row, col);
      }
    }
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width - 1; col++) {
        dump += this.vBorders.get(row, col);
      }
    }
    return dump;
  }

  isSolved(): boolean {
    for (let row = 0; row < this.height - 1; row++) {
      for (let col = 0; col < this.width; col++) {
        if (this.hBorders.get(row, col) === YajitatamiBorderState.UNKNOWN) return false;
      }
    }
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width - 1; col++) {
        if (this.vBorders.get(row, col) === YajitatamiBorderState.UNKNOWN) return false;
      }
    }
    if (!this.checkTatamiRule()) return false;
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        const clue = this.clues.get(row, col);
        if (clue) {
          const { count } = this.countInDirection({ row, col }, clue.direction);
          if (count !== clue.count) return false;
        }
      }
    }
    return true;
  }

  solveAndCheck(): boolean {
    if (!this.checkTatamiRule()) return false;
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        const clue = this.clues.get(row, col);
        if (clue) {
          const { count, hasUnknown } = this.countInDirection({ row, col }, clue.direction);
          if (count > clue.count) return false;
          if (!hasUnknown && count !== clue.count) return false;
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
        if (clue) {
          const arrow = clue.direction === Direction.UP ? '^' :
            clue.direction === Direction.DOWN ? 'v' :
              clue.direction === Direction.LEFT ? '<' : '>';
          line += arrow + clue.count;
        } else {
          line += '..';
        }
      }
      lines.push(line);
    }
    return lines.join('\n');
  }

  getFirstUnknownBorder(): { type: 'h' | 'v'; row: number; col: number } | null {
    for (let row = 0; row < this.height - 1; row++) {
      for (let col = 0; col < this.width; col++) {
        if (this.hBorders.get(row, col) === YajitatamiBorderState.UNKNOWN) {
          return { type: 'h', row, col };
        }
      }
    }
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width - 1; col++) {
        if (this.vBorders.get(row, col) === YajitatamiBorderState.UNKNOWN) {
          return { type: 'v', row, col };
        }
      }
    }
    return null;
  }
}

export class YajitatamiSolver extends BaseSolver<YajitatamiField> {
  constructor(field: YajitatamiField) {
    super(field);
  }

  static fromString(height: number, width: number, param: string): YajitatamiSolver {
    const field = new YajitatamiField(height, width);
    const ALPHABET_FROM_G = 'ghijklmnopqrstuvwxyz';
    let index = 0;

    for (let i = 0; i < param.length && index < height * width; i++) {
      const ch = param[i];
      const interval = ALPHABET_FROM_G.indexOf(ch);
      if (interval !== -1) {
        index += interval + 1;
      } else if (ch >= '1' && ch <= '4') {
        const row = Math.floor(index / width);
        const col = index % width;
        const dir = parseInt(ch) as 1 | 2 | 3 | 4;
        const direction = dir === 1 ? Direction.UP :
          dir === 2 ? Direction.RIGHT :
            dir === 3 ? Direction.DOWN : Direction.LEFT;
        i++;
        if (i < param.length) {
          const countCh = param[i];
          let count = parseInt(countCh, 16);
          if (!isNaN(count)) {
            field.setClue(row, col, direction, count);
          }
        }
        index++;
      }
    }
    return new YajitatamiSolver(field);
  }

  protected getBranchCandidates(state: YajitatamiField): BranchCandidate<YajitatamiField>[] {
    const unknown = state.getFirstUnknownBorder();
    if (!unknown) return [];
    return [
      {
        apply: (s) => {
          const cloned = s.clone();
          if (unknown.type === 'h') cloned.setHBorder(unknown.row, unknown.col, YajitatamiBorderState.BORDER);
          else cloned.setVBorder(unknown.row, unknown.col, YajitatamiBorderState.BORDER);
          return cloned;
        },
        description: `Set border at (${unknown.row}, ${unknown.col})`,
      },
      {
        apply: (s) => {
          const cloned = s.clone();
          if (unknown.type === 'h') cloned.setHBorder(unknown.row, unknown.col, YajitatamiBorderState.NO_BORDER);
          else cloned.setVBorder(unknown.row, unknown.col, YajitatamiBorderState.NO_BORDER);
          return cloned;
        },
        description: `Remove border at (${unknown.row}, ${unknown.col})`,
      },
    ];
  }
}
