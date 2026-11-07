/**
 * Balance Loop Solver
 *
 * Rules:
 * 1. Draw a single closed loop through white cells
 * 2. White cells have exactly 2 edges (loop passes through)
 * 3. Black cells have 4 edges (walls on all sides, isolated)
 * 4. Numbers in circles indicate total length of arms in 4 directions
 * 5. White circles (balanced): opposite arms must be equal length (up=down and left=right)
 * 6. Black circles (unbalanced): at least one pair of opposite arms differs
 */

import {
  CellState,
  Position,
  Direction,
  posKey,
} from '../core/types.js';
import { FieldState, Grid } from '../core/field.js';
import { BaseSolver, BranchCandidate } from '../core/solver.js';

// ============================================
// Balance Types
// ============================================

/** Wall state for edges between cells */
export enum BalanceWallState {
  /** Unknown/undetermined */
  UNKNOWN = 'unknown',
  /** Wall exists (edge blocked) */
  WALL = 'wall',
  /** No wall (edge open for loop) */
  OPEN = 'open',
}

// ============================================
// Balance Field State
// ============================================

export class BalanceField implements FieldState<BalanceField> {
  readonly height: number;
  readonly width: number;
  /** Cell states (UNKNOWN/WHITE/BLACK) */
  private cells: Grid<CellState>;
  /** Numbers in cells (null = no circle) */
  private numbers: Grid<number | null>;
  /** Is the circle black (unbalanced)? */
  private blackNum: Grid<boolean>;
  /** Horizontal walls (between col and col+1) */
  private yokoWall: Grid<BalanceWallState>;
  /** Vertical walls (between row and row+1) */
  private tateWall: Grid<BalanceWallState>;

  constructor(height: number, width: number) {
    this.height = height;
    this.width = width;
    this.cells = new Grid(height, width, () => CellState.UNKNOWN);
    this.numbers = new Grid(height, width, () => null);
    this.blackNum = new Grid(height, width, () => false);
    this.yokoWall = new Grid(height, width - 1, () => BalanceWallState.UNKNOWN);
    this.tateWall = new Grid(height - 1, width, () => BalanceWallState.UNKNOWN);
  }

  /** Set a number clue */
  setNumber(row: number, col: number, num: number, isBlack: boolean): void {
    this.numbers.set(row, col, num);
    this.blackNum.set(row, col, isBlack);
    this.cells.set(row, col, CellState.WHITE); // Circles are always white
  }

  /** Get number at position */
  getNumber(row: number, col: number): number | null {
    return this.numbers.get(row, col);
  }

  /** Is circle black (unbalanced)? */
  isBlackNum(row: number, col: number): boolean {
    return this.blackNum.get(row, col);
  }

  /** Get cell state */
  getCell(row: number, col: number): CellState {
    return this.cells.get(row, col);
  }

  /** Set cell to black */
  setBlack(row: number, col: number): void {
    this.cells.set(row, col, CellState.BLACK);
    // Close all walls around black cell
    if (row > 0) this.setTateWall(row - 1, col, BalanceWallState.WALL);
    if (row < this.height - 1) this.setTateWall(row, col, BalanceWallState.WALL);
    if (col > 0) this.setYokoWall(row, col - 1, BalanceWallState.WALL);
    if (col < this.width - 1) this.setYokoWall(row, col, BalanceWallState.WALL);
  }

  /** Set cell to white */
  setWhite(row: number, col: number): void {
    this.cells.set(row, col, CellState.WHITE);
  }

  /** Get horizontal wall state */
  getYokoWall(row: number, col: number): BalanceWallState {
    if (col < 0 || col >= this.width - 1) return BalanceWallState.WALL;
    return this.yokoWall.get(row, col);
  }

  /** Get vertical wall state */
  getTateWall(row: number, col: number): BalanceWallState {
    if (row < 0 || row >= this.height - 1) return BalanceWallState.WALL;
    return this.tateWall.get(row, col);
  }

