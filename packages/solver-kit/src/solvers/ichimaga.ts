/**
 * Ichimaga Solver
 *
 * Rules:
 * 1. Divide the grid into rooms by drawing walls along grid edges
 * 2. Each cell is either black or white (not black)
 * 3. Black cells are completely surrounded by walls (4 walls)
 * 4. White cells have exactly 2 walls (forming a path through the cell)
 * 5. Numbered cells indicate the exact number of non-walled sides (paths out)
 * 6. White cells form a single connected region
 * 7. In Ichimaga mode: paths from numbered cells cannot turn more than once
 *    (the path between two numbers must be straight or make at most one turn)
 * 8. In Ichimagam mode: additional constraint that same numbers cannot be
 *    on the same straight path (no two cells with same number in one line)
 */

import { Position, Direction, DIRECTIONS, WallState } from '../core/types.js';
import { FieldState, Grid } from '../core/field.js';
import { BaseSolver, BranchCandidate } from '../core/solver.js';

// ============================================
// Cell State
// ============================================

export enum IchimagaCellState {
  /** Unknown */
  UNKNOWN = 'unknown',
  /** White cell (not black) - has exactly 2 walls */
  WHITE = 'white',
  /** Black cell - completely surrounded by walls */
  BLACK = 'black',
}

// ============================================
// Ichimaga Field State
// ============================================

export class IchimagaField implements FieldState<IchimagaField> {
  readonly height: number;
  readonly width: number;
  private readonly ichimagam: boolean;

  /** Cell states (black/white/unknown) */
  private masu: Grid<IchimagaCellState>;
  /** Numbered cells (null = no number, -1 = non-numbered white cell) */
  private numbers: Grid<number | null>;
  /** Horizontal walls (between cells horizontally) */
  private yokoWall: Grid<WallState>;
  /** Vertical walls (between cells vertically) */
  private tateWall: Grid<WallState>;

  constructor(height: number, width: number, ichimagam: boolean = false) {
    this.height = height;
    this.width = width;
    this.ichimagam = ichimagam;
    this.masu = new Grid(height, width, () => IchimagaCellState.UNKNOWN);
    this.numbers = new Grid(height, width, () => null);
    // yokoWall[y][x]: wall between (y,x) and (y,x+1)
    this.yokoWall = new Grid(height, width - 1, () => WallState.UNKNOWN);
    // tateWall[y][x]: wall between (y,x) and (y+1,x)
    this.tateWall = new Grid(height - 1, width, () => WallState.UNKNOWN);
  }

  /** Set number at cell */
  setNumber(row: number, col: number, num: number): void {
    this.numbers.set(row, col, num);
    this.masu.set(row, col, IchimagaCellState.WHITE);
  }

  /** Get number at cell */
  getNumber(row: number, col: number): number | null {
    return this.numbers.get(row, col);
  }

  /** Get cell state */
  getCellState(row: number, col: number): IchimagaCellState {
    return this.masu.get(row, col);
  }

  /** Set cell state */
  setCellState(row: number, col: number, state: IchimagaCellState): void {
    this.masu.set(row, col, state);
  }

  /** Get wall state for direction from cell */
  private getWall(row: number, col: number, dir: Direction): WallState {
    switch (dir) {
      case Direction.UP:
        return row === 0 ? WallState.WALL : this.tateWall.get(row - 1, col);
      case Direction.DOWN:
        return row === this.height - 1 ? WallState.WALL : this.tateWall.get(row, col);
      case Direction.LEFT:
        return col === 0 ? WallState.WALL : this.yokoWall.get(row, col - 1);
      case Direction.RIGHT:
        return col === this.width - 1 ? WallState.WALL : this.yokoWall.get(row, col);
    }
  }

  /** Set wall state for direction from cell */
  private setWall(row: number, col: number, dir: Direction, state: WallState): void {
    switch (dir) {
      case Direction.UP:
        if (row > 0) this.tateWall.set(row - 1, col, state);
        break;
      case Direction.DOWN:
        if (row < this.height - 1) this.tateWall.set(row, col, state);
        break;
      case Direction.LEFT:
        if (col > 0) this.yokoWall.set(row, col - 1, state);
        break;
      case Direction.RIGHT:
        if (col < this.width - 1) this.yokoWall.set(row, col, state);
        break;
    }
  }

