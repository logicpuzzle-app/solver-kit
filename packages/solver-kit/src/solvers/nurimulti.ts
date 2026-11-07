/**
 * Nurimulti Solver
 *
 * Rules:
 * 1. Paint some cells black to form groups of exactly N cells
 * 2. Numbers indicate the size of their white (island) region
 * 3. Each island contains exactly one number
 * 4. No white region can exist without a number or contain multiple numbers
 * 5. Black groups must be exactly blackSize cells (typically 3)
 */

import {
  CellState,
  Position,
  DIRECTIONS,
  Direction,
  adjacent,
  posKey,
} from '../core/types.js';
import { FieldState, Grid } from '../core/field.js';
import { BaseSolver, BranchCandidate } from '../core/solver.js';

// ============================================
// Nurimulti Field State
// ============================================

export class NurimultiField implements FieldState<NurimultiField> {
  readonly height: number;
  readonly width: number;
  /** Black group size constraint */
  readonly blackSize: number;
  /** Cell states (UNKNOWN/WHITE/BLACK) */
  private cells: Grid<CellState>;
  /** Island size numbers (null = no number, -1 = '?' marker) */
  private numbers: Grid<number | null>;
  /** Positions that have been fixed (for optimization) */
  private fixedPositions: Set<string>;

  constructor(height: number, width: number, blackSize: number) {
    this.height = height;
    this.width = width;
    this.blackSize = blackSize;
    this.cells = new Grid(height, width, () => CellState.UNKNOWN);
    this.numbers = new Grid(height, width, () => null);
    this.fixedPositions = new Set();
  }

  /** Set a number clue (also marks as white) */
  setNumber(row: number, col: number, num: number): void {
    this.numbers.set(row, col, num);
    this.cells.set(row, col, CellState.WHITE);
  }

  /** Get number at position */
  getNumber(row: number, col: number): number | null {
    return this.numbers.get(row, col);
  }

  /** Get cell state */
  getCell(row: number, col: number): CellState {
    return this.cells.get(row, col);
  }

  /** Set cell to black */
  setBlack(row: number, col: number): void {
    if (this.numbers.get(row, col) === null) {
      this.cells.set(row, col, CellState.BLACK);
    }
  }

  /** Set cell to white */
  setWhite(row: number, col: number): void {
    this.cells.set(row, col, CellState.WHITE);
  }

  // ========== Helper methods ==========

