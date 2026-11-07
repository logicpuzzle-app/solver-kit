/**
 * Invlitso Solver
 *
 * Rules:
 * 1. Mark exactly 4 cells white in each room to form one of the LITS tetrominoes (L, I, T, S)
 * 2. All white cells must form a single connected group
 * 3. No 2x2 area can be entirely black (no "pools")
 * 4. Identical white tetrominoes cannot be adjacent (touching orthogonally)
 *
 * Note: Invlitso is the inverse of LITS - white cells instead of black cells
 */

import {
  CellState,
  Position,
  DIRECTIONS,
  adjacent,
  posKey,
} from '../core/types.js';
import { FieldState, Grid } from '../core/field.js';
import { BaseSolver, BranchCandidate } from '../core/solver.js';

// ============================================
// Tetromino types
// ============================================

enum TetrominoType {
  L = 'L',
  I = 'I',
  T = 'T',
  S = 'S',
  O = 'O', // Square (not used in LITS but detected in original)
  UNKNOWN = 'UNKNOWN',
}

/** Determine tetromino type from a set of 4 positions */
function getTetrominoType(positions: Position[]): TetrominoType | null {
  if (positions.length !== 4) return null;

  // Count cells per row and column
  const rowCounts = new Map<number, number>();
  const colCounts = new Map<number, number>();

  for (const pos of positions) {
    rowCounts.set(pos.row, (rowCounts.get(pos.row) || 0) + 1);
    colCounts.set(pos.col, (colCounts.get(pos.col) || 0) + 1);
  }

  const uniqueRows = rowCounts.size;
  const uniqueCols = colCounts.size;
  const rowCountValues = [...rowCounts.values()].sort((a, b) => a - b);
  const colCountValues = [...colCounts.values()].sort((a, b) => a - b);

  // O: 2x2 square
  if (uniqueRows === 2 && uniqueCols === 2) {
    return TetrominoType.O;
  }

  // I: 4 in a row OR 4 in a column
  if (uniqueRows === 4 || uniqueCols === 4) {
    return TetrominoType.I;
  }

  // L, T, S differentiation when 3 rows + 2 cols
  if (uniqueRows === 3 && uniqueCols === 2) {
    // L: has 2 in an end row (first or last)
    if (rowCountValues[0] === 2 || rowCountValues[2] === 2) {
      return TetrominoType.L;
    }
    // T or S: check column distribution
    if (colCountValues[0] === 3 || colCountValues[1] === 3) {
      return TetrominoType.T;
    }
    return TetrominoType.S;
  }

  // L, T, S differentiation when 2 rows + 3 cols
  if (uniqueRows === 2 && uniqueCols === 3) {
    // L: has 2 in an end column (first or last)
    if (colCountValues[0] === 2 || colCountValues[2] === 2) {
      return TetrominoType.L;
    }
    // T or S: check row distribution
    if (rowCountValues[0] === 3 || rowCountValues[1] === 3) {
      return TetrominoType.T;
    }
    return TetrominoType.S;
  }

  return null;
}

// ============================================
// Invlitso Room
// ============================================

export interface InvlitsoRoom {
  /** Positions in this room */
  members: Position[];
}

// ============================================
// Invlitso Field State
// ============================================

export class InvlitsoField implements FieldState<InvlitsoField> {
  readonly height: number;
  readonly width: number;
  /** Cell states (UNKNOWN/WHITE/BLACK) - WHITE represents the marked cells */
  private cells: Grid<CellState>;
  /** Room ID for each cell */
  private roomIds: Grid<number>;
  /** List of rooms */
  private rooms: InvlitsoRoom[];

  static readonly WHITE_COUNT = 4; // Each room needs exactly 4 white cells

  constructor(height: number, width: number) {
    this.height = height;
    this.width = width;
    this.cells = new Grid(height, width, () => CellState.UNKNOWN);
    this.roomIds = new Grid(height, width, () => -1);
    this.rooms = [];
  }

  /** Set room configuration */
  setRooms(rooms: InvlitsoRoom[]): void {
    this.rooms = rooms;
    for (let roomId = 0; roomId < rooms.length; roomId++) {
      for (const pos of rooms[roomId].members) {
        this.roomIds.set(pos.row, pos.col, roomId);
      }
    }
  }

  /** Get cell state */
  getCell(row: number, col: number): CellState {
    return this.cells.get(row, col);
  }

  /** Set cell to black */
  setBlack(row: number, col: number): void {
    this.cells.set(row, col, CellState.BLACK);
  }

  /** Set cell to white (the marked cells in Invlitso) */
  setWhite(row: number, col: number): void {
    this.cells.set(row, col, CellState.WHITE);
  }