  /** Count walls around cell */
  private countWalls(row: number, col: number): { exists: number; notExists: number } {
    let exists = 0;
    let notExists = 0;
    for (const dir of DIRECTIONS) {
      const wall = this.getWall(row, col, dir);
      if (wall === WallState.WALL) exists++;
      else if (wall === WallState.NO_WALL) notExists++;
    }
    return { exists, notExists };
  }

  /**
   * Apply basic constraints:
   * - Black cells must have all walls
   * - White cells must have exactly 2 walls
   * - Number cells must match their number
   */
  private nextSolve(): boolean {
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        const { exists, notExists } = this.countWalls(row, col);
        const num = this.numbers.get(row, col);

        if (num !== null) {
          // Numbered cell
          if (num !== -1) {
            // Check constraints
            if (exists > 4 - num || notExists > num) {
              return false;
            }
            // Fill in determined walls
            if (notExists === num) {
              // All non-walls placed, fill rest with walls
              for (const dir of DIRECTIONS) {
                if (this.getWall(row, col, dir) === WallState.UNKNOWN) {
                  this.setWall(row, col, dir, WallState.WALL);
                }
              }
            } else if (exists === 4 - num) {
              // All walls placed, fill rest with non-walls
              for (const dir of DIRECTIONS) {
                if (this.getWall(row, col, dir) === WallState.UNKNOWN) {
                  this.setWall(row, col, dir, WallState.NO_WALL);
                }
              }
            }
          }
        } else {
          // Non-numbered cell
          const cellState = this.masu.get(row, col);

          if (cellState === IchimagaCellState.UNKNOWN) {
            // Determine cell state based on walls
            if (exists > 2 && notExists === 1) {
              // Too many walls for white, but invalid pattern
              return false;
            }
            if (notExists > 2) {
              return false;
            }
            if (exists > 2) {
              // Must be black (4 walls)
              this.masu.set(row, col, IchimagaCellState.BLACK);
            } else if (notExists > 0) {
              // Must be white (2 walls)
              this.masu.set(row, col, IchimagaCellState.WHITE);
            }
          }

          if (cellState === IchimagaCellState.BLACK) {
            // Black cells have all walls
            if (notExists > 0) return false;
            for (const dir of DIRECTIONS) {
              if (this.getWall(row, col, dir) === WallState.UNKNOWN) {
                this.setWall(row, col, dir, WallState.WALL);
              }
            }
          } else if (cellState === IchimagaCellState.WHITE) {
            // White cells have exactly 2 walls
            if (exists > 2 || notExists > 2) return false;
            if (notExists === 2) {
              // Two non-walls placed, fill rest with walls
              for (const dir of DIRECTIONS) {
                if (this.getWall(row, col, dir) === WallState.UNKNOWN) {
                  this.setWall(row, col, dir, WallState.WALL);
                }
              }
            } else if (exists === 2) {
              // Two walls placed, fill rest with non-walls
              for (const dir of DIRECTIONS) {
                if (this.getWall(row, col, dir) === WallState.UNKNOWN) {
                  this.setWall(row, col, dir, WallState.NO_WALL);
                }
              }
            }
          }
        }
      }
    }
    return true;
  }

  /**
   * Ichimaga constraint: paths from numbered cells can turn at most once.
   * This means if a non-numbered cell has two opposite non-walls (corner),
   * both directions must lead to a numbered cell.
   */
  private ichimagaSolve(): boolean {
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        if (this.numbers.get(row, col) !== null) continue;

        const wallUp = this.getWall(row, col, Direction.UP);
        const wallRight = this.getWall(row, col, Direction.RIGHT);
        const wallDown = this.getWall(row, col, Direction.DOWN);
        const wallLeft = this.getWall(row, col, Direction.LEFT);

        // Check if this is a corner (turn)
        const isCorner =
          (wallUp === WallState.NO_WALL && wallRight === WallState.NO_WALL) ||
          (wallRight === WallState.NO_WALL && wallDown === WallState.NO_WALL) ||
          (wallDown === WallState.NO_WALL && wallLeft === WallState.NO_WALL) ||
          (wallLeft === WallState.NO_WALL && wallUp === WallState.NO_WALL);

        if (isCorner) {
          // Check each non-wall direction leads to a number
          const checkDirection = (dir: Direction): boolean => {
            if (this.getWall(row, col, dir) !== WallState.NO_WALL) return true;

            // Trace path in this direction
            let r = row;
            let c = col;
            while (true) {
              // Move in direction
              if (dir === Direction.UP) r--;
              else if (dir === Direction.DOWN) r++;
              else if (dir === Direction.LEFT) c--;
              else if (dir === Direction.RIGHT) c++;

              // Check bounds
              if (r < 0 || r >= this.height || c < 0 || c >= this.width) {
                return false;
              }

              // Check if we hit a number
              if (this.numbers.get(r, c) !== null) {
                return true;
              }

              // Check if path continues in same direction
              const wallAhead = this.getWall(r, c, dir);
              if (wallAhead === WallState.WALL) {
                return false;
              }
              if (wallAhead === WallState.UNKNOWN) {
                break; // Can't determine yet
              }
            }
            return true;
          };

          if (!checkDirection(Direction.UP)) return false;
          if (!checkDirection(Direction.RIGHT)) return false;
          if (!checkDirection(Direction.DOWN)) return false;
          if (!checkDirection(Direction.LEFT)) return false;
        }
      }
    }

    // Ichimagam mode: same numbers can't be on same straight path
    if (this.ichimagam) {
      for (let row = 0; row < this.height; row++) {
        for (let col = 0; col < this.width; col++) {
          const num = this.numbers.get(row, col);
          if (num === null) continue;

          const seenNumbers: number[] = num !== -1 ? [num] : [];

          // Check all four directions
          for (const dir of DIRECTIONS) {
            if (this.getWall(row, col, dir) !== WallState.NO_WALL) continue;

            // Trace path in this direction
            let r = row;
            let c = col;
            while (true) {
              // Move in direction
              if (dir === Direction.UP) r--;
              else if (dir === Direction.DOWN) r++;
              else if (dir === Direction.LEFT) c--;
              else if (dir === Direction.RIGHT) c++;

              if (r < 0 || r >= this.height || c < 0 || c >= this.width) break;

              const targetNum = this.numbers.get(r, c);
              if (targetNum !== null) {
                if (targetNum !== -1) {
                  if (seenNumbers.includes(targetNum)) {
                    return false; // Same number on same path
                  }
                  seenNumbers.push(targetNum);
                }
                break;
              }

              // Check if path continues
              const wallAhead = this.getWall(r, c, dir);
              if (wallAhead !== WallState.NO_WALL) break;
            }
          }
        }
      }
    }

    return true;
  }

  /**
   * White cells must form a single connected region
   */
  private connectSolve(): boolean {
    // Find first white cell
    let firstWhite: Position | null = null;
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        if (this.masu.get(row, col) === IchimagaCellState.WHITE) {
          firstWhite = { row, col };
          break;
        }
      }
      if (firstWhite) break;
    }

    if (!firstWhite) return true;

    // Collect all connected white cells
    const connected = new Set<string>();
    this.collectConnected(firstWhite.row, firstWhite.col, connected);

    // Mark disconnected cells as black
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        const key = `${row},${col}`;
        if (!connected.has(key)) {
          if (this.masu.get(row, col) === IchimagaCellState.WHITE) {
            return false; // Found disconnected white cell
          }
          if (this.masu.get(row, col) === IchimagaCellState.UNKNOWN) {
            this.masu.set(row, col, IchimagaCellState.BLACK);
          }
        }
      }
    }

    return true;
  }

  /**
   * Recursively collect connected white cells (no wall between them)
   */
  private collectConnected(row: number, col: number, visited: Set<string>): void {
    const directions = [
      { dir: Direction.UP, dr: -1, dc: 0 },
      { dir: Direction.RIGHT, dr: 0, dc: 1 },
      { dir: Direction.DOWN, dr: 1, dc: 0 },
      { dir: Direction.LEFT, dr: 0, dc: -1 },
    ];

    for (const { dir, dr, dc } of directions) {
      const nr = row + dr;
      const nc = col + dc;
      if (nr < 0 || nr >= this.height || nc < 0 || nc >= this.width) continue;

      const key = `${nr},${nc}`;
      if (visited.has(key)) continue;

      const wall = this.getWall(row, col, dir);
      if (wall === WallState.WALL) continue;

      visited.add(key);
      this.collectConnected(nr, nc, visited);
    }
  }

  // ========== FieldState implementation ==========

  clone(): IchimagaField {
    const cloned = new IchimagaField(this.height, this.width, this.ichimagam);
    for (const [pos, val] of this.masu.entries()) {
      cloned.masu.set(pos, val);
    }
    for (const [pos, val] of this.numbers.entries()) {
      cloned.numbers.set(pos, val);
    }
    for (const [pos, val] of this.yokoWall.entries()) {
      cloned.yokoWall.set(pos, val);
    }
    for (const [pos, val] of this.tateWall.entries()) {
      cloned.tateWall.set(pos, val);
    }
    return cloned;
  }

  getStateDump(): string {
    return `M:${this.masu.dump()}|Y:${this.yokoWall.dump()}|T:${this.tateWall.dump()}`;
  }

  isSolved(): boolean {
    // All cells must be determined
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        if (this.masu.get(row, col) === IchimagaCellState.UNKNOWN) return false;
      }
    }

    // All walls must be determined
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width - 1; col++) {
        if (this.yokoWall.get(row, col) === WallState.UNKNOWN) return false;
      }
    }
    for (let row = 0; row < this.height - 1; row++) {
      for (let col = 0; col < this.width; col++) {
        if (this.tateWall.get(row, col) === WallState.UNKNOWN) return false;
      }
    }

    return this.solveAndCheck();
  }

  solveAndCheck(): boolean {
    let changed = true;
    while (changed) {
      const beforeDump = this.getStateDump();

      if (!this.nextSolve()) return false;

      changed = this.getStateDump() !== beforeDump;
    }

    if (!this.ichimagaSolve()) return false;
    if (!this.connectSolve()) return false;

    return true;
  }

  toString(): string {
    const lines: string[] = [];

    // Top border
    let topBorder = '□';
    for (let col = 0; col < this.width; col++) {
      topBorder += '□';
      if (col < this.width - 1) topBorder += '□';
    }
    topBorder += '□';
    lines.push(topBorder);

    for (let row = 0; row < this.height; row++) {
      // Cell row
      let cellLine = '□';
      for (let col = 0; col < this.width; col++) {
        const num = this.numbers.get(row, col);
        if (num !== null && num !== -1) {
          cellLine += num.toString();
        } else {
          const state = this.masu.get(row, col);
          if (state === IchimagaCellState.BLACK) cellLine += '■';
          else if (state === IchimagaCellState.WHITE) cellLine += '□';
          else cellLine += '・';
        }

        if (col < this.width - 1) {
          const wall = this.yokoWall.get(row, col);
          if (wall === WallState.WALL) cellLine += '｜';
          else if (wall === WallState.NO_WALL) cellLine += ' ';
          else cellLine += '？';
        }
      }
      cellLine += '□';
      lines.push(cellLine);

      // Wall row
      if (row < this.height - 1) {
        let wallLine = '□';
        for (let col = 0; col < this.width; col++) {
          const wall = this.tateWall.get(row, col);
          if (wall === WallState.WALL) wallLine += '─';
          else if (wall === WallState.NO_WALL) wallLine += ' ';
          else wallLine += '？';

          if (col < this.width - 1) {
            wallLine += '□';
          }
        }
        wallLine += '□';
        lines.push(wallLine);
      }
    }

    // Bottom border
    let bottomBorder = '□';
    for (let col = 0; col < this.width; col++) {
      bottomBorder += '□';
      if (col < this.width - 1) bottomBorder += '□';
    }
    bottomBorder += '□';
    lines.push(bottomBorder);

    return lines.join('\n');
  }

  /** Get unknown walls for branching */
  getUnknownWalls(): Array<{ type: 'h' | 'v'; row: number; col: number }> {
    const unknowns: Array<{ type: 'h' | 'v'; row: number; col: number }> = [];

    // Check cells adjacent to white/numbered cells first for better branching
    const priority: Array<{ type: 'h' | 'v'; row: number; col: number }> = [];

    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width - 1; col++) {
        if (this.yokoWall.get(row, col) === WallState.UNKNOWN) {
          const cellState = this.masu.get(row, col);
          const nextState = this.masu.get(row, col + 1);
          if (
            cellState !== IchimagaCellState.UNKNOWN ||
            nextState !== IchimagaCellState.UNKNOWN
          ) {
            priority.push({ type: 'h', row, col });
          } else {
            unknowns.push({ type: 'h', row, col });
          }
        }
      }
    }

    for (let row = 0; row < this.height - 1; row++) {
      for (let col = 0; col < this.width; col++) {
        if (this.tateWall.get(row, col) === WallState.UNKNOWN) {
          const cellState = this.masu.get(row, col);
          const nextState = this.masu.get(row + 1, col);
          if (
            cellState !== IchimagaCellState.UNKNOWN ||
            nextState !== IchimagaCellState.UNKNOWN
          ) {
            priority.push({ type: 'v', row, col });
          } else {
            unknowns.push({ type: 'v', row, col });
          }
        }
      }
    }

    return [...priority, ...unknowns];
  }
}

