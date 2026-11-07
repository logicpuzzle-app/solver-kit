/**
 * Lookair (Look-Air / Rukkuea) Solver
 *
 * Rules:
 * 1. Shade some cells black
 * 2. Black cells form connected regions that must be perfect squares
 * 3. Two squares of the same size cannot have a direct view of each other
 *    (no straight line of white cells between them)
 * 4. Numbers indicate how many adjacent cells (including itself if black) are shaded
 * 5. Black regions cannot touch orthogonally (only diagonally allowed)
 */

import { CellState, Position, posKey } from '../core/types.js';
import { FieldState, Grid } from '../core/field.js';
import { BaseSolver, BranchCandidate } from '../core/solver.js';

// ============================================
// Lookair Field State
// ============================================

export class LookairField implements FieldState<LookairField> {
  readonly height: number;
  readonly width: number;
  /** Cell states (UNKNOWN/WHITE/BLACK) */
  private cells: Grid<CellState>;
  /** Numbers (null = no number, -1 = unknown) */
  private numbers: Grid<number | null>;

  constructor(height: number, width: number) {
    this.height = height;
    this.width = width;
    this.cells = new Grid(height, width, () => CellState.UNKNOWN);
    this.numbers = new Grid(height, width, () => null);
  }

  /** Set a number clue */
  setNumber(row: number, col: number, num: number): void {
    this.numbers.set(row, col, num);
  }

  /** Get number at position */
  getNumber(row: number, col: number): number | null {
    return this.numbers.get(row, col);
  }

  /** Get cell state */
  getCell(row: number, col: number): CellState {
    if (row < 0 || row >= this.height || col < 0 || col >= this.width) {
      return CellState.WHITE; // Outside is white
    }
    return this.cells.get(row, col);
  }

  /** Set cell to black */
  setBlack(row: number, col: number): void {
    this.cells.set(row, col, CellState.BLACK);
  }

  /** Set cell to white */
  setWhite(row: number, col: number): void {
    this.cells.set(row, col, CellState.WHITE);
  }

  // ========== Constraint solving ==========