  /** Get room ID for a cell */
  getRoomId(row: number, col: number): number {
    return this.roomIds.get(row, col);
  }

  /** Get room by ID */
  getRoom(roomId: number): InvlitsoRoom | undefined {
    return this.rooms[roomId];
  }

  // ========== Constraint checking ==========

  /** Check for 2x2 black pool */
  private hasBlackPool(): boolean {
    for (let row = 0; row < this.height - 1; row++) {
      for (let col = 0; col < this.width - 1; col++) {
        if (
          this.cells.get(row, col) === CellState.BLACK &&
          this.cells.get(row + 1, col) === CellState.BLACK &&
          this.cells.get(row, col + 1) === CellState.BLACK &&
          this.cells.get(row + 1, col + 1) === CellState.BLACK
        ) {
          return true;
        }
      }
    }
    return false;
  }

  /** Check if white cells are connected */
  private isWhiteConnected(): boolean {
    const whiteCells: Position[] = [];
    for (const [pos, state] of this.cells.entries()) {
      if (state === CellState.WHITE) {
        whiteCells.push(pos);
      }
    }

    if (whiteCells.length === 0) return true;

    // BFS from first white cell
    const visited = new Set<string>();
    const queue: Position[] = [whiteCells[0]];
    visited.add(posKey(whiteCells[0]));

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const dir of DIRECTIONS) {
        const next = adjacent(current, dir);
        const key = posKey(next);
        if (
          this.cells.inBounds(next) &&
          this.cells.get(next) === CellState.WHITE &&
          !visited.has(key)
        ) {
          visited.add(key);
          queue.push(next);
        }
      }
    }

    // All white cells must be reachable
    for (const pos of whiteCells) {
      if (!visited.has(posKey(pos))) {
        return false;
      }
    }

    return true;
  }

  /** Get white cells in a room */
  private getRoomWhiteCells(roomId: number): Position[] {
    const room = this.rooms[roomId];
    if (!room) return [];
    return room.members.filter(pos => this.cells.get(pos) === CellState.WHITE);
  }

  /** Check if two tetrominoes of same type are adjacent */
  private hasSameTypeAdjacent(): boolean {
    for (let roomId = 0; roomId < this.rooms.length; roomId++) {
      const whiteCells = this.getRoomWhiteCells(roomId);
      if (whiteCells.length !== InvlitsoField.WHITE_COUNT) continue;

      const myType = getTetrominoType(whiteCells);
      if (!myType) continue;

      // Check adjacent rooms
      const adjacentRooms = new Set<number>();
      for (const pos of whiteCells) {
        for (const dir of DIRECTIONS) {
          const next = adjacent(pos, dir);
          if (!this.cells.inBounds(next)) continue;
          if (this.cells.get(next) !== CellState.WHITE) continue;
          const nextRoomId = this.roomIds.get(next);
          if (nextRoomId !== roomId) {
            adjacentRooms.add(nextRoomId);
          }
        }
      }

      // Check if any adjacent room has same tetromino type
      for (const adjRoomId of adjacentRooms) {
        const adjWhiteCells = this.getRoomWhiteCells(adjRoomId);
        if (adjWhiteCells.length !== InvlitsoField.WHITE_COUNT) continue;
        const adjType = getTetrominoType(adjWhiteCells);
        if (adjType === myType) {
          return true;
        }
      }
    }
    return false;
  }

  /** Check room constraints validity */
  private checkRoomConstraints(): boolean {
    for (let roomId = 0; roomId < this.rooms.length; roomId++) {
      const room = this.rooms[roomId];
      let whiteCount = 0;
      let unknownCount = 0;

      for (const pos of room.members) {
        const state = this.cells.get(pos);
        if (state === CellState.WHITE) whiteCount++;
        else if (state === CellState.UNKNOWN) unknownCount++;
      }

      // Too many whites
      if (whiteCount > InvlitsoField.WHITE_COUNT) return false;
      // Not enough cells to fill required whites
      if (whiteCount + unknownCount < InvlitsoField.WHITE_COUNT) return false;
    }
    return true;
  }

  // ========== Solving methods ==========

  /** Room constraint: each room needs exactly 4 white cells */
  private solveRoomConstraints(): boolean {
    let changed = false;

    for (let roomId = 0; roomId < this.rooms.length; roomId++) {
      const room = this.rooms[roomId];
      let whiteCount = 0;
      let unknownCount = 0;
      const unknownPositions: Position[] = [];

      for (const pos of room.members) {
        const state = this.cells.get(pos);
        if (state === CellState.WHITE) {
          whiteCount++;
        } else if (state === CellState.UNKNOWN) {
          unknownCount++;
          unknownPositions.push(pos);
        }
      }

      // If room already has 4 whites, mark rest as black
      if (whiteCount === InvlitsoField.WHITE_COUNT) {
        for (const pos of unknownPositions) {
          this.setBlack(pos.row, pos.col);
          changed = true;
        }
      }
      // If remaining unknowns = remaining whites needed, fill all white
      else if (unknownCount === InvlitsoField.WHITE_COUNT - whiteCount && unknownCount > 0) {
        for (const pos of unknownPositions) {
          this.setWhite(pos.row, pos.col);
          changed = true;
        }
      }
    }

    return changed;
  }

  /** Prevent 2x2 pool of black cells */
  private preventPools(): boolean {
    let changed = false;

    for (let row = 0; row < this.height - 1; row++) {
      for (let col = 0; col < this.width - 1; col++) {
        const cells = [
          { r: row, c: col },
          { r: row + 1, c: col },
          { r: row, c: col + 1 },
          { r: row + 1, c: col + 1 },
        ];

        let blackCount = 0;
        let unknownCell: { r: number; c: number } | null = null;

        for (const cell of cells) {
          const state = this.cells.get(cell.r, cell.c);
          if (state === CellState.BLACK) blackCount++;
          else if (state === CellState.UNKNOWN) unknownCell = cell;
        }

        // If 3 blacks and 1 unknown, mark unknown as white
        if (blackCount === 3 && unknownCell) {
          this.setWhite(unknownCell.r, unknownCell.c);
          changed = true;
        }
      }
    }

    return changed;
  }

  /**
   * Capacity solve: Mark cells that cannot reach existing white cells within distance 3
   * This ensures white cells can form valid tetrominoes (max distance in tetromino is 3)
   */
  private capacitySolve(): boolean {
    let changed = false;

    for (const room of this.rooms) {
      const whiteCells: Position[] = [];
      const unknownCells: Position[] = [];

      for (const pos of room.members) {
        const state = this.cells.get(pos);
        if (state === CellState.WHITE) {
          whiteCells.push(pos);
        } else if (state === CellState.UNKNOWN) {
          unknownCells.push(pos);
        }
      }

      // If there are white cells, check which unknowns can reach them
      if (whiteCells.length > 0) {
        // Get all reachable positions from white cells within distance 3
        const reachable = new Set<string>();
        for (const white of whiteCells) {
          this.collectReachablePositions(white, room.members, 3, reachable);
        }

        // Mark unreachable unknown cells as black
        for (const pos of unknownCells) {
          if (!reachable.has(posKey(pos))) {
            this.setBlack(pos.row, pos.col);
            changed = true;
          }
        }
      }
    }

    return changed;
  }

  /**
   * Collect positions reachable from start within given distance, staying in valid cells
   */
  private collectReachablePositions(
    start: Position,
    validCells: Position[],
    distance: number,
    result: Set<string>
  ): void {
    const validSet = new Set(validCells.map(posKey));
    const visited = new Set<string>();
    const queue: { pos: Position; dist: number }[] = [{ pos: start, dist: 0 }];
    visited.add(posKey(start));
    result.add(posKey(start));

    while (queue.length > 0) {
      const { pos, dist } = queue.shift()!;
      if (dist >= distance) continue;

      for (const dir of DIRECTIONS) {
        const next = adjacent(pos, dir);
        const key = posKey(next);
        if (
          this.cells.inBounds(next) &&
          validSet.has(key) &&
          this.cells.get(next) !== CellState.BLACK &&
          !visited.has(key)
        ) {
          visited.add(key);
          result.add(key);
          queue.push({ pos: next, dist: dist + 1 });
        }
      }
    }
  }

  // ========== FieldState implementation ==========

  clone(): InvlitsoField {
    const cloned = new InvlitsoField(this.height, this.width);
    for (const [pos, state] of this.cells.entries()) {
      cloned.cells.set(pos, state);
    }
    cloned.roomIds = this.roomIds; // Shared (immutable)
    cloned.rooms = this.rooms; // Shared (immutable)
    return cloned;
  }

  getStateDump(): string {
    return this.cells.dump();
  }

  isSolved(): boolean {
    // All cells must be determined
    for (const [, state] of this.cells.entries()) {
      if (state === CellState.UNKNOWN) return false;
    }

    // Check all constraints
    if (this.hasBlackPool()) return false;
    if (!this.checkRoomConstraints()) return false;
    if (!this.isWhiteConnected()) return false;
    if (this.hasSameTypeAdjacent()) return false;

    // Each room must have a valid tetromino
    for (let roomId = 0; roomId < this.rooms.length; roomId++) {
      const whiteCells = this.getRoomWhiteCells(roomId);
      if (whiteCells.length !== InvlitsoField.WHITE_COUNT) return false;
      if (getTetrominoType(whiteCells) === null) return false;
    }

    return true;
  }

  solveAndCheck(): boolean {
    // Check for immediate contradictions
    if (this.hasBlackPool()) return false;
    if (!this.checkRoomConstraints()) return false;

    let changed = true;
    while (changed) {
      changed = false;

      if (this.solveRoomConstraints()) changed = true;
      if (this.preventPools()) changed = true;
      if (this.capacitySolve()) changed = true;

      // Recheck constraints after changes
      if (this.hasBlackPool()) return false;
      if (!this.checkRoomConstraints()) return false;
    }

    // Check connectivity and same-type adjacency
    if (!this.isWhiteConnected()) return false;
    if (this.hasSameTypeAdjacent()) return false;

    return true;
  }

  toString(): string {
    const lines: string[] = [];
    for (let row = 0; row < this.height; row++) {
      let line = '';
      for (let col = 0; col < this.width; col++) {
        const state = this.cells.get(row, col);
        line += state === CellState.WHITE ? '·' : state === CellState.BLACK ? '█' : '?';
      }
      lines.push(line);
    }
    return lines.join('\n');
  }

  /** Get unknown cells for branching */
  getUnknownCells(): Position[] {
    const unknowns: Position[] = [];
    for (const [pos, state] of this.cells.entries()) {
      if (state === CellState.UNKNOWN) {
        unknowns.push(pos);
      }
    }
    return unknowns;
  }
}

