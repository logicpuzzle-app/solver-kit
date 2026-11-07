/**
 * Nanameguri Solver
 *
 * Rules:
 * 1. Draw a single closed loop through the grid
 * 2. White cells are on the loop, black cells are not
 * 3. Diagonal cells (＼ or ／) divide a cell into two triangular regions
 *    - The loop cannot cross diagonally through these cells
 *    - For ＼: loop can go UP-RIGHT or DOWN-LEFT but not across
 *    - For ／: loop can go UP-LEFT or DOWN-RIGHT but not across
 * 4. Each room boundary must be crossed exactly twice by the loop
 * 5. Each white cell has exactly 2 edges (loop enters and exits)
 */

import { CellState, Position, posKey } from '../core/types.js';
import { FieldState, Grid } from '../core/field.js';
import { BaseSolver, BranchCandidate } from '../core/solver.js';
import { LoopEdgeState } from './simpleloop.js';

// ============================================
// Nanameguri Types
// ============================================

/** Diagonal type for cells */
export enum DiagonalType {
  /** No diagonal - normal cell */
  NONE = 0,
  /** ＼ diagonal - separates UP-RIGHT from DOWN-LEFT */
  BACKSLASH = 1,
  /** ／ diagonal - separates UP-LEFT from DOWN-RIGHT */
  SLASH = 2,
}

/** Room definition */
export interface NanameguriRoom {
  /** Positions in this room */
  members: Position[];
  /** Horizontal wall positions on room boundary */
  yokoWallPositions: Position[];
  /** Vertical wall positions on room boundary */
  tateWallPositions: Position[];
}

// ============================================
// Nanameguri Field State
// ============================================

export class NanameguriField implements FieldState<NanameguriField> {
  readonly height: number;
  readonly width: number;
  /** Cell states */
  private cells: Grid<CellState>;
  /** Diagonal markers */
  private diagonals: Grid<DiagonalType>;
  /** Horizontal edges (between col and col+1) - LINE = loop passes, EMPTY = wall */
  private yokoWall: Grid<LoopEdgeState>;
  /** Vertical edges (between row and row+1) */
  private tateWall: Grid<LoopEdgeState>;
  /** Room walls - horizontal */
  private yokoRoomWall: Grid<boolean>;
  /** Room walls - vertical */
  private tateRoomWall: Grid<boolean>;
  /** Rooms */
  private rooms: NanameguriRoom[];

  constructor(height: number, width: number) {
    this.height = height;
    this.width = width;
    this.cells = new Grid(height, width, () => CellState.UNKNOWN);
    this.diagonals = new Grid(height, width, () => DiagonalType.NONE);
    this.yokoWall = new Grid(height, width - 1, () => LoopEdgeState.UNKNOWN);
    this.tateWall = new Grid(height - 1, width, () => LoopEdgeState.UNKNOWN);
    this.yokoRoomWall = new Grid(height, width - 1, () => false);
    this.tateRoomWall = new Grid(height - 1, width, () => false);
    this.rooms = [];
  }

  /** Set a diagonal marker */
  setDiagonal(row: number, col: number, type: DiagonalType): void {
    this.diagonals.set(row, col, type);
    // Diagonal cells are white (on the loop)
    if (type !== DiagonalType.NONE) {
      this.cells.set(row, col, CellState.WHITE);
    }
  }

  /** Get diagonal type */
  getDiagonal(row: number, col: number): DiagonalType {
    return this.diagonals.get(row, col);
  }

  /** Set room wall (horizontal) */
  setYokoRoomWall(row: number, col: number, isWall: boolean): void {
    if (col >= 0 && col < this.width - 1) {
      this.yokoRoomWall.set(row, col, isWall);
    }
  }

  /** Set room wall (vertical) */
  setTateRoomWall(row: number, col: number, isWall: boolean): void {
    if (row >= 0 && row < this.height - 1) {
      this.tateRoomWall.set(row, col, isWall);
    }
  }

