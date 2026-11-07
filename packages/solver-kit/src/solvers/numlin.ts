/**
 * Numberlink (Numlin) Solver
 *
 * Rules:
 * 1. Connect pairs of identical numbers with lines
 * 2. Lines go through cell centers, horizontally or vertically
 * 3. Lines cannot cross, branch, or share cells
 * 4. All cells must be used by exactly one line
 *
 * Implementation:
 * - Uses WallState for edges between cells (WALL = no path, NO_WALL = path exists)
 * - Number cells have exactly 1 path (3 walls, 1 opening)
 * - Non-number cells have exactly 2 paths (2 walls, 2 openings) - straight through
 * - At each internal vertex (intersection of 4 walls), at least 2 walls must exist
 * - Different numbers cannot be connected by paths
 */

import {
  Position,
  WallState,
  posKey,
} from '../core/types.js';
import { FieldState, Grid } from '../core/field.js';
import { BaseSolver, BranchCandidate } from '../core/solver.js';

// ============================================
// Numberlink Field State
// ============================================

export class NumlinField implements FieldState<NumlinField> {
  readonly height: number;
  readonly width: number;
  /** Numbers at cells (null = empty cell, -1 = unknown number) */
  private numbers: Grid<number | null>;
  /** Horizontal walls (between col and col+1) - WALL = no path, NO_WALL = path exists */
  private yokoWall: Grid<WallState>;
  /** Vertical walls (between row and row+1) - WALL = no path, NO_WALL = path exists */
  private tateWall: Grid<WallState>;

  constructor(height: number, width: number) {
    this.height = height;
    this.width = width;
    this.numbers = new Grid(height, width, () => null);
    // Horizontal walls: height rows, (width-1) walls per row
    this.yokoWall = new Grid(height, width - 1, () => WallState.UNKNOWN);
    // Vertical walls: (height-1) rows, width walls per row
    this.tateWall = new Grid(height - 1, width, () => WallState.UNKNOWN);
  }

  /** Set a number clue */
  setNumber(row: number, col: number, num: number): void {
    this.numbers.set(row, col, num);
  }

  /** Get number at position */
  getNumber(row: number, col: number): number | null {
    return this.numbers.get(row, col);
  }

  /** Get horizontal wall state */
  getYokoWall(row: number, col: number): WallState {
    if (col < 0 || col >= this.width - 1) return WallState.WALL;
    return this.yokoWall.get(row, col);
  }

  /** Get vertical wall state */
  getTateWall(row: number, col: number): WallState {
    if (row < 0 || row >= this.height - 1) return WallState.WALL;
    return this.tateWall.get(row, col);
  }

  /** Set horizontal wall */
  setYokoWall(row: number, col: number, state: WallState): void {
    if (col >= 0 && col < this.width - 1) {
      this.yokoWall.set(row, col, state);
    }
  }

  /** Set vertical wall */
  setTateWall(row: number, col: number, state: WallState): void {
    if (row >= 0 && row < this.height - 1) {
      this.tateWall.set(row, col, state);
    }
  }

  // ========== Helper methods ==========

  /** Count walls and openings around a cell */
  private countWalls(row: number, col: number): { walls: number; openings: number; unknowns: number } {
    let walls = 0;
    let openings = 0;
    let unknowns = 0;

    const edgeUp = row === 0 ? WallState.WALL : this.getTateWall(row - 1, col);
    const edgeDown = row === this.height - 1 ? WallState.WALL : this.getTateWall(row, col);
    const edgeLeft = col === 0 ? WallState.WALL : this.getYokoWall(row, col - 1);
    const edgeRight = col === this.width - 1 ? WallState.WALL : this.getYokoWall(row, col);

    for (const edge of [edgeUp, edgeDown, edgeLeft, edgeRight]) {
      if (edge === WallState.WALL) walls++;
      else if (edge === WallState.NO_WALL) openings++;
      else unknowns++;
    }

    return { walls, openings, unknowns };
  }