  /**
   * Number constraint: count adjacent black cells
   */
  private numberSolve(): boolean {
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        const num = this.numbers.get(row, col);
        if (num === null || num === -1) continue;

        // Count adjacent cells (including self)
        const adjacentCells: Position[] = [
          { row, col },
          { row: row - 1, col },
          { row: row + 1, col },
          { row, col: col - 1 },
          { row, col: col + 1 },
        ];

        let blackCount = 0;
        let whiteCount = 0;
        let unknownCount = 0;
        const unknownCells: Position[] = [];

        for (const pos of adjacentCells) {
          if (pos.row < 0 || pos.row >= this.height || pos.col < 0 || pos.col >= this.width) {
            whiteCount++; // Outside is white
            continue;
          }
          const state = this.cells.get(pos.row, pos.col);
          if (state === CellState.BLACK) {
            blackCount++;
          } else if (state === CellState.WHITE) {
            whiteCount++;
          } else {
            unknownCount++;
            unknownCells.push(pos);
          }
        }

        // Check constraints
        if (blackCount > num) return false;
        if (blackCount + unknownCount < num) return false;

        // If black count matches, remaining must be white
        if (blackCount === num) {
          for (const pos of unknownCells) {
            this.setWhite(pos.row, pos.col);
          }
        }

        // If need all remaining to be black
        if (blackCount + unknownCount === num) {
          for (const pos of unknownCells) {
            this.setBlack(pos.row, pos.col);
          }
        }
      }
    }
    return true;
  }

  /**
   * Square constraint: black regions must form perfect squares
   */
  private squareSolve(): boolean {
    const visited = new Set<string>();

    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        if (this.cells.get(row, col) !== CellState.BLACK) continue;
        const key = posKey({ row, col });
        if (visited.has(key)) continue;

        // Find all connected black cells
        const region = this.getConnectedRegion(row, col, CellState.BLACK);
        for (const pos of region) {
          visited.add(posKey(pos));
        }

        // Check if it forms a square
        if (!this.isSquareRegion(region)) {
          // Check if it can become a square
          if (!this.canBecomeSquare(region)) {
            return false;
          }
        }
      }
    }
    return true;
  }

  /**
   * Get connected region of cells with same state
   */
  private getConnectedRegion(startRow: number, startCol: number, state: CellState): Position[] {
    const region: Position[] = [];
    const visited = new Set<string>();
    const queue: Position[] = [{ row: startRow, col: startCol }];

    while (queue.length > 0) {
      const pos = queue.shift()!;
      const key = posKey(pos);
      if (visited.has(key)) continue;
      if (pos.row < 0 || pos.row >= this.height || pos.col < 0 || pos.col >= this.width) continue;
      if (this.cells.get(pos.row, pos.col) !== state) continue;

      visited.add(key);
      region.push(pos);

      queue.push({ row: pos.row - 1, col: pos.col });
      queue.push({ row: pos.row + 1, col: pos.col });
      queue.push({ row: pos.row, col: pos.col - 1 });
      queue.push({ row: pos.row, col: pos.col + 1 });
    }

    return region;
  }

  /**
   * Check if a region forms a perfect square
   */
  private isSquareRegion(region: Position[]): boolean {
    if (region.length === 0) return false;

    // Find bounding box
    let minRow = Infinity,
      maxRow = -Infinity;
    let minCol = Infinity,
      maxCol = -Infinity;

    for (const pos of region) {
      minRow = Math.min(minRow, pos.row);
      maxRow = Math.max(maxRow, pos.row);
      minCol = Math.min(minCol, pos.col);
      maxCol = Math.max(maxCol, pos.col);
    }

    const height = maxRow - minRow + 1;
    const width = maxCol - minCol + 1;

    if (height !== width) return false;
    if (region.length !== height * width) return false;

    // Verify all cells in bounding box are in region
    const regionSet = new Set(region.map((p) => posKey(p)));
    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        if (!regionSet.has(posKey({ row: r, col: c }))) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Check if a region can potentially become a square
   */
  private canBecomeSquare(region: Position[]): boolean {
    if (region.length === 0) return false;

    // Find bounding box
    let minRow = Infinity,
      maxRow = -Infinity;
    let minCol = Infinity,
      maxCol = -Infinity;

    for (const pos of region) {
      minRow = Math.min(minRow, pos.row);
      maxRow = Math.max(maxRow, pos.row);
      minCol = Math.min(minCol, pos.col);
      maxCol = Math.max(maxCol, pos.col);
    }

    const height = maxRow - minRow + 1;
    const width = maxCol - minCol + 1;
    const size = Math.max(height, width);

    // Check if a size x size square can contain this region
    // and has room to expand to fill the square

    const regionSet = new Set(region.map((p) => posKey(p)));

    // Try all possible positions for the square
    for (let startRow = maxRow - size + 1; startRow <= minRow; startRow++) {
      for (let startCol = maxCol - size + 1; startCol <= minCol; startCol++) {
        let canFit = true;

        for (let r = startRow; r < startRow + size && canFit; r++) {
          for (let c = startCol; c < startCol + size && canFit; c++) {
            if (r < 0 || r >= this.height || c < 0 || c >= this.width) {
              canFit = false;
              break;
            }

            const key = posKey({ row: r, col: c });
            if (regionSet.has(key)) continue; // Part of region

            const state = this.cells.get(r, c);
            if (state === CellState.WHITE) {
              canFit = false; // Can't extend here
            }
          }
        }

        if (canFit) return true;
      }
    }

    return false;
  }

  /**
   * View constraint: same-size squares cannot see each other
   */
  private viewSolve(): boolean {
    // Find all completed squares
    const squares: { pos: Position; size: number }[] = [];
    const visited = new Set<string>();

    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        if (this.cells.get(row, col) !== CellState.BLACK) continue;
        const key = posKey({ row, col });
        if (visited.has(key)) continue;

        const region = this.getConnectedRegion(row, col, CellState.BLACK);
        for (const pos of region) {
          visited.add(posKey(pos));
        }

        if (this.isSquareRegion(region)) {
          // Find top-left corner
          let minRow = Infinity,
            minCol = Infinity;
          for (const pos of region) {
            minRow = Math.min(minRow, pos.row);
            minCol = Math.min(minCol, pos.col);
          }
          const size = Math.sqrt(region.length);
          squares.push({ pos: { row: minRow, col: minCol }, size });
        }
      }
    }

    // Check view between same-size squares
    for (let i = 0; i < squares.length; i++) {
      for (let j = i + 1; j < squares.length; j++) {
        if (squares[i].size !== squares[j].size) continue;

        const sq1 = squares[i];
        const sq2 = squares[j];

        // Check if they can see each other
        if (this.canSee(sq1.pos, sq1.size, sq2.pos, sq2.size)) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Check if two squares can see each other
   */
  private canSee(pos1: Position, size1: number, pos2: Position, size2: number): boolean {
    // Same row range?
    const row1Start = pos1.row;
    const row1End = pos1.row + size1 - 1;
    const row2Start = pos2.row;
    const row2End = pos2.row + size2 - 1;

    const col1Start = pos1.col;
    const col1End = pos1.col + size1 - 1;
    const col2Start = pos2.col;
    const col2End = pos2.col + size2 - 1;

    // Check horizontal view (same row range)
    const rowOverlap = Math.max(row1Start, row2Start) <= Math.min(row1End, row2End);
    if (rowOverlap) {
      const checkRow = Math.max(row1Start, row2Start);

      if (col1End < col2Start) {
        // sq1 is left of sq2
        let allWhite = true;
        for (let c = col1End + 1; c < col2Start; c++) {
          const state = this.cells.get(checkRow, c);
          if (state !== CellState.WHITE) {
            allWhite = false;
            break;
          }
        }
        if (allWhite && col2Start > col1End + 1) return true;
        if (allWhite && col2Start === col1End + 1) return false; // Adjacent, not viewing
      } else if (col2End < col1Start) {
        // sq2 is left of sq1
        let allWhite = true;
        for (let c = col2End + 1; c < col1Start; c++) {
          const state = this.cells.get(checkRow, c);
          if (state !== CellState.WHITE) {
            allWhite = false;
            break;
          }
        }
        if (allWhite && col1Start > col2End + 1) return true;
      }
    }

    // Check vertical view (same column range)
    const colOverlap = Math.max(col1Start, col2Start) <= Math.min(col1End, col2End);
    if (colOverlap) {
      const checkCol = Math.max(col1Start, col2Start);

      if (row1End < row2Start) {
        // sq1 is above sq2
        let allWhite = true;
        for (let r = row1End + 1; r < row2Start; r++) {
          const state = this.cells.get(r, checkCol);
          if (state !== CellState.WHITE) {
            allWhite = false;
            break;
          }
        }
        if (allWhite && row2Start > row1End + 1) return true;
      } else if (row2End < row1Start) {
        // sq2 is above sq1
        let allWhite = true;
        for (let r = row2End + 1; r < row1Start; r++) {
          const state = this.cells.get(r, checkCol);
          if (state !== CellState.WHITE) {
            allWhite = false;
            break;
          }
        }
        if (allWhite && row1Start > row2End + 1) return true;
      }
    }

    return false;
  }

  // ========== FieldState implementation ==========

  clone(): LookairField {
    const cloned = new LookairField(this.height, this.width);
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        cloned.cells.set(row, col, this.cells.get(row, col));
        cloned.numbers.set(row, col, this.numbers.get(row, col));
      }
    }
    return cloned;
  }

  getStateDump(): string {
    return this.cells.dump();
  }

  isSolved(): boolean {
    // All cells must be determined
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        if (this.cells.get(row, col) === CellState.UNKNOWN) return false;
      }
    }
    return true;
  }

  solveAndCheck(): boolean {
    let changed = true;
    while (changed) {
      const beforeDump = this.getStateDump();

      if (!this.numberSolve()) return false;
      if (!this.squareSolve()) return false;

      changed = this.getStateDump() !== beforeDump;
    }

    if (!this.viewSolve()) return false;

    return true;
  }

  toString(): string {
    const lines: string[] = [];
    for (let row = 0; row < this.height; row++) {
      let line = '';
      for (let col = 0; col < this.width; col++) {
        const num = this.numbers.get(row, col);
        const state = this.cells.get(row, col);

        if (num !== null) {
          line += num === -1 ? '?' : String(num);
        } else if (state === CellState.BLACK) {
          line += '█';
        } else if (state === CellState.WHITE) {
          line += '·';
        } else {
          line += '?';
        }
      }
      lines.push(line);
    }
    return lines.join('\n');
  }

  /** Get unknown cells for branching */
  getUnknownCells(): Position[] {
    const unknowns: Position[] = [];
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        if (this.cells.get(row, col) === CellState.UNKNOWN) {
          unknowns.push({ row, col });
        }
      }
    }
    return unknowns;
  }
}