  /** Build rooms from room walls */
  buildRooms(): void {
    this.rooms = [];
    const visited = new Set<string>();

    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        const key = posKey({ row, col });
        if (visited.has(key)) continue;

        const roomMembers: Position[] = [];
        const yokoWallPositions: Position[] = [];
        const tateWallPositions: Position[] = [];

        this.collectRoom({ row, col }, roomMembers, yokoWallPositions, tateWallPositions, visited);

        if (roomMembers.length > 0) {
          this.rooms.push({
            members: roomMembers,
            yokoWallPositions,
            tateWallPositions,
          });
        }
      }
    }
  }

  private collectRoom(
    pos: Position,
    members: Position[],
    yokoWalls: Position[],
    tateWalls: Position[],
    visited: Set<string>
  ): void {
    const key = posKey(pos);
    if (visited.has(key)) return;
    visited.add(key);
    members.push(pos);

    const { row, col } = pos;

    // Up
    if (row > 0) {
      if (this.tateRoomWall.get(row - 1, col)) {
        tateWalls.push({ row: row - 1, col });
      } else {
        this.collectRoom({ row: row - 1, col }, members, yokoWalls, tateWalls, visited);
      }
    }

    // Down
    if (row < this.height - 1) {
      if (this.tateRoomWall.get(row, col)) {
        tateWalls.push({ row, col });
      } else {
        this.collectRoom({ row: row + 1, col }, members, yokoWalls, tateWalls, visited);
      }
    }

    // Left
    if (col > 0) {
      if (this.yokoRoomWall.get(row, col - 1)) {
        yokoWalls.push({ row, col: col - 1 });
      } else {
        this.collectRoom({ row, col: col - 1 }, members, yokoWalls, tateWalls, visited);
      }
    }

    // Right
    if (col < this.width - 1) {
      if (this.yokoRoomWall.get(row, col)) {
        yokoWalls.push({ row, col });
      } else {
        this.collectRoom({ row, col: col + 1 }, members, yokoWalls, tateWalls, visited);
      }
    }
  }

  /** Get horizontal edge state */
  getYokoWall(row: number, col: number): LoopEdgeState {
    if (col < 0 || col >= this.width - 1) return LoopEdgeState.EMPTY;
    return this.yokoWall.get(row, col);
  }

  /** Get vertical edge state */
  getTateWall(row: number, col: number): LoopEdgeState {
    if (row < 0 || row >= this.height - 1) return LoopEdgeState.EMPTY;
    return this.tateWall.get(row, col);
  }

  /** Set horizontal edge */
  setYokoWall(row: number, col: number, state: LoopEdgeState): void {
    if (col >= 0 && col < this.width - 1) {
      this.yokoWall.set(row, col, state);
    }
  }

  /** Set vertical edge */
  setTateWall(row: number, col: number, state: LoopEdgeState): void {
    if (row >= 0 && row < this.height - 1) {
      this.tateWall.set(row, col, state);
    }
  }

  getCell(row: number, col: number): CellState {
    return this.cells.get(row, col);
  }

  setCell(row: number, col: number, state: CellState): void {
    this.cells.set(row, col, state);
  }

  // ========== Constraint solving ==========

  /**
   * White cells have exactly 2 edges, black cells have 0.
   * Diagonal cells have special constraints.
   */
  private nextSolve(): boolean {
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        let existsCount = 0; // EMPTY (wall/blocked)
        let notExistsCount = 0; // LINE (loop passes)

        const wallUp = row === 0 ? LoopEdgeState.EMPTY : this.getTateWall(row - 1, col);
        const wallRight = col === this.width - 1 ? LoopEdgeState.EMPTY : this.getYokoWall(row, col);
        const wallDown = row === this.height - 1 ? LoopEdgeState.EMPTY : this.getTateWall(row, col);
        const wallLeft = col === 0 ? LoopEdgeState.EMPTY : this.getYokoWall(row, col - 1);

        if (wallUp === LoopEdgeState.EMPTY) existsCount++;
        else if (wallUp === LoopEdgeState.LINE) notExistsCount++;
        if (wallRight === LoopEdgeState.EMPTY) existsCount++;
        else if (wallRight === LoopEdgeState.LINE) notExistsCount++;
        if (wallDown === LoopEdgeState.EMPTY) existsCount++;
        else if (wallDown === LoopEdgeState.LINE) notExistsCount++;
        if (wallLeft === LoopEdgeState.EMPTY) existsCount++;
        else if (wallLeft === LoopEdgeState.LINE) notExistsCount++;

        const cell = this.cells.get(row, col);
        const diagonal = this.diagonals.get(row, col);

        if (cell === CellState.UNKNOWN) {
          // Unknown cell: wall count 2 (white) or 4 (black)
          if ((existsCount === 3 && notExistsCount === 1) || notExistsCount > 2) {
            return false;
          }
          if (existsCount > 2) {
            this.cells.set(row, col, CellState.BLACK);
          } else if (notExistsCount !== 0) {
            this.cells.set(row, col, CellState.WHITE);
          }
        }

        if (this.cells.get(row, col) === CellState.BLACK) {
          if (notExistsCount > 0) return false;
          // Close all edges around black cell
          if (wallUp === LoopEdgeState.UNKNOWN) this.setTateWall(row - 1, col, LoopEdgeState.EMPTY);
          if (wallRight === LoopEdgeState.UNKNOWN) this.setYokoWall(row, col, LoopEdgeState.EMPTY);
          if (wallDown === LoopEdgeState.UNKNOWN) this.setTateWall(row, col, LoopEdgeState.EMPTY);
          if (wallLeft === LoopEdgeState.UNKNOWN) this.setYokoWall(row, col - 1, LoopEdgeState.EMPTY);
        } else if (this.cells.get(row, col) === CellState.WHITE) {
          // White cell must have exactly 2 lines
          if (existsCount > 2 || notExistsCount > 2) return false;

          if (notExistsCount === 2) {
            // Already have 2 lines, close the rest
            if (wallUp === LoopEdgeState.UNKNOWN) this.setTateWall(row - 1, col, LoopEdgeState.EMPTY);
            if (wallRight === LoopEdgeState.UNKNOWN) this.setYokoWall(row, col, LoopEdgeState.EMPTY);
            if (wallDown === LoopEdgeState.UNKNOWN) this.setTateWall(row, col, LoopEdgeState.EMPTY);
            if (wallLeft === LoopEdgeState.UNKNOWN) this.setYokoWall(row, col - 1, LoopEdgeState.EMPTY);
          } else if (existsCount === 2) {
            // Already have 2 walls, open the rest
            if (wallUp === LoopEdgeState.UNKNOWN) this.setTateWall(row - 1, col, LoopEdgeState.LINE);
            if (wallRight === LoopEdgeState.UNKNOWN) this.setYokoWall(row, col, LoopEdgeState.LINE);
            if (wallDown === LoopEdgeState.UNKNOWN) this.setTateWall(row, col, LoopEdgeState.LINE);
            if (wallLeft === LoopEdgeState.UNKNOWN) this.setYokoWall(row, col - 1, LoopEdgeState.LINE);
          }

          // Diagonal constraints
          if (diagonal === DiagonalType.BACKSLASH) {
            // ＼: can go UP-RIGHT or DOWN-LEFT, not across
            // Invalid combinations (crossing the diagonal)
            if (wallUp === LoopEdgeState.LINE && wallDown === LoopEdgeState.LINE) return false;
            if (wallUp === LoopEdgeState.LINE && wallLeft === LoopEdgeState.LINE) return false;
            if (wallRight === LoopEdgeState.LINE && wallLeft === LoopEdgeState.LINE) return false;
            if (wallRight === LoopEdgeState.LINE && wallDown === LoopEdgeState.LINE) return false;

            // Also invalid if both are EMPTY on same side
            if (wallUp === LoopEdgeState.EMPTY && wallDown === LoopEdgeState.EMPTY) return false;
            if (wallUp === LoopEdgeState.EMPTY && wallLeft === LoopEdgeState.EMPTY) return false;
            if (wallRight === LoopEdgeState.EMPTY && wallLeft === LoopEdgeState.EMPTY) return false;
            if (wallRight === LoopEdgeState.EMPTY && wallDown === LoopEdgeState.EMPTY) return false;

            // Propagate constraints
            if (wallUp === LoopEdgeState.UNKNOWN && wallDown === LoopEdgeState.LINE) this.setTateWall(row - 1, col, LoopEdgeState.EMPTY);
            if (wallUp === LoopEdgeState.UNKNOWN && wallLeft === LoopEdgeState.LINE) this.setTateWall(row - 1, col, LoopEdgeState.EMPTY);
            if (wallRight === LoopEdgeState.UNKNOWN && wallLeft === LoopEdgeState.LINE) this.setYokoWall(row, col, LoopEdgeState.EMPTY);
            if (wallRight === LoopEdgeState.UNKNOWN && wallDown === LoopEdgeState.LINE) this.setYokoWall(row, col, LoopEdgeState.EMPTY);

            if (wallUp === LoopEdgeState.UNKNOWN && wallDown === LoopEdgeState.EMPTY) this.setTateWall(row - 1, col, LoopEdgeState.LINE);
            if (wallUp === LoopEdgeState.UNKNOWN && wallLeft === LoopEdgeState.EMPTY) this.setTateWall(row - 1, col, LoopEdgeState.LINE);
            if (wallRight === LoopEdgeState.UNKNOWN && wallLeft === LoopEdgeState.EMPTY) this.setYokoWall(row, col, LoopEdgeState.LINE);
            if (wallRight === LoopEdgeState.UNKNOWN && wallDown === LoopEdgeState.EMPTY) this.setYokoWall(row, col, LoopEdgeState.LINE);

            if (wallDown === LoopEdgeState.UNKNOWN && wallUp === LoopEdgeState.LINE) this.setTateWall(row, col, LoopEdgeState.EMPTY);
            if (wallLeft === LoopEdgeState.UNKNOWN && wallUp === LoopEdgeState.LINE) this.setYokoWall(row, col - 1, LoopEdgeState.EMPTY);
            if (wallLeft === LoopEdgeState.UNKNOWN && wallRight === LoopEdgeState.LINE) this.setYokoWall(row, col - 1, LoopEdgeState.EMPTY);
            if (wallDown === LoopEdgeState.UNKNOWN && wallRight === LoopEdgeState.LINE) this.setTateWall(row, col, LoopEdgeState.EMPTY);

            if (wallDown === LoopEdgeState.UNKNOWN && wallUp === LoopEdgeState.EMPTY) this.setTateWall(row, col, LoopEdgeState.LINE);
            if (wallLeft === LoopEdgeState.UNKNOWN && wallUp === LoopEdgeState.EMPTY) this.setYokoWall(row, col - 1, LoopEdgeState.LINE);
            if (wallLeft === LoopEdgeState.UNKNOWN && wallRight === LoopEdgeState.EMPTY) this.setYokoWall(row, col - 1, LoopEdgeState.LINE);
            if (wallDown === LoopEdgeState.UNKNOWN && wallRight === LoopEdgeState.EMPTY) this.setTateWall(row, col, LoopEdgeState.LINE);
          } else if (diagonal === DiagonalType.SLASH) {
            // ／: can go UP-LEFT or DOWN-RIGHT, not across
            if (wallUp === LoopEdgeState.LINE && wallDown === LoopEdgeState.LINE) return false;
            if (wallUp === LoopEdgeState.LINE && wallRight === LoopEdgeState.LINE) return false;
            if (wallRight === LoopEdgeState.LINE && wallLeft === LoopEdgeState.LINE) return false;
            if (wallLeft === LoopEdgeState.LINE && wallDown === LoopEdgeState.LINE) return false;

            if (wallUp === LoopEdgeState.EMPTY && wallDown === LoopEdgeState.EMPTY) return false;
            if (wallUp === LoopEdgeState.EMPTY && wallRight === LoopEdgeState.EMPTY) return false;
            if (wallRight === LoopEdgeState.EMPTY && wallLeft === LoopEdgeState.EMPTY) return false;
            if (wallLeft === LoopEdgeState.EMPTY && wallDown === LoopEdgeState.EMPTY) return false;

            if (wallUp === LoopEdgeState.UNKNOWN && wallDown === LoopEdgeState.LINE) this.setTateWall(row - 1, col, LoopEdgeState.EMPTY);
            if (wallUp === LoopEdgeState.UNKNOWN && wallRight === LoopEdgeState.LINE) this.setTateWall(row - 1, col, LoopEdgeState.EMPTY);
            if (wallRight === LoopEdgeState.UNKNOWN && wallLeft === LoopEdgeState.LINE) this.setYokoWall(row, col, LoopEdgeState.EMPTY);
            if (wallLeft === LoopEdgeState.UNKNOWN && wallDown === LoopEdgeState.LINE) this.setYokoWall(row, col - 1, LoopEdgeState.EMPTY);

            if (wallUp === LoopEdgeState.UNKNOWN && wallDown === LoopEdgeState.EMPTY) this.setTateWall(row - 1, col, LoopEdgeState.LINE);
            if (wallUp === LoopEdgeState.UNKNOWN && wallRight === LoopEdgeState.EMPTY) this.setTateWall(row - 1, col, LoopEdgeState.LINE);
            if (wallRight === LoopEdgeState.UNKNOWN && wallLeft === LoopEdgeState.EMPTY) this.setYokoWall(row, col, LoopEdgeState.LINE);
            if (wallLeft === LoopEdgeState.UNKNOWN && wallDown === LoopEdgeState.EMPTY) this.setYokoWall(row, col - 1, LoopEdgeState.LINE);

            if (wallDown === LoopEdgeState.UNKNOWN && wallUp === LoopEdgeState.LINE) this.setTateWall(row, col, LoopEdgeState.EMPTY);
            if (wallRight === LoopEdgeState.UNKNOWN && wallUp === LoopEdgeState.LINE) this.setYokoWall(row, col, LoopEdgeState.EMPTY);
            if (wallLeft === LoopEdgeState.UNKNOWN && wallRight === LoopEdgeState.LINE) this.setYokoWall(row, col - 1, LoopEdgeState.EMPTY);
            if (wallDown === LoopEdgeState.UNKNOWN && wallLeft === LoopEdgeState.LINE) this.setTateWall(row, col, LoopEdgeState.EMPTY);

            if (wallDown === LoopEdgeState.UNKNOWN && wallUp === LoopEdgeState.EMPTY) this.setTateWall(row, col, LoopEdgeState.LINE);
            if (wallRight === LoopEdgeState.UNKNOWN && wallUp === LoopEdgeState.EMPTY) this.setYokoWall(row, col, LoopEdgeState.LINE);
            if (wallLeft === LoopEdgeState.UNKNOWN && wallRight === LoopEdgeState.EMPTY) this.setYokoWall(row, col - 1, LoopEdgeState.LINE);
            if (wallDown === LoopEdgeState.UNKNOWN && wallLeft === LoopEdgeState.EMPTY) this.setTateWall(row, col, LoopEdgeState.LINE);
          }
        }
      }
    }
    return true;
  }

  /** Each room boundary must be crossed exactly twice */
  private countrySolve(): boolean {
    if (this.rooms.length <= 1) return true;

    for (const room of this.rooms) {
      let lineCount = 0;
      let unknownCount = 0;

      for (const pos of room.yokoWallPositions) {
        const wall = this.yokoWall.get(pos.row, pos.col);
        if (wall === LoopEdgeState.LINE) lineCount++;
        else if (wall === LoopEdgeState.UNKNOWN) unknownCount++;
      }

      for (const pos of room.tateWallPositions) {
        const wall = this.tateWall.get(pos.row, pos.col);
        if (wall === LoopEdgeState.LINE) lineCount++;
        else if (wall === LoopEdgeState.UNKNOWN) unknownCount++;
      }

      if (lineCount + unknownCount < 2) return false; // Can't reach 2
      if (lineCount > 2) return false; // Too many crossings

      const needMore = 2 - lineCount;

      if (needMore === 0) {
        // Already have 2, close the rest
        for (const pos of room.yokoWallPositions) {
          if (this.yokoWall.get(pos.row, pos.col) === LoopEdgeState.UNKNOWN) {
            this.setYokoWall(pos.row, pos.col, LoopEdgeState.EMPTY);
          }
        }
        for (const pos of room.tateWallPositions) {
          if (this.tateWall.get(pos.row, pos.col) === LoopEdgeState.UNKNOWN) {
            this.setTateWall(pos.row, pos.col, LoopEdgeState.EMPTY);
          }
        }
      } else if (unknownCount === needMore) {
        // Must open all unknowns
        for (const pos of room.yokoWallPositions) {
          if (this.yokoWall.get(pos.row, pos.col) === LoopEdgeState.UNKNOWN) {
            this.setYokoWall(pos.row, pos.col, LoopEdgeState.LINE);
          }
        }
        for (const pos of room.tateWallPositions) {
          if (this.tateWall.get(pos.row, pos.col) === LoopEdgeState.UNKNOWN) {
            this.setTateWall(pos.row, pos.col, LoopEdgeState.LINE);
          }
        }
      }
    }
    return true;
  }

  /** White cells must be connected */
  private connectSolve(): boolean {
    const whitePosSet = new Set<string>();

    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        if (this.cells.get(row, col) === CellState.WHITE) {
          const pos: Position = { row, col };
          if (whitePosSet.size === 0) {
            whitePosSet.add(posKey(pos));
            this.collectConnected(pos, whitePosSet);
          } else if (!whitePosSet.has(posKey(pos))) {
            return false;
          }
        }
      }
    }
    return true;
  }

  private collectConnected(pos: Position, visited: Set<string>): void {
    const { row, col } = pos;

    // Up
    if (row > 0 && this.getTateWall(row - 1, col) !== LoopEdgeState.EMPTY) {
      const next: Position = { row: row - 1, col };
      const key = posKey(next);
      if (!visited.has(key)) {
        visited.add(key);
        this.collectConnected(next, visited);
      }
    }
    // Down
    if (row < this.height - 1 && this.getTateWall(row, col) !== LoopEdgeState.EMPTY) {
      const next: Position = { row: row + 1, col };
      const key = posKey(next);
      if (!visited.has(key)) {
        visited.add(key);
        this.collectConnected(next, visited);
      }
    }
    // Left
    if (col > 0 && this.getYokoWall(row, col - 1) !== LoopEdgeState.EMPTY) {
      const next: Position = { row, col: col - 1 };
      const key = posKey(next);
      if (!visited.has(key)) {
        visited.add(key);
        this.collectConnected(next, visited);
      }
    }
    // Right
    if (col < this.width - 1 && this.getYokoWall(row, col) !== LoopEdgeState.EMPTY) {
      const next: Position = { row, col: col + 1 };
      const key = posKey(next);
      if (!visited.has(key)) {
        visited.add(key);
        this.collectConnected(next, visited);
      }
    }
  }

  // ========== FieldState implementation ==========

  clone(): NanameguriField {
    const cloned = new NanameguriField(this.height, this.width);
    for (const [pos, val] of this.cells.entries()) {
      cloned.cells.set(pos, val);
    }
    for (const [pos, val] of this.diagonals.entries()) {
      cloned.diagonals.set(pos, val);
    }
    for (const [pos, val] of this.yokoWall.entries()) {
      cloned.yokoWall.set(pos, val);
    }
    for (const [pos, val] of this.tateWall.entries()) {
      cloned.tateWall.set(pos, val);
    }
    for (const [pos, val] of this.yokoRoomWall.entries()) {
      cloned.yokoRoomWall.set(pos, val);
    }
    for (const [pos, val] of this.tateRoomWall.entries()) {
      cloned.tateRoomWall.set(pos, val);
    }
    cloned.rooms = this.rooms.map((r) => ({
      members: [...r.members],
      yokoWallPositions: [...r.yokoWallPositions],
      tateWallPositions: [...r.tateWallPositions],
    }));
    return cloned;
  }

  getStateDump(): string {
    let dump = '';
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        dump += this.cells.get(row, col);
      }
    }
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width - 1; col++) {
        const w = this.yokoWall.get(row, col);
        dump += w === LoopEdgeState.LINE ? 'L' : w === LoopEdgeState.EMPTY ? 'E' : 'U';
      }
    }
    for (let row = 0; row < this.height - 1; row++) {
      for (let col = 0; col < this.width; col++) {
        const w = this.tateWall.get(row, col);
        dump += w === LoopEdgeState.LINE ? 'L' : w === LoopEdgeState.EMPTY ? 'E' : 'U';
      }
    }
    return dump;
  }

  isSolved(): boolean {
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        if (this.cells.get(row, col) === CellState.UNKNOWN) return false;
      }
    }
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width - 1; col++) {
        if (this.yokoWall.get(row, col) === LoopEdgeState.UNKNOWN) return false;
      }
    }
    for (let row = 0; row < this.height - 1; row++) {
      for (let col = 0; col < this.width; col++) {
        if (this.tateWall.get(row, col) === LoopEdgeState.UNKNOWN) return false;
      }
    }
    return this.solveAndCheck();
  }

  solveAndCheck(): boolean {
    let changed = true;
    while (changed) {
      const beforeDump = this.getStateDump();

      if (!this.nextSolve()) return false;
      if (!this.countrySolve()) return false;

      changed = this.getStateDump() !== beforeDump;
    }

    if (!this.connectSolve()) return false;

    return true;
  }

  toString(): string {
    const lines: string[] = [];

    for (let row = 0; row < this.height; row++) {
      let cellLine = '';
      for (let col = 0; col < this.width; col++) {
        const diag = this.diagonals.get(row, col);
        if (diag === DiagonalType.BACKSLASH) {
          cellLine += '＼';
        } else if (diag === DiagonalType.SLASH) {
          cellLine += '／';
        } else {
          const cell = this.cells.get(row, col);
          cellLine += cell === CellState.BLACK ? '■' : cell === CellState.WHITE ? '·' : '?';
        }

        if (col < this.width - 1) {
          const wall = this.yokoWall.get(row, col);
          const roomWall = this.yokoRoomWall.get(row, col);
          if (wall === LoopEdgeState.LINE) {
            cellLine += '─';
          } else if (wall === LoopEdgeState.EMPTY) {
            cellLine += roomWall ? '│' : ' ';
          } else {
            cellLine += roomWall ? '│' : '?';
          }
        }
      }
      lines.push(cellLine);

      if (row < this.height - 1) {
        let edgeLine = '';
        for (let col = 0; col < this.width; col++) {
          const wall = this.tateWall.get(row, col);
          const roomWall = this.tateRoomWall.get(row, col);
          if (wall === LoopEdgeState.LINE) {
            edgeLine += '│';
          } else if (wall === LoopEdgeState.EMPTY) {
            edgeLine += roomWall ? '─' : ' ';
          } else {
            edgeLine += roomWall ? '─' : '?';
          }
          if (col < this.width - 1) edgeLine += ' ';
        }
        lines.push(edgeLine);
      }
    }

    return lines.join('\n');
  }

  /** Get unknown edges for branching */
  getUnknownEdges(): Array<{ type: 'h' | 'v'; row: number; col: number }> {
    const unknowns: Array<{ type: 'h' | 'v'; row: number; col: number }> = [];

    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width - 1; col++) {
        if (this.yokoWall.get(row, col) === LoopEdgeState.UNKNOWN) {
          unknowns.push({ type: 'h', row, col });
        }
      }
    }

    for (let row = 0; row < this.height - 1; row++) {
      for (let col = 0; col < this.width; col++) {
        if (this.tateWall.get(row, col) === LoopEdgeState.UNKNOWN) {
          unknowns.push({ type: 'v', row, col });
        }
      }
    }

    return unknowns;
  }
}

