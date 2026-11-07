/**
 * Meander Solver
 *
 * Rules:
 * 1. Place numbers 1 to N in each room of size N (each number exactly once)
 * 2. Same numbers cannot be adjacent horizontally, vertically, or diagonally
 * 3. Numbers in each room must form a connected path (1→2→3→...→N)
 */

import {
  Position,
  posKey,
} from '../core/types.js';
import { FieldState } from '../core/field.js';
import { BaseSolver, BranchCandidate } from '../core/solver.js';

// ============================================
// Meander Field State
// ============================================

export class MeanderField implements FieldState<MeanderField> {
  readonly height: number;
  readonly width: number;
  /** Number candidates for each cell */
  private numbersCand: number[][][];
  /** Fixed numbers (for display) */
  private numbers: (number | null)[][];
  /** Horizontal walls */
  private readonly yokoWall: boolean[][];
  /** Vertical walls */
  private readonly tateWall: boolean[][];
  /** Rooms */
  private rooms: Set<string>[];

  constructor(height: number, width: number) {
    this.height = height;
    this.width = width;
    this.numbersCand = Array.from({ length: height }, () =>
      Array.from({ length: width }, () => [])
    );
    this.numbers = Array.from({ length: height }, () =>
      Array(width).fill(null)
    );
    this.yokoWall = Array.from({ length: height }, () => Array(width - 1).fill(false));
    this.tateWall = Array.from({ length: height - 1 }, () => Array(width).fill(false));
    this.rooms = [];
  }

  /** Parse puzzle from pzv.jp parameter */
  parseParam(param: string): void {
    const ALPHABET_FROM_G = 'ghijklmnopqrstuvwxyz';
    let readPos = 0;

    // Parse horizontal walls (5-bit encoding)
    let bit = 0;
    for (let cnt = 0; cnt < this.height * (this.width - 1); cnt++) {
      const mod = cnt % 5;
      if (mod === 0) {
        bit = parseInt(param[readPos], 36);
        readPos++;
      }
      if (mod === 4 || cnt === this.height * (this.width - 1) - 1) {
        const base = cnt - mod;
        for (let i = 0; i <= mod && base + i < this.height * (this.width - 1); i++) {
          const idx = base + i;
          const row = Math.floor(idx / (this.width - 1));
          const col = idx % (this.width - 1);
          this.yokoWall[row][col] = (bit >> (4 - i)) % 2 === 1;
        }
      }
    }

    // Parse vertical walls
    for (let cnt = 0; cnt < (this.height - 1) * this.width; cnt++) {
      const mod = cnt % 5;
      if (mod === 0) {
        bit = parseInt(param[readPos], 36);
        readPos++;
      }
      if (mod === 4 || cnt === (this.height - 1) * this.width - 1) {
        const base = cnt - mod;
        for (let i = 0; i <= mod && base + i < (this.height - 1) * this.width; i++) {
          const idx = base + i;
          const row = Math.floor(idx / this.width);
          const col = idx % this.width;
          this.tateWall[row][col] = (bit >> (4 - i)) % 2 === 1;
        }
      }
    }

    // Build rooms from walls
    this.buildRooms();

    // Initialize candidates based on room size
    for (const room of this.rooms) {
      const roomSize = room.size;
      for (const key of room) {
        const [y, x] = key.split(',').map(Number);
        this.numbersCand[y][x] = [];
        for (let n = 1; n <= roomSize; n++) {
          this.numbersCand[y][x].push(n);
        }
      }
    }

    // Parse numbers
    let index = 0;
    for (let i = readPos; i < param.length; i++) {
      const ch = param[i];
      const interval = ALPHABET_FROM_G.indexOf(ch);
      if (interval !== -1) {
        index += interval + 1;
      } else if (ch === '.') {
        index++;
      } else if (ch === '-') {
        const value = parseInt(param[i + 1] + param[i + 2], 16);
        const row = Math.floor(index / this.width);
        const col = index % this.width;
        if (row < this.height) {
          this.numbers[row][col] = value;
          this.numbersCand[row][col] = [value];
        }
        i += 2;
        index++;
      } else if (ch === '+') {
        const value = parseInt(param[i + 1] + param[i + 2] + param[i + 3], 16);
        const row = Math.floor(index / this.width);
        const col = index % this.width;
        if (row < this.height) {
          this.numbers[row][col] = value;
          this.numbersCand[row][col] = [value];
        }
        i += 3;
        index++;
      } else {
        const value = parseInt(ch, 16);
        if (!isNaN(value)) {
          const row = Math.floor(index / this.width);
          const col = index % this.width;
          if (row < this.height) {
            this.numbers[row][col] = value;
            this.numbersCand[row][col] = [value];
          }
        }
        index++;
      }
    }
  }