  /** Set horizontal wall */
  setYokoWall(row: number, col: number, state: BalanceWallState): void {
    if (col >= 0 && col < this.width - 1) {
      this.yokoWall.set(row, col, state);
    }
  }

  /** Set vertical wall */
  setTateWall(row: number, col: number, state: BalanceWallState): void {
    if (row >= 0 && row < this.height - 1) {
      this.tateWall.set(row, col, state);
    }
  }

  // ========== Constraint solving ==========

  /** White cells have 2 walls, black cells have 4 walls */
  private nextSolve(): boolean {
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        let wallCount = 0;
        let openCount = 0;

        const wallUp = row === 0 ? BalanceWallState.WALL : this.getTateWall(row - 1, col);
        const wallRight = col === this.width - 1 ? BalanceWallState.WALL : this.getYokoWall(row, col);
        const wallDown = row === this.height - 1 ? BalanceWallState.WALL : this.getTateWall(row, col);
        const wallLeft = col === 0 ? BalanceWallState.WALL : this.getYokoWall(row, col - 1);

        if (wallUp === BalanceWallState.WALL) wallCount++;
        else if (wallUp === BalanceWallState.OPEN) openCount++;

        if (wallRight === BalanceWallState.WALL) wallCount++;
        else if (wallRight === BalanceWallState.OPEN) openCount++;

        if (wallDown === BalanceWallState.WALL) wallCount++;
        else if (wallDown === BalanceWallState.OPEN) openCount++;

        if (wallLeft === BalanceWallState.WALL) wallCount++;
        else if (wallLeft === BalanceWallState.OPEN) openCount++;

        const state = this.cells.get(row, col);

        if (state === CellState.UNKNOWN) {
          if ((wallCount === 3 && openCount === 1) || openCount > 2) {
            return false;
          }
          if (wallCount > 2) {
            this.setBlack(row, col);
          } else if (openCount > 0) {
            this.setWhite(row, col);
          }
        }

        if (state === CellState.BLACK || this.cells.get(row, col) === CellState.BLACK) {
          if (openCount > 0) return false;
          // Close all walls
          if (row > 0) this.setTateWall(row - 1, col, BalanceWallState.WALL);
          if (col < this.width - 1) this.setYokoWall(row, col, BalanceWallState.WALL);
          if (row < this.height - 1) this.setTateWall(row, col, BalanceWallState.WALL);
          if (col > 0) this.setYokoWall(row, col - 1, BalanceWallState.WALL);
        } else if (state === CellState.WHITE || this.cells.get(row, col) === CellState.WHITE) {
          if (wallCount > 2 || openCount > 2) return false;

          if (openCount === 2) {
            if (wallUp === BalanceWallState.UNKNOWN) this.setTateWall(row - 1, col, BalanceWallState.WALL);
            if (wallRight === BalanceWallState.UNKNOWN) this.setYokoWall(row, col, BalanceWallState.WALL);
            if (wallDown === BalanceWallState.UNKNOWN) this.setTateWall(row, col, BalanceWallState.WALL);
            if (wallLeft === BalanceWallState.UNKNOWN) this.setYokoWall(row, col - 1, BalanceWallState.WALL);
          } else if (wallCount === 2) {
            if (wallUp === BalanceWallState.UNKNOWN) this.setTateWall(row - 1, col, BalanceWallState.OPEN);
            if (wallRight === BalanceWallState.UNKNOWN) this.setYokoWall(row, col, BalanceWallState.OPEN);
            if (wallDown === BalanceWallState.UNKNOWN) this.setTateWall(row, col, BalanceWallState.OPEN);
            if (wallLeft === BalanceWallState.UNKNOWN) this.setYokoWall(row, col - 1, BalanceWallState.OPEN);
          }
        }
      }
    }
    return true;
  }

  /** Check number constraints (arm lengths) */
  private limitSolve(): boolean {
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        const num = this.numbers.get(row, col);
        if (num === null) continue;

        // Count arm lengths in each direction
        let upSpace = 0, upOpen = 0;
        let rightSpace = 0, rightOpen = 0;
        let downSpace = 0, downOpen = 0;
        let leftSpace = 0, leftOpen = 0;

        let upCounting = true, rightCounting = true, downCounting = true, leftCounting = true;

        // Up
        for (let r = row - 1; r >= 0; r--) {
          if (this.getTateWall(r, col) === BalanceWallState.WALL) break;
          if (this.getTateWall(r, col) !== BalanceWallState.OPEN) upCounting = false;
          if (upCounting) upOpen++;
          upSpace++;
        }

        // Right
        for (let c = col + 1; c < this.width; c++) {
          if (this.getYokoWall(row, c - 1) === BalanceWallState.WALL) break;
          if (this.getYokoWall(row, c - 1) !== BalanceWallState.OPEN) rightCounting = false;
          if (rightCounting) rightOpen++;
          rightSpace++;
        }

        // Down
        for (let r = row + 1; r < this.height; r++) {
          if (this.getTateWall(r - 1, col) === BalanceWallState.WALL) break;
          if (this.getTateWall(r - 1, col) !== BalanceWallState.OPEN) downCounting = false;
          if (downCounting) downOpen++;
          downSpace++;
        }

        // Left
        for (let c = col - 1; c >= 0; c--) {
          if (this.getYokoWall(row, c) === BalanceWallState.WALL) break;
          if (this.getYokoWall(row, c) !== BalanceWallState.OPEN) leftCounting = false;
          if (leftCounting) leftOpen++;
          leftSpace++;
        }

        const spaceCount = upSpace + downSpace + rightSpace + leftSpace;
        const openCount = upOpen + downOpen + rightOpen + leftOpen;
        const isBlack = this.blackNum.get(row, col);

        if (!isBlack) {
          // White circle (balanced): up=down, left=right
          if (num !== 0) {
            const hand = num / 2;
            const upCan = upSpace >= hand;
            const rightCan = rightSpace >= hand;
            const downCan = downSpace >= hand;
            const leftCan = leftSpace >= hand;
            const canCount = (upCan ? 1 : 0) + (rightCan ? 1 : 0) + (downCan ? 1 : 0) + (leftCan ? 1 : 0);

            if (canCount <= 1) return false;
            if (upOpen > hand || downOpen > hand || rightOpen > hand || leftOpen > hand) return false;

            // If only 2 directions possible, fix them
            if (canCount === 2) {
              if (upCan) {
                for (let i = 1; i <= hand; i++) {
                  if (this.getTateWall(row - i, col) === BalanceWallState.WALL) return false;
                  this.setTateWall(row - i, col, BalanceWallState.OPEN);
                }
              }
              if (rightCan) {
                for (let i = 1; i <= hand; i++) {
                  if (this.getYokoWall(row, col + i - 1) === BalanceWallState.WALL) return false;
                  this.setYokoWall(row, col + i - 1, BalanceWallState.OPEN);
                }
              }
              if (downCan) {
                for (let i = 1; i <= hand; i++) {
                  if (this.getTateWall(row + i - 1, col) === BalanceWallState.WALL) return false;
                  this.setTateWall(row + i - 1, col, BalanceWallState.OPEN);
                }
              }
              if (leftCan) {
                for (let i = 1; i <= hand; i++) {
                  if (this.getYokoWall(row, col - i) === BalanceWallState.WALL) return false;
                  this.setYokoWall(row, col - i, BalanceWallState.OPEN);
                }
              }
            }
          }
        } else {
          // Black circle (unbalanced)
          // Check if already balanced - if so, contradiction
          if (upOpen !== 0 && upOpen === upSpace) {
            if (downOpen === upOpen && downOpen === downSpace) return false;
            if (rightOpen === upOpen && rightOpen === rightSpace) return false;
            if (leftOpen === upOpen && leftOpen === leftSpace) return false;
          }
          if (downOpen !== 0 && downOpen === downSpace) {
            if (rightOpen === downOpen && rightOpen === rightSpace) return false;
            if (leftOpen === downOpen && leftOpen === leftSpace) return false;
          }
          if (rightOpen !== 0 && rightOpen === rightSpace) {
            if (leftOpen === rightOpen && leftOpen === leftSpace) return false;
          }

          if (num !== 0) {
            if (spaceCount < num) return false;
            if (openCount > num) return false;

            // Extend fixed portions
            const fixedUp = num - (rightSpace + downSpace + leftSpace);
            const fixedRight = num - (upSpace + downSpace + leftSpace);
            const fixedDown = num - (upSpace + rightSpace + leftSpace);
            const fixedLeft = num - (upSpace + rightSpace + downSpace);

            if (fixedUp > 0) {
              for (let i = 1; i <= fixedUp; i++) {
                if (this.getTateWall(row - i, col) === BalanceWallState.WALL) return false;
                this.setTateWall(row - i, col, BalanceWallState.OPEN);
              }
            }
            if (fixedRight > 0) {
              for (let i = 1; i <= fixedRight; i++) {
                if (this.getYokoWall(row, col + i - 1) === BalanceWallState.WALL) return false;
                this.setYokoWall(row, col + i - 1, BalanceWallState.OPEN);
              }
            }
            if (fixedDown > 0) {
              for (let i = 1; i <= fixedDown; i++) {
                if (this.getTateWall(row + i - 1, col) === BalanceWallState.WALL) return false;
                this.setTateWall(row + i - 1, col, BalanceWallState.OPEN);
              }
            }
            if (fixedLeft > 0) {
              for (let i = 1; i <= fixedLeft; i++) {
                if (this.getYokoWall(row, col - i) === BalanceWallState.WALL) return false;
                this.setYokoWall(row, col - i, BalanceWallState.OPEN);
              }
            }
          }
        }
      }
    }
    return true;
  }

  /** Check white cell connectivity */
  private connectSolve(): boolean {
    const whitePosSet = new Set<string>();
    const blackCandSet = new Set<string>();
    let firstWhite: Position | null = null;

    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        const state = this.cells.get(row, col);
        if (state === CellState.WHITE) {
          const pos = { row, col };
          if (!firstWhite) {
            firstWhite = pos;
            whitePosSet.add(posKey(pos));
            this.setContinuePosSet(pos, whitePosSet, null);
          } else {
            if (!whitePosSet.has(posKey(pos))) {
              return false;
            }
          }
        } else if (state === CellState.UNKNOWN) {
          blackCandSet.add(posKey({ row, col }));
        }
      }
    }

    // Cells not reachable from white become black
    for (const key of blackCandSet) {
      if (!whitePosSet.has(key)) {
        const [r, c] = key.split(',').map(Number);
        this.setBlack(r, c);
      }
    }

    return true;
  }

  /** Flood fill connected cells via open walls */
  private setContinuePosSet(pos: Position, continuePosSet: Set<string>, from: Direction | null): void {
    const { row, col } = pos;

    if (row > 0 && from !== Direction.UP) {
      const nextPos = { row: row - 1, col };
      if (this.getTateWall(row - 1, col) !== BalanceWallState.WALL && !continuePosSet.has(posKey(nextPos))) {
        continuePosSet.add(posKey(nextPos));
        this.setContinuePosSet(nextPos, continuePosSet, Direction.DOWN);
      }
    }

    if (col < this.width - 1 && from !== Direction.RIGHT) {
      const nextPos = { row, col: col + 1 };
      if (this.getYokoWall(row, col) !== BalanceWallState.WALL && !continuePosSet.has(posKey(nextPos))) {
        continuePosSet.add(posKey(nextPos));
        this.setContinuePosSet(nextPos, continuePosSet, Direction.LEFT);
      }
    }

    if (row < this.height - 1 && from !== Direction.DOWN) {
      const nextPos = { row: row + 1, col };
      if (this.getTateWall(row, col) !== BalanceWallState.WALL && !continuePosSet.has(posKey(nextPos))) {
        continuePosSet.add(posKey(nextPos));
        this.setContinuePosSet(nextPos, continuePosSet, Direction.UP);
      }
    }

    if (col > 0 && from !== Direction.LEFT) {
      const nextPos = { row, col: col - 1 };
      if (this.getYokoWall(row, col - 1) !== BalanceWallState.WALL && !continuePosSet.has(posKey(nextPos))) {
        continuePosSet.add(posKey(nextPos));
        this.setContinuePosSet(nextPos, continuePosSet, Direction.RIGHT);
      }
    }
  }

  /** Loop rule: open edges crossing a line must be even */
  private oddSolve(): boolean {
    for (let row = 0; row < this.height - 1; row++) {
      let openCount = 0;
      let hasUnknown = false;
      for (let col = 0; col < this.width; col++) {
        const wall = this.getTateWall(row, col);
        if (wall === BalanceWallState.UNKNOWN) {
          hasUnknown = true;
          break;
        } else if (wall === BalanceWallState.OPEN) {
          openCount++;
        }
      }
      if (!hasUnknown && openCount % 2 !== 0) return false;
    }

    for (let col = 0; col < this.width - 1; col++) {
      let openCount = 0;
      let hasUnknown = false;
      for (let row = 0; row < this.height; row++) {
        const wall = this.getYokoWall(row, col);
        if (wall === BalanceWallState.UNKNOWN) {
          hasUnknown = true;
          break;
        } else if (wall === BalanceWallState.OPEN) {
          openCount++;
        }
      }
      if (!hasUnknown && openCount % 2 !== 0) return false;
    }

    return true;
  }

  /** At least one white cell required */
  private finalSolve(): boolean {
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        if (this.cells.get(row, col) !== CellState.BLACK) {
          return true;
        }
      }
    }
    return false;
  }

  // ========== FieldState implementation ==========

  clone(): BalanceField {
    const cloned = new BalanceField(this.height, this.width);
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        cloned.cells.set(row, col, this.cells.get(row, col));
      }
    }
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width - 1; col++) {
        cloned.yokoWall.set(row, col, this.yokoWall.get(row, col));
      }
    }
    for (let row = 0; row < this.height - 1; row++) {
      for (let col = 0; col < this.width; col++) {
        cloned.tateWall.set(row, col, this.tateWall.get(row, col));
      }
    }
    cloned.numbers = this.numbers;
    cloned.blackNum = this.blackNum;
    return cloned;
  }

  getStateDump(): string {
    let dump = '';
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width - 1; col++) {
        const w = this.yokoWall.get(row, col);
        dump += w === BalanceWallState.WALL ? 'W' : w === BalanceWallState.OPEN ? 'O' : 'U';
      }
    }
    for (let row = 0; row < this.height - 1; row++) {
      for (let col = 0; col < this.width; col++) {
        const w = this.tateWall.get(row, col);
        dump += w === BalanceWallState.WALL ? 'W' : w === BalanceWallState.OPEN ? 'O' : 'U';
      }
    }
    return dump;
  }

  isSolved(): boolean {
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width - 1; col++) {
        if (this.yokoWall.get(row, col) === BalanceWallState.UNKNOWN) return false;
      }
    }
    for (let row = 0; row < this.height - 1; row++) {
      for (let col = 0; col < this.width; col++) {
        if (this.tateWall.get(row, col) === BalanceWallState.UNKNOWN) return false;
      }
    }
    return this.solveAndCheck();
  }

  solveAndCheck(): boolean {
    let changed = true;
    while (changed) {
      const beforeDump = this.getStateDump();

      if (!this.nextSolve()) return false;
      if (!this.limitSolve()) return false;

      changed = this.getStateDump() !== beforeDump;
    }

    if (!this.oddSolve()) return false;
    if (!this.connectSolve()) return false;
    if (!this.finalSolve()) return false;

    return true;
  }

  toString(): string {
    const lines: string[] = [];
    for (let row = 0; row < this.height; row++) {
      let line = '';
      for (let col = 0; col < this.width; col++) {
        const num = this.numbers.get(row, col);
        if (num !== null) {
          const isBlack = this.blackNum.get(row, col);
          line += isBlack ? '●' : '○';
        } else {
          const state = this.cells.get(row, col);
          line += state === CellState.BLACK ? '█' : state === CellState.WHITE ? '·' : '?';
        }
        if (col < this.width - 1) {
          const wall = this.getYokoWall(row, col);
          line += wall === BalanceWallState.WALL ? '│' : wall === BalanceWallState.OPEN ? ' ' : '?';
        }
      }
      lines.push(line);

      if (row < this.height - 1) {
        let edgeLine = '';
        for (let col = 0; col < this.width; col++) {
          const wall = this.getTateWall(row, col);
          edgeLine += wall === BalanceWallState.WALL ? '─' : wall === BalanceWallState.OPEN ? ' ' : '?';
          if (col < this.width - 1) edgeLine += ' ';
        }
        lines.push(edgeLine);
      }
    }
    return lines.join('\n');
  }

  /** Get unknown walls for branching */
  getUnknownWalls(): Array<{ type: 'h' | 'v'; row: number; col: number }> {
    const unknowns: Array<{ type: 'h' | 'v'; row: number; col: number }> = [];

    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width - 1; col++) {
        if (this.yokoWall.get(row, col) === BalanceWallState.UNKNOWN) {
          unknowns.push({ type: 'h', row, col });
        }
      }
    }

    for (let row = 0; row < this.height - 1; row++) {
      for (let col = 0; col < this.width; col++) {
        if (this.tateWall.get(row, col) === BalanceWallState.UNKNOWN) {
          unknowns.push({ type: 'v', row, col });
        }
      }
    }

    return unknowns;
  }
}