  /** Get connected cells via NO_WALL paths */
  private getConnectedPath(start: Position): Set<string> {
    const connected = new Set<string>();
    const queue: Position[] = [start];
    connected.add(posKey(start));

    while (queue.length > 0) {
      const current = queue.shift()!;
      const { row, col } = current;

      // Up
      if (row > 0 && this.getTateWall(row - 1, col) === WallState.NO_WALL) {
        const next: Position = { row: row - 1, col };
        const key = posKey(next);
        if (!connected.has(key)) {
          connected.add(key);
          queue.push(next);
        }
      }
      // Down
      if (row < this.height - 1 && this.getTateWall(row, col) === WallState.NO_WALL) {
        const next: Position = { row: row + 1, col };
        const key = posKey(next);
        if (!connected.has(key)) {
          connected.add(key);
          queue.push(next);
        }
      }
      // Left
      if (col > 0 && this.getYokoWall(row, col - 1) === WallState.NO_WALL) {
        const next: Position = { row, col: col - 1 };
        const key = posKey(next);
        if (!connected.has(key)) {
          connected.add(key);
          queue.push(next);
        }
      }
      // Right
      if (col < this.width - 1 && this.getYokoWall(row, col) === WallState.NO_WALL) {
        const next: Position = { row, col: col + 1 };
        const key = posKey(next);
        if (!connected.has(key)) {
          connected.add(key);
          queue.push(next);
        }
      }
    }

    return connected;
  }

  /** Get potentially connected cells (non-WALL edges) */
  private getPotentialPath(start: Position): Set<string> {
    const potential = new Set<string>();
    const queue: Position[] = [start];
    potential.add(posKey(start));

    while (queue.length > 0) {
      const current = queue.shift()!;
      const { row, col } = current;

      // Up
      if (row > 0 && this.getTateWall(row - 1, col) !== WallState.WALL) {
        const next: Position = { row: row - 1, col };
        const key = posKey(next);
        if (!potential.has(key)) {
          potential.add(key);
          queue.push(next);
        }
      }
      // Down
      if (row < this.height - 1 && this.getTateWall(row, col) !== WallState.WALL) {
        const next: Position = { row: row + 1, col };
        const key = posKey(next);
        if (!potential.has(key)) {
          potential.add(key);
          queue.push(next);
        }
      }
      // Left
      if (col > 0 && this.getYokoWall(row, col - 1) !== WallState.WALL) {
        const next: Position = { row, col: col - 1 };
        const key = posKey(next);
        if (!potential.has(key)) {
          potential.add(key);
          queue.push(next);
        }
      }
      // Right
      if (col < this.width - 1 && this.getYokoWall(row, col) !== WallState.WALL) {
        const next: Position = { row, col: col + 1 };
        const key = posKey(next);
        if (!potential.has(key)) {
          potential.add(key);
          queue.push(next);
        }
      }
    }

    return potential;
  }

  // ========== Constraint solving ==========

