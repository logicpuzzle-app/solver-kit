/**
 * Tatamibari Solver
 *
 * Rules:
 * 1. Divide the grid into rectangular regions
 * 2. Each region contains exactly one symbol
 * 3. Symbol types:
 *    - Vertical bar (|): Region must be taller than wide
 *    - Horizontal bar (―): Region must be wider than tall
 *    - Plus (+): Region must be a square
 * 4. Four corners of rectangles cannot meet at a single point
 */

import { Position, Rectangle, posKey, rect, rectContains } from '../core/types.js';
import { FieldState, Grid } from '../core/field.js';
import { BaseSolver, BranchCandidate } from '../core/solver.js';

// ============================================
// Tatamibari Types
// ============================================

/**
 * Symbol types
 * 1: Vertical bar (|) - taller than wide
 * 2: Horizontal bar (―) - wider than tall
 * 3: Plus (+) - square
 */
export type TatamiSymbol = 1 | 2 | 3 | null;

// ============================================
// Tatamibari Field State
// ============================================

export class TatamibariField implements FieldState<TatamibariField> {
  readonly height: number;
  readonly width: number;
  /** Symbol at each cell */
  private symbols: Grid<TatamiSymbol>;
  /** Room candidates for each symbol position */
  private roomCand: Map<string, Rectangle[]>;

  constructor(height: number, width: number) {
    this.height = height;
    this.width = width;
    this.symbols = new Grid(height, width, () => null);
    this.roomCand = new Map();
  }

  /** Set a symbol at position */
  setSymbol(row: number, col: number, symbol: TatamiSymbol): void {
    this.symbols.set(row, col, symbol);
  }

  /** Get symbol at position */
  getSymbol(row: number, col: number): TatamiSymbol {
    return this.symbols.get(row, col);
  }