// ============================================
// Nanameguri Solver
// ============================================

export class NanameguriSolver extends BaseSolver<NanameguriField> {
  constructor(field: NanameguriField) {
    super(field);
  }

  /** Create solver with diagonals and room walls */
  static create(
    height: number,
    width: number,
    config: {
      diagonals?: Array<{ row: number; col: number; type: DiagonalType }>;
      yokoRoomWalls?: Array<{ row: number; col: number }>;
      tateRoomWalls?: Array<{ row: number; col: number }>;
    }
  ): NanameguriSolver {
    const field = new NanameguriField(height, width);

    if (config.diagonals) {
      for (const d of config.diagonals) {
        field.setDiagonal(d.row, d.col, d.type);
      }
    }

    if (config.yokoRoomWalls) {
      for (const w of config.yokoRoomWalls) {
        field.setYokoRoomWall(w.row, w.col, true);
      }
    }

    if (config.tateRoomWalls) {
      for (const w of config.tateRoomWalls) {
        field.setTateRoomWall(w.row, w.col, true);
      }
    }

    field.buildRooms();

    return new NanameguriSolver(field);
  }

  protected getBranchCandidates(state: NanameguriField): BranchCandidate<NanameguriField>[] {
    const unknowns = state.getUnknownEdges();
    if (unknowns.length === 0) return [];

    const edge = unknowns[0];

    return [
      {
        apply: (s) => {
          const cloned = s.clone();
          if (edge.type === 'h') {
            cloned.setYokoWall(edge.row, edge.col, LoopEdgeState.LINE);
          } else {
            cloned.setTateWall(edge.row, edge.col, LoopEdgeState.LINE);
          }
          return cloned;
        },
        description: `Set ${edge.type === 'h' ? 'horizontal' : 'vertical'} wall at (${edge.row}, ${edge.col}) to LINE`,
      },
      {
        apply: (s) => {
          const cloned = s.clone();
          if (edge.type === 'h') {
            cloned.setYokoWall(edge.row, edge.col, LoopEdgeState.EMPTY);
          } else {
            cloned.setTateWall(edge.row, edge.col, LoopEdgeState.EMPTY);
          }
          return cloned;
        },
        description: `Set ${edge.type === 'h' ? 'horizontal' : 'vertical'} wall at (${edge.row}, ${edge.col}) to EMPTY`,
      },
    ];
  }
}