  /** Build rooms from wall information */
  private buildRooms(): void {
    const visited = new Set<string>();

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const key = posKey({ row: y, col: x });
        if (visited.has(key)) continue;

        const room = new Set<string>();
        this.floodFillRoom({ row: y, col: x }, room, visited);
        this.rooms.push(room);
      }
    }
  }

  /** Flood fill to find room members */
  private floodFillRoom(pos: Position, room: Set<string>, visited: Set<string>): void {
    const key = posKey(pos);
    if (visited.has(key)) return;
    visited.add(key);
    room.add(key);

    const { row, col } = pos;

    if (row > 0 && !this.tateWall[row - 1][col]) {
      this.floodFillRoom({ row: row - 1, col }, room, visited);
    }
    if (row < this.height - 1 && !this.tateWall[row][col]) {
      this.floodFillRoom({ row: row + 1, col }, room, visited);
    }
    if (col > 0 && !this.yokoWall[row][col - 1]) {
      this.floodFillRoom({ row, col: col - 1 }, room, visited);
    }
    if (col < this.width - 1 && !this.yokoWall[row][col]) {
      this.floodFillRoom({ row, col: col + 1 }, room, visited);
    }
  }

  /** Get candidates */
  getCandidates(row: number, col: number): number[] {
    return this.numbersCand[row][col];
  }

  /** Set a number */
  setNumber(row: number, col: number, num: number): void {
    this.numbersCand[row][col] = [num];
  }

  // ========== Constraint solving ==========

  /**
   * Room constraint: each number appears exactly once in room
   */
  private roomSolve(): boolean {
    for (const room of this.rooms) {
      const roomPositions = Array.from(room).map(key => {
        const [y, x] = key.split(',').map(Number);
        return { row: y, col: x };
      });

      for (const pos of roomPositions) {
        if (this.numbersCand[pos.row][pos.col].length === 1) {
          const num = this.numbersCand[pos.row][pos.col][0];
          // Remove this number from other cells in room
          for (const otherPos of roomPositions) {
            if (otherPos.row === pos.row && otherPos.col === pos.col) continue;
            const idx = this.numbersCand[otherPos.row][otherPos.col].indexOf(num);
            if (idx !== -1) {
              this.numbersCand[otherPos.row][otherPos.col].splice(idx, 1);
            }
            if (this.numbersCand[otherPos.row][otherPos.col].length === 0) {
              return false;
            }
          }
        } else {
          // Hidden single check
          for (const cand of this.numbersCand[pos.row][pos.col]) {
            let isUnique = true;
            for (const otherPos of roomPositions) {
              if (otherPos.row === pos.row && otherPos.col === pos.col) continue;
              if (this.numbersCand[otherPos.row][otherPos.col].includes(cand)) {
                isUnique = false;
                break;
              }
            }
            if (isUnique) {
              this.numbersCand[pos.row][pos.col] = [cand];
              break;
            }
          }
        }
      }
    }
    return true;
  }

  /**
   * Same numbers cannot be adjacent (including diagonally)
   */
  private aroundSolve(): boolean {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.numbersCand[y][x].length === 1) {
          const num = this.numbersCand[y][x][0];
          const neighbors = [
            [y - 1, x], [y + 1, x], [y, x - 1], [y, x + 1],  // orthogonal
            [y - 1, x - 1], [y - 1, x + 1], [y + 1, x - 1], [y + 1, x + 1],  // diagonal
          ];

          for (const [ny, nx] of neighbors) {
            if (ny < 0 || ny >= this.height || nx < 0 || nx >= this.width) continue;
            const idx = this.numbersCand[ny][nx].indexOf(num);
            if (idx !== -1) {
              this.numbersCand[ny][nx].splice(idx, 1);
            }
            if (this.numbersCand[ny][nx].length === 0) {
              return false;
            }
          }
        }
      }
    }
    return true;
  }

  /**
   * Numbers must form connected path 1→2→3→...→N in each room
   */
  private nextSolve(): boolean {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        // Find which room this cell belongs to
        let roomSize = 0;
        const sameRoomNeighbors: Position[] = [];
        for (const room of this.rooms) {
          const key = posKey({ row: y, col: x });
          if (room.has(key)) {
            roomSize = room.size;
            // Find neighbors in same room
            const neighbors = [
              { row: y - 1, col: x },
              { row: y + 1, col: x },
              { row: y, col: x - 1 },
              { row: y, col: x + 1 },
            ];
            for (const n of neighbors) {
              if (n.row < 0 || n.row >= this.height || n.col < 0 || n.col >= this.width) continue;
              if (room.has(posKey(n))) {
                sameRoomNeighbors.push(n);
              }
            }
            break;
          }
        }

        // Each candidate must have adjacent neighbors for prev/next numbers
        const toRemove: number[] = [];
        for (const cand of this.numbersCand[y][x]) {
          const needed = new Set<number>();
          if (cand !== 1) needed.add(cand - 1);
          if (cand !== roomSize) needed.add(cand + 1);

          for (const neighbor of sameRoomNeighbors) {
            for (const neighborCand of this.numbersCand[neighbor.row][neighbor.col]) {
              needed.delete(neighborCand);
            }
          }

          if (needed.size > 0) {
            toRemove.push(cand);
          }
        }

        for (const num of toRemove) {
          const idx = this.numbersCand[y][x].indexOf(num);
          if (idx !== -1) {
            this.numbersCand[y][x].splice(idx, 1);
          }
        }

        if (this.numbersCand[y][x].length === 0) {
          return false;
        }

        // Parity check: if all candidates have same parity, propagate
        if (this.numbersCand[y][x].length > 0) {
          const firstParity = this.numbersCand[y][x][0] % 2;
          let sameParity = true;
          for (const num of this.numbersCand[y][x]) {
            if (num % 2 !== firstParity) {
              sameParity = false;
              break;
            }
          }

          if (sameParity) {
            // All cells in same room must have matching parity based on distance
            for (const room of this.rooms) {
              const key = posKey({ row: y, col: x });
              if (!room.has(key)) continue;

              for (const roomKey of room) {
                const [ry, rx] = roomKey.split(',').map(Number);
                const dist = Math.abs(ry - y) + Math.abs(rx - x);
                const expectedParity = (firstParity + dist) % 2;

                const toRemoveInRoom: number[] = [];
                for (const cand of this.numbersCand[ry][rx]) {
                  if (cand % 2 !== expectedParity) {
                    toRemoveInRoom.push(cand);
                  }
                }
                for (const num of toRemoveInRoom) {
                  const idx = this.numbersCand[ry][rx].indexOf(num);
                  if (idx !== -1) {
                    this.numbersCand[ry][rx].splice(idx, 1);
                  }
                }
                if (this.numbersCand[ry][rx].length === 0) {
                  return false;
                }
              }
              break;
            }
          }
        }
      }
    }
    return true;
  }

  // ========== FieldState implementation ==========

  clone(): MeanderField {
    const cloned = new MeanderField(this.height, this.width);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        cloned.numbersCand[y][x] = [...this.numbersCand[y][x]];
        cloned.numbers[y][x] = this.numbers[y][x];
      }
    }
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width - 1; x++) {
        (cloned.yokoWall as boolean[][])[y][x] = this.yokoWall[y][x];
      }
    }
    for (let y = 0; y < this.height - 1; y++) {
      for (let x = 0; x < this.width; x++) {
        (cloned.tateWall as boolean[][])[y][x] = this.tateWall[y][x];
      }
    }
    cloned.rooms = this.rooms;
    return cloned;
  }

  getStateDump(): string {
    let dump = '';
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        dump += this.numbersCand[y][x].length + ',';
      }
    }
    return dump;
  }

  isSolved(): boolean {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.numbersCand[y][x].length !== 1) return false;
      }
    }
    return this.solveAndCheck();
  }

  solveAndCheck(): boolean {
    let str = this.getStateDump();

    if (!this.roomSolve()) return false;
    if (!this.aroundSolve()) return false;
    if (!this.nextSolve()) return false;

    if (this.getStateDump() !== str) {
      return this.solveAndCheck();
    }

    return true;
  }

  toString(): string {
    const lines: string[] = [];
    for (let row = 0; row < this.height; row++) {
      let line = '';
      for (let col = 0; col < this.width; col++) {
        const cands = this.numbersCand[row][col];
        if (cands.length === 0) {
          line += '×';
        } else if (cands.length === 1) {
          line += cands[0].toString(16).toUpperCase();
        } else {
          line += '?';
        }
      }
      lines.push(line);
    }
    return lines.join('\n');
  }

  /** Get cells with multiple candidates for branching */
  getUnknownCells(): Array<{ row: number; col: number; cands: number[] }> {
    const unknowns: Array<{ row: number; col: number; cands: number[] }> = [];
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.numbersCand[y][x].length > 1) {
          unknowns.push({ row: y, col: x, cands: this.numbersCand[y][x] });
        }
      }
    }
    // Sort by fewest candidates first
    unknowns.sort((a, b) => a.cands.length - b.cands.length);
    return unknowns;
  }
}

// ============================================
// Meander Solver
// ============================================

export class MeanderSolver extends BaseSolver<MeanderField> {
  constructor(field: MeanderField) {
    super(field);
  }

  /** Create solver from pzv.jp URL format */
  static fromString(height: number, width: number, param: string): MeanderSolver {
    const field = new MeanderField(height, width);
    field.parseParam(param);
    return new MeanderSolver(field);
  }

  protected getBranchCandidates(state: MeanderField): BranchCandidate<MeanderField>[] {
    const unknowns = state.getUnknownCells();
    if (unknowns.length === 0) return [];

    const cell = unknowns[0];

    return cell.cands.map(num => ({
      apply: (s) => {
        const cloned = s.clone();
        cloned.setNumber(cell.row, cell.col, num);
        return cloned;
      },
      description: `Set (${cell.row}, ${cell.col}) to ${num}`,
    }));
  }
}