  /** Initialize room candidates */
  initCandidates(): void {
    this.roomCand = new Map();

    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        const symbol = this.symbols.get(row, col);
        if (symbol === null) continue;

        const key = posKey({ row, col });
        const candidates: Rectangle[] = [];

        for (let ySize = 1; ySize <= this.height; ySize++) {
          for (let xSize = 1; xSize <= this.width; xSize++) {
            // Check symbol constraints
            if (symbol === 1 && ySize <= xSize) continue; // Vertical: taller than wide
            if (symbol === 2 && xSize <= ySize) continue; // Horizontal: wider than tall
            if (symbol === 3 && xSize !== ySize) continue; // Plus: square

            // Generate all valid positions for this size containing (row, col)
            const minY = Math.max(0, row - ySize + 1);
            const maxY = Math.min(this.height - ySize, row);
            const minX = Math.max(0, col - xSize + 1);
            const maxX = Math.min(this.width - xSize, col);

            for (let y = minY; y <= maxY; y++) {
              for (let x = minX; x <= maxX; x++) {
                const rectangle = rect(y, x, y + ySize - 1, x + xSize - 1);

                // Check if this rectangle contains other symbols
                let containsOtherSymbol = false;
                for (let checkY = 0; checkY < this.height; checkY++) {
                  for (let checkX = 0; checkX < this.width; checkX++) {
                    if (checkY === row && checkX === col) continue;
                    if (this.symbols.get(checkY, checkX) !== null) {
                      if (rectContains(rectangle, { row: checkY, col: checkX })) {
                        containsOtherSymbol = true;
                        break;
                      }
                    }
                  }
                  if (containsOtherSymbol) break;
                }

                if (!containsOtherSymbol) {
                  candidates.push(rectangle);
                }
              }
            }
          }
        }

        this.roomCand.set(key, candidates);
      }
    }
  }

  /** Get room candidates for a symbol position */
  getRoomCandidates(row: number, col: number): Rectangle[] {
    return this.roomCand.get(posKey({ row, col })) || [];
  }

  /** Set room candidates for a symbol position */
  setRoomCandidates(row: number, col: number, candidates: Rectangle[]): void {
    this.roomCand.set(posKey({ row, col }), candidates);
  }

  /** Check if two rectangles overlap */
  private rectanglesOverlap(r1: Rectangle, r2: Rectangle): boolean {
    return !(
      r1.right < r2.left ||
      r1.left > r2.right ||
      r1.bottom < r2.top ||
      r1.top > r2.bottom
    );
  }

  /** Check if two rectangles create a 4-corner meeting */
  private cornersMeet(r1: Rectangle, r2: Rectangle): boolean {
    // Top-left corner of r1 meets bottom-right of r2
    if (r1.top === r2.bottom + 1 && r1.left === r2.right + 1) return true;
    // Bottom-right corner of r1 meets top-left of r2
    if (r1.bottom + 1 === r2.top && r1.right + 1 === r2.left) return true;
    return false;
  }

  /** Remove candidates that conflict with fixed rooms */
  private roomSolve(): boolean {
    // Find fixed rooms (candidates with size 1)
    const fixedRooms: { pos: Position; room: Rectangle }[] = [];
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        const cands = this.getRoomCandidates(row, col);
        if (cands.length === 1) {
          fixedRooms.push({ pos: { row, col }, room: cands[0] });
        }
      }
    }

    // Remove conflicting candidates
    for (const fixed of fixedRooms) {
      for (let row = 0; row < this.height; row++) {
        for (let col = 0; col < this.width; col++) {
          if (row === fixed.pos.row && col === fixed.pos.col) continue;

          const cands = this.getRoomCandidates(row, col);
          if (cands.length === 0) continue;

          const filtered = cands.filter((cand) => {
            // Remove if overlaps
            if (this.rectanglesOverlap(fixed.room, cand)) return false;
            // Remove if corners meet
            if (this.cornersMeet(fixed.room, cand)) return false;
            return true;
          });

          if (filtered.length === 0) return false;
          this.setRoomCandidates(row, col, filtered);
        }
      }
    }

    return true;
  }

  /** Check if all cells can be covered by some room */
  private allSolve(): boolean {
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        const pos: Position = { row, col };
        let canBeCovered = false;

        // Check all room candidates
        for (let y = 0; y < this.height; y++) {
          for (let x = 0; x < this.width; x++) {
            const cands = this.getRoomCandidates(y, x);
            for (const cand of cands) {
              if (rectContains(cand, pos)) {
                canBeCovered = true;
                break;
              }
            }
            if (canBeCovered) break;
          }
          if (canBeCovered) break;
        }

        if (!canBeCovered) return false;
      }
    }

    return true;
  }

  // ========== FieldState implementation ==========

  clone(): TatamibariField {
    const cloned = new TatamibariField(this.height, this.width);
    for (const [pos, symbol] of this.symbols.entries()) {
      cloned.symbols.set(pos, symbol);
    }
    for (const [key, cands] of this.roomCand) {
      cloned.roomCand.set(key, [...cands]);
    }
    return cloned;
  }

  getStateDump(): string {
    let dump = '';
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        const cands = this.getRoomCandidates(row, col);
        if (cands.length > 0) {
          dump += cands.length;
        }
      }
    }
    return dump;
  }

  isSolved(): boolean {
    // All room candidates must be fixed (size 1)
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        const cands = this.getRoomCandidates(row, col);
        if (cands.length > 1) return false;
      }
    }
    return this.solveAndCheck();
  }

  solveAndCheck(): boolean {
    let changed = true;
    while (changed) {
      const beforeDump = this.getStateDump();
      if (!this.roomSolve()) return false;
      changed = this.getStateDump() !== beforeDump;
    }
    if (!this.allSolve()) return false;
    return true;
  }

  toString(): string {
    const lines: string[] = [];
    const symbolChars = ['', '|', '―', '+'];

    for (let row = 0; row < this.height; row++) {
      let line = '';
      for (let col = 0; col < this.width; col++) {
        const symbol = this.symbols.get(row, col);
        if (symbol !== null) {
          line += symbolChars[symbol];
        } else {
          line += '.';
        }
      }
      lines.push(line);
    }

    return lines.join('\n');
  }

  /** Get symbol positions with multiple candidates (for branching) */
  getUnfixedSymbols(): Position[] {
    const unfixed: Position[] = [];
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        const cands = this.getRoomCandidates(row, col);
        if (cands.length > 1) {
          unfixed.push({ row, col });
        }
      }
    }
    return unfixed;
  }
}

// ============================================
// Tatamibari Solver
// ============================================

export class TatamibariSolver extends BaseSolver<TatamibariField> {
  constructor(field: TatamibariField) {
    super(field);
  }

  /** Create solver from puzzle string array */
  static fromString(height: number, width: number, puzzle: string[]): TatamibariSolver {
    const field = new TatamibariField(height, width);

    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const ch = puzzle[row]?.[col];
        if (ch === '|' || ch === '1') {
          field.setSymbol(row, col, 1);
        } else if (ch === '-' || ch === '―' || ch === '2') {
          field.setSymbol(row, col, 2);
        } else if (ch === '+' || ch === '3') {
          field.setSymbol(row, col, 3);
        }
      }
    }

    field.initCandidates();
    return new TatamibariSolver(field);
  }

  protected getBranchCandidates(state: TatamibariField): BranchCandidate<TatamibariField>[] {
    const unfixed = state.getUnfixedSymbols();
    if (unfixed.length === 0) return [];

    const pos = unfixed[0];
    const cands = state.getRoomCandidates(pos.row, pos.col);

    return cands.map((cand, i) => ({
      apply: (s) => {
        const cloned = s.clone();
        cloned.setRoomCandidates(pos.row, pos.col, [cand]);
        return cloned;
      },
      description: `Set room at (${pos.row}, ${pos.col}) to candidate ${i}`,
    }));
  }
}