// ============================================
// Balance Solver
// ============================================

export class BalanceSolver extends BaseSolver<BalanceField> {
  constructor(field: BalanceField) {
    super(field);
  }

  /** Create solver from pzv.jp URL format */
  static fromString(height: number, width: number, param: string): BalanceSolver {
    const field = new BalanceField(height, width);
    const ALPHABET_FROM_G = 'ghijklmnopqrstuvwxyz';

    let index = 0;

    for (let i = 0; i < param.length && index < height * width; i++) {
      const ch = param[i];
      const interval = ALPHABET_FROM_G.indexOf(ch);

      if (interval !== -1) {
        index += interval + 1;
      } else if (ch === '.') {
        // No-op, just increment
        index++;
      } else {
        let capacity: number;
        if (ch === '-') {
          capacity = parseInt(param.substring(i + 1, i + 3), 16);
          i += 2;
        } else if (ch === '+') {
          capacity = parseInt(param.substring(i + 1, i + 4), 16);
          i += 3;
        } else {
          capacity = parseInt(ch, 16);
        }

        const row = Math.floor(index / width);
        const col = index % width;
        const num = Math.floor(capacity / 2);
        const isBlack = capacity % 2 === 1;
        field.setNumber(row, col, num, isBlack);
        index++;
      }
    }

    return new BalanceSolver(field);
  }

  protected getBranchCandidates(state: BalanceField): BranchCandidate<BalanceField>[] {
    const unknowns = state.getUnknownWalls();
    if (unknowns.length === 0) return [];

    const wall = unknowns[0];

    return [
      {
        apply: (s) => {
          const cloned = s.clone();
          if (wall.type === 'h') {
            cloned.setYokoWall(wall.row, wall.col, BalanceWallState.WALL);
          } else {
            cloned.setTateWall(wall.row, wall.col, BalanceWallState.WALL);
          }
          return cloned;
        },
        description: `Set ${wall.type === 'h' ? 'horizontal' : 'vertical'} wall at (${wall.row}, ${wall.col}) to WALL`,
      },
      {
        apply: (s) => {
          const cloned = s.clone();
          if (wall.type === 'h') {
            cloned.setYokoWall(wall.row, wall.col, BalanceWallState.OPEN);
          } else {
            cloned.setTateWall(wall.row, wall.col, BalanceWallState.OPEN);
          }
          return cloned;
        },
        description: `Set ${wall.type === 'h' ? 'horizontal' : 'vertical'} wall at (${wall.row}, ${wall.col}) to OPEN`,
      },
    ];
  }
}