// ============================================
// Invlitso Solver
// ============================================

export class InvlitsoSolver extends BaseSolver<InvlitsoField> {
  constructor(field: InvlitsoField) {
    super(field);
  }

  /**
   * Create solver from room data
   */
  static fromRooms(
    height: number,
    width: number,
    rooms: InvlitsoRoom[]
  ): InvlitsoSolver {
    const field = new InvlitsoField(height, width);
    field.setRooms(rooms);
    return new InvlitsoSolver(field);
  }

  /**
   * Create solver from wall data
   */
  static fromWalls(
    height: number,
    width: number,
    horizontalWalls: boolean[][],
    verticalWalls: boolean[][]
  ): InvlitsoSolver {
    // Convert walls to rooms using flood fill
    const visited = new Grid(height, width, () => false);
    const rooms: InvlitsoRoom[] = [];

    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        if (visited.get(row, col)) continue;

        // Flood fill to find room
        const members: Position[] = [];
        const queue: Position[] = [{ row, col }];
        visited.set(row, col, true);

        while (queue.length > 0) {
          const pos = queue.shift()!;
          members.push(pos);

          // Check each direction
          // Up
          if (pos.row > 0 && !verticalWalls[pos.row - 1]?.[pos.col] && !visited.get(pos.row - 1, pos.col)) {
            visited.set(pos.row - 1, pos.col, true);
            queue.push({ row: pos.row - 1, col: pos.col });
          }
          // Down
          if (pos.row < height - 1 && !verticalWalls[pos.row]?.[pos.col] && !visited.get(pos.row + 1, pos.col)) {
            visited.set(pos.row + 1, pos.col, true);
            queue.push({ row: pos.row + 1, col: pos.col });
          }
          // Left
          if (pos.col > 0 && !horizontalWalls[pos.row]?.[pos.col - 1] && !visited.get(pos.row, pos.col - 1)) {
            visited.set(pos.row, pos.col - 1, true);
            queue.push({ row: pos.row, col: pos.col - 1 });
          }
          // Right
          if (pos.col < width - 1 && !horizontalWalls[pos.row]?.[pos.col] && !visited.get(pos.row, pos.col + 1)) {
            visited.set(pos.row, pos.col + 1, true);
            queue.push({ row: pos.row, col: pos.col + 1 });
          }
        }

        rooms.push({ members });
      }
    }

    return InvlitsoSolver.fromRooms(height, width, rooms);
  }

  protected getBranchCandidates(state: InvlitsoField): BranchCandidate<InvlitsoField>[] {
    const unknowns = state.getUnknownCells();
    if (unknowns.length === 0) return [];

    const pos = unknowns[0];

    return [
      {
        apply: (s) => {
          const cloned = s.clone();
          cloned.setWhite(pos.row, pos.col);
          return cloned;
        },
        description: `Set (${pos.row}, ${pos.col}) to WHITE`,
      },
      {
        apply: (s) => {
          const cloned = s.clone();
          cloned.setBlack(pos.row, pos.col);
          return cloned;
        },
        description: `Set (${pos.row}, ${pos.col}) to BLACK`,
      },
    ];
  }
}