// ============================================
// Lookair Solver
// ============================================

export class LookairSolver extends BaseSolver<LookairField> {
  constructor(field: LookairField) {
    super(field);
  }

  /**
   * Create solver from pzv.jp URL format
   */
  static fromString(height: number, width: number, param: string): LookairSolver {
    const field = new LookairField(height, width);
    const ALPHABET_FROM_G = 'ghijklmnopqrstuvwxyz';

    let index = 0;
    const totalCells = height * width;

    for (let i = 0; i < param.length && index < totalCells; i++) {
      const ch = param[i];
      const row = Math.floor(index / width);
      const col = index % width;

      if (ch === '.') {
        // Unknown number
        field.setNumber(row, col, -1);
        index++;
      } else {
        const interval = ALPHABET_FROM_G.indexOf(ch);
        if (interval !== -1) {
          // Skip cells
          index += interval + 1;
        } else if (ch >= '0' && ch <= '9') {
          // Direct number
          field.setNumber(row, col, parseInt(ch));
          index++;
        } else if (ch >= 'a' && ch <= 'f') {
          // Hex number 10-15
          field.setNumber(row, col, ch.charCodeAt(0) - 'a'.charCodeAt(0) + 10);
          index++;
        } else {
          index++;
        }
      }
    }

    return new LookairSolver(field);
  }

  protected getBranchCandidates(state: LookairField): BranchCandidate<LookairField>[] {
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