  /**
   * wallSolve(): Each cell has path constraints
   * - Number cells: exactly 1 path (3 walls, 1 opening)
   * - Non-number cells: exactly 2 paths (2 walls, 2 openings) - straight through
   */
  private wallSolve(): boolean {
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        const num = this.numbers.get(row, col);
        const { walls, openings } = this.countWalls(row, col);

        if (num !== null) {
          // Number cell: must have exactly 1 opening (endpoint of path)
          if (openings > 1) return false; // Too many openings
          if (walls > 3) return false; // Too many walls

          if (openings === 1) {
            // Already has 1 opening, close all others
            if (row > 0 && this.getTateWall(row - 1, col) === WallState.UNKNOWN) {
              this.setTateWall(row - 1, col, WallState.WALL);
            }
            if (row < this.height - 1 && this.getTateWall(row, col) === WallState.UNKNOWN) {
              this.setTateWall(row, col, WallState.WALL);
            }
            if (col > 0 && this.getYokoWall(row, col - 1) === WallState.UNKNOWN) {
              this.setYokoWall(row, col - 1, WallState.WALL);
            }
            if (col < this.width - 1 && this.getYokoWall(row, col) === WallState.UNKNOWN) {
              this.setYokoWall(row, col, WallState.WALL);
            }
          } else if (walls === 3) {
            // 3 walls exist, the remaining unknown must be opening
            if (row > 0 && this.getTateWall(row - 1, col) === WallState.UNKNOWN) {
              this.setTateWall(row - 1, col, WallState.NO_WALL);
            }
            if (row < this.height - 1 && this.getTateWall(row, col) === WallState.UNKNOWN) {
              this.setTateWall(row, col, WallState.NO_WALL);
            }
            if (col > 0 && this.getYokoWall(row, col - 1) === WallState.UNKNOWN) {
              this.setYokoWall(row, col - 1, WallState.NO_WALL);
            }
            if (col < this.width - 1 && this.getYokoWall(row, col) === WallState.UNKNOWN) {
              this.setYokoWall(row, col, WallState.NO_WALL);
            }
          }
        } else {
          // Non-number cell: must have exactly 2 openings (path goes through)
          if (openings > 2) return false; // Too many openings
          if (walls > 2) return false; // Too many walls

          if (openings === 2) {
            // Already has 2 openings, close all others
            if (row > 0 && this.getTateWall(row - 1, col) === WallState.UNKNOWN) {
              this.setTateWall(row - 1, col, WallState.WALL);
            }
            if (row < this.height - 1 && this.getTateWall(row, col) === WallState.UNKNOWN) {
              this.setTateWall(row, col, WallState.WALL);
            }
            if (col > 0 && this.getYokoWall(row, col - 1) === WallState.UNKNOWN) {
              this.setYokoWall(row, col - 1, WallState.WALL);
            }
            if (col < this.width - 1 && this.getYokoWall(row, col) === WallState.UNKNOWN) {
              this.setYokoWall(row, col, WallState.WALL);
            }
          } else if (walls === 2) {
            // 2 walls exist, remaining unknowns must be openings
            if (row > 0 && this.getTateWall(row - 1, col) === WallState.UNKNOWN) {
              this.setTateWall(row - 1, col, WallState.NO_WALL);
            }
            if (row < this.height - 1 && this.getTateWall(row, col) === WallState.UNKNOWN) {
              this.setTateWall(row, col, WallState.NO_WALL);
            }
            if (col > 0 && this.getYokoWall(row, col - 1) === WallState.UNKNOWN) {
              this.setYokoWall(row, col - 1, WallState.NO_WALL);
            }
            if (col < this.width - 1 && this.getYokoWall(row, col) === WallState.UNKNOWN) {
              this.setYokoWall(row, col, WallState.NO_WALL);
            }
          }
        }
      }
    }

    return true;
  }

  /**
   * pondSolve(): At each internal vertex (intersection of 4 walls),
   * at least 2 walls must exist (cannot have exactly 1 wall)
   */
  private pondSolve(): boolean {
    // Check each internal vertex (intersection point of 4 walls)
    for (let row = 0; row < this.height - 1; row++) {
      for (let col = 0; col < this.width - 1; col++) {
        // Four walls meeting at this vertex:
        // - tateWall[row][col] (vertical, left side)
        // - tateWall[row][col+1] (vertical, right side)
        // - yokoWall[row][col] (horizontal, top side)
        // - yokoWall[row+1][col] (horizontal, bottom side)
        const wall1 = this.getTateWall(row, col);
        const wall2 = this.getTateWall(row, col + 1);
        const wall3 = this.getYokoWall(row, col);
        const wall4 = this.getYokoWall(row + 1, col);

        let wallCount = 0;
        let noWallCount = 0;
        const walls = [wall1, wall2, wall3, wall4];

        for (const w of walls) {
          if (w === WallState.WALL) wallCount++;
          else if (w === WallState.NO_WALL) noWallCount++;
        }

        // Exactly 1 wall with 3 no-walls is invalid
        if (wallCount === 1 && noWallCount === 3) {
          return false;
        }

        // If 3 no-walls exist, the last one must also be no-wall (0 walls total)
        if (noWallCount === 3) {
          if (wall1 === WallState.UNKNOWN) this.setTateWall(row, col, WallState.NO_WALL);
          if (wall2 === WallState.UNKNOWN) this.setTateWall(row, col + 1, WallState.NO_WALL);
          if (wall3 === WallState.UNKNOWN) this.setYokoWall(row, col, WallState.NO_WALL);
          if (wall4 === WallState.UNKNOWN) this.setYokoWall(row + 1, col, WallState.NO_WALL);
        }

        // If 2 no-walls and 1 wall, the last must be wall (2 walls total)
        if (noWallCount === 2 && wallCount === 1) {
          if (wall1 === WallState.UNKNOWN) this.setTateWall(row, col, WallState.WALL);
          if (wall2 === WallState.UNKNOWN) this.setTateWall(row, col + 1, WallState.WALL);
          if (wall3 === WallState.UNKNOWN) this.setYokoWall(row, col, WallState.WALL);
          if (wall4 === WallState.UNKNOWN) this.setYokoWall(row + 1, col, WallState.WALL);
        }
      }
    }

    return true;
  }

  /**
   * connectSolve(): Different numbers cannot be connected by paths
   * Same numbers must be potentially connectable
   */
  private connectSolve(): boolean {
    // Check all number pairs
    const numberPositions = new Map<number, Position[]>();

    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        const num = this.numbers.get(row, col);
        if (num !== null && num !== -1) {
          if (!numberPositions.has(num)) {
            numberPositions.set(num, []);
          }
          numberPositions.get(num)!.push({ row, col });
        }
      }
    }

    // Check each number
    for (const [num, positions] of numberPositions) {
      if (positions.length === 0) continue;

      // Check that different numbers are not connected
      const connected = this.getConnectedPath(positions[0]);
      for (const key of connected) {
        const [r, c] = key.split(',').map(Number);
        const otherNum = this.numbers.get(r, c);
        if (otherNum !== null && otherNum !== -1 && otherNum !== num) {
          return false; // Different numbers connected
        }
      }

      // Check that all cells with same number are potentially connectable
      if (positions.length > 1) {
        const potential = this.getPotentialPath(positions[0]);
        for (let i = 1; i < positions.length; i++) {
          const key = posKey(positions[i]);
          if (!potential.has(key)) {
            return false; // Same numbers not connectable
          }
        }
      }
    }

    return true;
  }

  // ========== FieldState implementation ==========

  clone(): NumlinField {
    const cloned = new NumlinField(this.height, this.width);
    for (const [pos, num] of this.numbers.entries()) {
      cloned.numbers.set(pos, num);
    }
    for (const [pos, wall] of this.yokoWall.entries()) {
      cloned.yokoWall.set(pos, wall);
    }
    for (const [pos, wall] of this.tateWall.entries()) {
      cloned.tateWall.set(pos, wall);
    }
    return cloned;
  }

  getStateDump(): string {
    let dump = '';
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width - 1; col++) {
        const w = this.yokoWall.get(row, col);
        dump += w === WallState.WALL ? 'W' : w === WallState.NO_WALL ? 'N' : 'U';
      }
    }
    for (let row = 0; row < this.height - 1; row++) {
      for (let col = 0; col < this.width; col++) {
        const w = this.tateWall.get(row, col);
        dump += w === WallState.WALL ? 'W' : w === WallState.NO_WALL ? 'N' : 'U';
      }
    }
    return dump;
  }

  isSolved(): boolean {
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

      if (!this.wallSolve()) return false;
      if (!this.pondSolve()) return false;
      if (!this.connectSolve()) return false;

      changed = this.getStateDump() !== beforeDump;
    }
    return true;
  }

  toString(): string {
    const lines: string[] = [];

    for (let row = 0; row < this.height; row++) {
      let cellLine = '';
      for (let col = 0; col < this.width; col++) {
        const num = this.numbers.get(row, col);
        if (num !== null) {
          if (num === -1) {
            cellLine += '?';
          } else if (num <= 9) {
            cellLine += String(num);
          } else if (num <= 35) {
            // A-Z for 10-35
            cellLine += String.fromCharCode('A'.charCodeAt(0) + num - 10);
          } else {
            // a-z for 36+
            cellLine += String.fromCharCode('a'.charCodeAt(0) + num - 36);
          }
        } else {
          // Show path for non-number cells
          const edgeUp = row === 0 ? WallState.WALL : this.getTateWall(row - 1, col);
          const edgeDown = row === this.height - 1 ? WallState.WALL : this.getTateWall(row, col);
          const edgeLeft = col === 0 ? WallState.WALL : this.getYokoWall(row, col - 1);
          const edgeRight = col === this.width - 1 ? WallState.WALL : this.getYokoWall(row, col);

          const u = edgeUp === WallState.NO_WALL;
          const d = edgeDown === WallState.NO_WALL;
          const l = edgeLeft === WallState.NO_WALL;
          const r = edgeRight === WallState.NO_WALL;

          if (u && d && !l && !r) cellLine += '│';
          else if (!u && !d && l && r) cellLine += '─';
          else if (u && r && !d && !l) cellLine += '└';
          else if (d && r && !u && !l) cellLine += '┌';
          else if (u && l && !d && !r) cellLine += '┘';
          else if (d && l && !u && !r) cellLine += '┐';
          else cellLine += '·';
        }

        if (col < this.width - 1) {
          const edge = this.yokoWall.get(row, col);
          cellLine += edge === WallState.NO_WALL ? '─' : ' ';
        }
      }
      lines.push(cellLine);

      if (row < this.height - 1) {
        let edgeLine = '';
        for (let col = 0; col < this.width; col++) {
          const edge = this.tateWall.get(row, col);
          edgeLine += edge === WallState.NO_WALL ? '│' : ' ';
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
        if (this.yokoWall.get(row, col) === WallState.UNKNOWN) {
          unknowns.push({ type: 'h', row, col });
        }
      }
    }

    for (let row = 0; row < this.height - 1; row++) {
      for (let col = 0; col < this.width; col++) {
        if (this.tateWall.get(row, col) === WallState.UNKNOWN) {
          unknowns.push({ type: 'v', row, col });
        }
      }
    }

    return unknowns;
  }
}