// ============================================
// Ichimaga Solver
// ============================================

export class IchimagaSolver extends BaseSolver<IchimagaField> {
  constructor(field: IchimagaField) {
    super(field);
  }

  /**
   * Create solver from pzv.jp URL format
   * Format: encoded numbers with positions
   */
  static fromString(height: number, width: number, param: string, ichimagam: boolean = false): IchimagaSolver {
    const field = new IchimagaField(height, width, ichimagam);

    const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';
    const ALPHABET_FROM_G = 'ghijklmnopqrstuvwxyz';

    let index = 0;

    for (let i = 0; i < param.length; i++) {
      const ch = param[i];
      const row = Math.floor(index / width);
      const col = index % width;

      if (row >= height) break;

      if (ch === '.') {
        // Non-numbered white cell
        field.setNumber(row, col, -1);
        index++;
      } else {
        const interval = ALPHABET_FROM_G.indexOf(ch);
        if (interval !== -1) {
          // Skip cells
          index += interval + 1;
        } else if (ch >= 'a' && ch <= 'e') {
          // Numbers 0-4 encoded as 'a'-'e'
          const num = ALPHABET.indexOf(ch);
          field.setNumber(row, col, num);
          index++;
        } else if (ch >= '5' && ch <= '9') {
          // Numbers 0-4 encoded as '5'-'9'
          const num = parseInt(ch) - 5;
          field.setNumber(row, col, num);
          index++;
        } else if (ch >= '0' && ch <= '4') {
          // Numbers 0-4 directly
          const num = parseInt(ch);
          field.setNumber(row, col, num);
          index++;
        }
      }
    }

    return new IchimagaSolver(field);
  }

  protected getBranchCandidates(state: IchimagaField): BranchCandidate<IchimagaField>[] {
    const unknowns = state.getUnknownWalls();
    if (unknowns.length === 0) return [];

    const wall = unknowns[0];

    return [
      {
        apply: (s) => {
          const cloned = s.clone();
          if (wall.type === 'h') {
            cloned['yokoWall'].set(wall.row, wall.col, WallState.WALL);
          } else {
            cloned['tateWall'].set(wall.row, wall.col, WallState.WALL);
          }
          return cloned;
        },
        description: `Set wall at (${wall.row}, ${wall.col}) type ${wall.type} to WALL`,
      },
      {
        apply: (s) => {
          const cloned = s.clone();
          if (wall.type === 'h') {
            cloned['yokoWall'].set(wall.row, wall.col, WallState.NO_WALL);
          } else {
            cloned['tateWall'].set(wall.row, wall.col, WallState.NO_WALL);
          }
          return cloned;
        },
        description: `Set wall at (${wall.row}, ${wall.col}) type ${wall.type} to NO_WALL`,
      },
    ];
  }
}