  /** Get connected white cells from a position */
  private getConnectedWhiteCells(start: Position): Set<string> {
    const region = new Set<string>();
    const queue: Position[] = [start];
    region.add(posKey(start));

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const dir of DIRECTIONS) {
        const next = adjacent(current, dir);
        const key = posKey(next);
        if (
          this.cells.inBounds(next) &&
          this.cells.get(next) === CellState.WHITE &&
          !region.has(key)
        ) {
          region.add(key);
          queue.push(next);
        }
      }
    }

    return region;
  }

  /** Get potential white region (white or unknown, excluding other numbers) */
  private getPotentialWhiteRegion(
    start: Position,
    maxSize: number
  ): Set<string> {
    const region = new Set<string>();
    const queue: Position[] = [start];
    region.add(posKey(start));

    while (queue.length > 0 && region.size <= maxSize) {
      const current = queue.shift()!;
      for (const dir of DIRECTIONS) {
        const next = adjacent(current, dir);
        const key = posKey(next);
        if (
          this.cells.inBounds(next) &&
          this.cells.get(next) !== CellState.BLACK &&
          !region.has(key)
        ) {
          // Don't cross into another number's territory
          const nextNum = this.numbers.get(next);
          if (nextNum !== null && (next.row !== start.row || next.col !== start.col)) {
            continue;
          }
          region.add(key);
          queue.push(next);
        }
      }
    }

    return region;
  }

  /** Get connected black cells from a position */
  private getConnectedBlackCells(start: Position): Set<string> {
    const region = new Set<string>();
    const queue: Position[] = [start];
    region.add(posKey(start));

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const dir of DIRECTIONS) {
        const next = adjacent(current, dir);
        const key = posKey(next);
        if (
          this.cells.inBounds(next) &&
          this.cells.get(next) === CellState.BLACK &&
          !region.has(key)
        ) {
          region.add(key);
          queue.push(next);
        }
      }
    }

    return region;
  }

  /** Get potential black region (black or unknown) */
  private getPotentialBlackRegion(start: Position): Set<string> {
    const region = new Set<string>();
    const queue: Position[] = [start];
    region.add(posKey(start));

    while (queue.length > 0 && region.size <= this.blackSize) {
      const current = queue.shift()!;
      for (const dir of DIRECTIONS) {
        const next = adjacent(current, dir);
        const key = posKey(next);
        if (
          this.cells.inBounds(next) &&
          this.cells.get(next) !== CellState.WHITE &&
          !region.has(key)
        ) {
          region.add(key);
          queue.push(next);
        }
      }
    }

    return region;
  }

  /** Check if white cell can reach a number */
  private canReachNumber(
    pos: Position,
    _excludeFrom?: Direction
  ): { canReach: boolean; foundNumbers: Position[] } {
    const visited = new Set<string>();
    const queue: { pos: Position; from?: Direction }[] = [{ pos, from: _excludeFrom }];
    const foundNumbers: Position[] = [];
    visited.add(posKey(pos));

    while (queue.length > 0) {
      const { pos: current } = queue.shift()!;
      const num = this.numbers.get(current);
      if (num !== null) {
        foundNumbers.push(current);
        if (foundNumbers.length >= 2) {
          return { canReach: false, foundNumbers }; // Two numbers = invalid
        }
      }

      for (const dir of DIRECTIONS) {
        const next = adjacent(current, dir);
        const key = posKey(next);
        if (
          this.cells.inBounds(next) &&
          this.cells.get(next) !== CellState.BLACK &&
          !visited.has(key)
        ) {
          visited.add(key);
          queue.push({ pos: next, from: undefined });
        }
      }
    }

    return { canReach: foundNumbers.length > 0, foundNumbers };
  }

  // ========== Constraint solving ==========

  /** Solve white island size constraints */
  private solveRoomConstraints(): boolean {
    for (const [pos, num] of this.numbers.entries()) {
      if (num === null || num === -1) continue;
      if (this.fixedPositions.has(posKey(pos))) continue;

      // Get current white region
      const whiteRegion = this.getConnectedWhiteCells(pos);

      // Check if region exceeds the number
      if (whiteRegion.size > num) {
        return false; // Room too big
      }

      // Check if multiple numbers in same region
      for (const key of whiteRegion) {
        const [r, c] = key.split(',').map(Number);
        const cellNum = this.numbers.get(r, c);
        if (cellNum !== null && cellNum !== -1 && (r !== pos.row || c !== pos.col)) {
          return false; // Two numbers in same room
        }
      }

      // If room is complete, surround with black
      if (whiteRegion.size === num) {
        this.fixedPositions.add(posKey(pos));
        for (const key of whiteRegion) {
          const [r, c] = key.split(',').map(Number);
          for (const dir of DIRECTIONS) {
            const adj = adjacent({ row: r, col: c }, dir);
            if (
              this.cells.inBounds(adj) &&
              !whiteRegion.has(posKey(adj)) &&
              this.cells.get(adj) === CellState.UNKNOWN
            ) {
              this.setBlack(adj.row, adj.col);
            }
          }
        }
      } else {
        // Check potential region
        const potentialRegion = this.getPotentialWhiteRegion(pos, num);
        if (potentialRegion.size < num) {
          return false; // Can't reach required size
        }
        if (potentialRegion.size === num) {
          // All potential cells must be white
          this.fixedPositions.add(posKey(pos));
          for (const key of potentialRegion) {
            const [r, c] = key.split(',').map(Number);
            if (this.cells.get(r, c) === CellState.UNKNOWN) {
              this.setWhite(r, c);
            }
          }
          // Surround with black
          for (const key of potentialRegion) {
            const [r, c] = key.split(',').map(Number);
            for (const dir of DIRECTIONS) {
              const adj = adjacent({ row: r, col: c }, dir);
              if (
                this.cells.inBounds(adj) &&
                !potentialRegion.has(posKey(adj)) &&
                this.cells.get(adj) === CellState.UNKNOWN
              ) {
                this.setBlack(adj.row, adj.col);
              }
            }
          }
        }
      }
    }

    return true;
  }

  /** Solve black group size constraints */
  private solveBlackConstraints(): boolean {
    for (const [pos, state] of this.cells.entries()) {
      if (state !== CellState.BLACK) continue;
      if (this.fixedPositions.has(posKey(pos))) continue;

      // Get current black region
      const blackRegion = this.getConnectedBlackCells(pos);

      // Check if region exceeds blackSize
      if (blackRegion.size > this.blackSize) {
        return false; // Black group too big
      }

      // If black group is complete, surround with white
      if (blackRegion.size === this.blackSize) {
        this.fixedPositions.add(posKey(pos));
        for (const key of blackRegion) {
          const [r, c] = key.split(',').map(Number);
          for (const dir of DIRECTIONS) {
            const adj = adjacent({ row: r, col: c }, dir);
            if (
              this.cells.inBounds(adj) &&
              !blackRegion.has(posKey(adj)) &&
              this.cells.get(adj) === CellState.UNKNOWN
            ) {
              this.setWhite(adj.row, adj.col);
            }
          }
        }
      } else {
        // Check potential region
        const potentialRegion = this.getPotentialBlackRegion(pos);
        if (potentialRegion.size < this.blackSize) {
          return false; // Can't reach required size
        }
        if (potentialRegion.size === this.blackSize) {
          // All potential cells must be black
          this.fixedPositions.add(posKey(pos));
          for (const key of potentialRegion) {
            const [r, c] = key.split(',').map(Number);
            if (this.cells.get(r, c) === CellState.UNKNOWN) {
              this.setBlack(r, c);
            }
          }
          // Surround with white
          for (const key of potentialRegion) {
            const [r, c] = key.split(',').map(Number);
            for (const dir of DIRECTIONS) {
              const adj = adjacent({ row: r, col: c }, dir);
              if (
                this.cells.inBounds(adj) &&
                !potentialRegion.has(posKey(adj)) &&
                this.cells.get(adj) === CellState.UNKNOWN
              ) {
                this.setWhite(adj.row, adj.col);
              }
            }
          }
        }
      }
    }

    return true;
  }

  /** Ensure no isolated white regions without numbers */
  private solveIsolatedWhite(): boolean {
    // Find all white cells without numbers
    const whiteNoNumber = new Set<string>();
    for (const [pos, state] of this.cells.entries()) {
      if (state === CellState.WHITE && this.numbers.get(pos) === null) {
        whiteNoNumber.add(posKey(pos));
      }
    }

    // Process each connected component
    while (whiteNoNumber.size > 0) {
      const startKeyValue = whiteNoNumber.values().next().value;
      if (!startKeyValue) break;
      const startKey = startKeyValue as string;
      const [r, c] = startKey.split(',').map(Number);
      const start = { row: r, col: c };

      const region = this.getConnectedWhiteCells(start);

      // Check if this region can reach a number
      const { canReach, foundNumbers } = this.canReachNumber(start);

      if (!canReach) {
        return false; // Isolated white region without number
      }

      if (foundNumbers.length >= 2) {
        return false; // White region connects two numbers
      }

      // Remove processed cells
      for (const key of region) {
        whiteNoNumber.delete(key);
      }
    }

    return true;
  }

  // ========== FieldState implementation ==========

  clone(): NurimultiField {
    const cloned = new NurimultiField(this.height, this.width, this.blackSize);
    for (const [pos, state] of this.cells.entries()) {
      cloned.cells.set(pos, state);
    }
    for (const [pos, num] of this.numbers.entries()) {
      cloned.numbers.set(pos, num);
    }
    cloned.fixedPositions = new Set(this.fixedPositions);
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

    // Verify all constraints
    if (!this.solveAndCheck()) return false;

    return true;
  }

  solveAndCheck(): boolean {
    const beforeState = this.getStateDump();

    // Apply constraint propagation
    if (!this.solveRoomConstraints()) return false;
    if (!this.solveBlackConstraints()) return false;
    if (!this.solveIsolatedWhite()) return false;

    // If state changed, recurse
    if (this.getStateDump() !== beforeState) {
      return this.solveAndCheck();
    }

    return true;
  }

  toString(): string {
    const lines: string[] = [];
    for (let row = 0; row < this.height; row++) {
      let line = '';
      for (let col = 0; col < this.width; col++) {
        const num = this.numbers.get(row, col);
        if (num !== null) {
          if (num === -1) {
            line += '?';
          } else if (num < 10) {
            line += String(num);
          } else if (num < 100) {
            line += num;
          } else {
            line += '+';
          }
        } else {
          const state = this.cells.get(row, col);
          line += state === CellState.BLACK ? '█' : state === CellState.WHITE ? '·' : '?';
        }
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
// Nurimulti Solver
// ============================================

export class NurimultiSolver extends BaseSolver<NurimultiField> {
  constructor(field: NurimultiField) {
    super(field);
  }

  /**
   * Parse pzv.jp URL parameter format
   * Format: height/width/blackSize/param
   * param encodes numbers using base16 with special encoding:
   * - Single hex digit (0-9a-f) = number 0-15
   * - '-' followed by 2 hex digits = number 16-255
   * - '+' followed by 3 hex digits = number 256-4095
   * - 'g'-'z' = gap (number of empty cells to skip)
   * - '.' = white cell without number (marker -1)
   */
  static fromString(height: number, width: number, param: string, blackSize = 3): NurimultiSolver {
    const field = new NurimultiField(height, width, blackSize);
    const ALPHABET_FROM_G = 'ghijklmnopqrstuvwxyz';

    let index = 0;
    let i = 0;

    while (i < param.length && index < height * width) {
      const ch = param[i];

      // Check for gap (g-z)
      const gapIndex = ALPHABET_FROM_G.indexOf(ch);
      if (gapIndex !== -1) {
        index += gapIndex + 1;
        i++;
        continue;
      }

      // Marker for white cell without number
      if (ch === '.') {
        const row = Math.floor(index / width);
        const col = index % width;
        field.setNumber(row, col, -1);
        index++;
        i++;
        continue;
      }

      // Parse number
      let num: number;
      if (ch === '-') {
        // 16-255: 2 hex digits
        num = parseInt(param.slice(i + 1, i + 3), 16);
        i += 3;
      } else if (ch === '+') {
        // 256+: 3 hex digits
        num = parseInt(param.slice(i + 1, i + 4), 16);
        i += 4;
      } else {
        // 0-15: single hex digit
        num = parseInt(ch, 16);
        i++;
      }

      const row = Math.floor(index / width);
      const col = index % width;
      field.setNumber(row, col, num);
      index++;
    }

    return new NurimultiSolver(field);
  }

  protected getBranchCandidates(state: NurimultiField): BranchCandidate<NurimultiField>[] {
    const unknowns = state.getUnknownCells();
    if (unknowns.length === 0) return [];

    // Pick first unknown cell
    const pos = unknowns[0];

    return [
      {
        apply: (s) => {
          const cloned = s.clone();
          cloned.setBlack(pos.row, pos.col);
          return cloned;
        },
        description: `Set (${pos.row}, ${pos.col}) to BLACK`,
      },
      {
        apply: (s) => {
          const cloned = s.clone();
          cloned.setWhite(pos.row, pos.col);
          return cloned;
        },
        description: `Set (${pos.row}, ${pos.col}) to WHITE`,
      },
    ];
  }
}