// ============================================
// Numberlink Solver
// ============================================

export class NumlinSolver extends BaseSolver<NumlinField> {
  constructor(field: NumlinField) {
    super(field);
  }

  /** Create solver from puzzle string array */
  static fromString(height: number, width: number, puzzle: string[]): NumlinSolver {
    const field = new NumlinField(height, width);

    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const ch = puzzle[row]?.[col];
        if (ch === '?' || ch === '.') {
          field.setNumber(row, col, -1);
        } else if (ch && ch >= '0' && ch <= '9') {
          field.setNumber(row, col, parseInt(ch));
        } else if (ch && ch >= 'A' && ch <= 'Z') {
          // A-Z for 10-35
          field.setNumber(row, col, ch.charCodeAt(0) - 'A'.charCodeAt(0) + 10);
        } else if (ch && ch >= 'a' && ch <= 'z') {
          // a-z for 36+
          field.setNumber(row, col, ch.charCodeAt(0) - 'a'.charCodeAt(0) + 36);
        }
      }
    }

    return new NumlinSolver(field);
  }

  /** Create solver from number pairs */
  static fromPairs(
    height: number,
    width: number,
    pairs: Array<{ num: number; positions: [Position, Position] }>
  ): NumlinSolver {
    const field = new NumlinField(height, width);

    for (const { num, positions } of pairs) {
      field.setNumber(positions[0].row, positions[0].col, num);
      field.setNumber(positions[1].row, positions[1].col, num);
    }

    return new NumlinSolver(field);
  }

  protected getBranchCandidates(state: NumlinField): BranchCandidate<NumlinField>[] {
    const unknowns = state.getUnknownWalls();
    if (unknowns.length === 0) return [];

    const wall = unknowns[0];

    return [
      {
        apply: (s) => {
          const cloned = s.clone();
          if (wall.type === 'h') {
            cloned.setYokoWall(wall.row, wall.col, WallState.WALL);
          } else {
            cloned.setTateWall(wall.row, wall.col, WallState.WALL);
          }
          return cloned;
        },
        description: `Set ${wall.type === 'h' ? 'horizontal' : 'vertical'} wall at (${wall.row}, ${wall.col}) to WALL`,
      },
      {
        apply: (s) => {
          const cloned = s.clone();
          if (wall.type === 'h') {
            cloned.setYokoWall(wall.row, wall.col, WallState.NO_WALL);
          } else {
            cloned.setTateWall(wall.row, wall.col, WallState.NO_WALL);
          }
          return cloned;
        },
        description: `Set ${wall.type === 'h' ? 'horizontal' : 'vertical'} wall at (${wall.row}, ${wall.col}) to NO_WALL`,
      },
    ];
  }
}
