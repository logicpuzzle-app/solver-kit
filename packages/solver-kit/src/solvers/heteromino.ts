/**
 * Heteromino Solver
 *
 * Rules:
 * 1. Divide the grid into triominoes (3-cell shapes)
 * 2. Each triomino is either L-shaped or I-shaped (straight)
 * 3. Same shape triominoes cannot share an edge
 * 4. Black cells cannot be part of any triomino
 */

import { posKey } from '../core/types.js';
import { FieldState, Grid } from '../core/field.js';
import { BaseSolver, BranchCandidate } from '../core/solver.js';

// ============================================
// Heteromino Types
// ============================================

/**
 * Shape types for triominoes
 * 1: L-shape, bottom-right missing (┘)
 * 2: L-shape, bottom-left missing (└)
 * 3: L-shape, top-right missing (┐)
 * 4: L-shape, top-left missing (┌)
 * 5: I-shape vertical (│)
 * 6: I-shape horizontal (─)
 */
export type ShapeType = 1 | 2 | 3 | 4 | 5 | 6;

export interface Shape {
  type: ShapeType;
  positions: Set<string>; // Set of posKey strings
}

// ============================================
// Heteromino Field State
// ============================================

export class HeterominoField implements FieldState<HeterominoField> {
  readonly height: number;
  readonly width: number;
  /** Black cells (obstacles) */
  private blackCells: Grid<boolean>;
  /** Candidate shapes */
  private shapeCand: Shape[];
  /** Fixed (confirmed) shapes */
  private shapeFixed: Shape[];

  constructor(height: number, width: number) {
    this.height = height;
    this.width = width;
    this.blackCells = new Grid(height, width, () => false);
    this.shapeCand = [];
    this.shapeFixed = [];
  }

  /** Mark a cell as black (obstacle) */
  setBlack(row: number, col: number): void {
    this.blackCells.set(row, col, true);
  }

  /** Check if cell is black */
  isBlack(row: number, col: number): boolean {
    return this.blackCells.get(row, col);
  }

  /** Initialize shape candidates */
  initCandidates(): void {
    this.shapeCand = this.makeShapeCandidates();
    this.shapeFixed = [];
  }

  /** Generate all possible shape candidates */
  private makeShapeCandidates(): Shape[] {
    const candidates: Shape[] = [];

    // L-shaped (4 orientations)
    for (let row = 0; row < this.height - 1; row++) {
      for (let col = 0; col < this.width - 1; col++) {
        const basePos = posKey({ row, col });
        const rightPos = posKey({ row, col: col + 1 });
        const downPos = posKey({ row: row + 1, col });
        const oppositePos = posKey({ row: row + 1, col: col + 1 });

        // Type 1: bottom-right missing (base, right, down)
        if (
          !this.blackCells.get(row, col) &&
          !this.blackCells.get(row, col + 1) &&
          !this.blackCells.get(row + 1, col)
        ) {
          candidates.push({
            type: 1,
            positions: new Set([basePos, rightPos, downPos]),
          });
        }

        // Type 2: bottom-left missing (base, right, opposite)
        if (
          !this.blackCells.get(row, col) &&
          !this.blackCells.get(row, col + 1) &&
          !this.blackCells.get(row + 1, col + 1)
        ) {
          candidates.push({
            type: 2,
            positions: new Set([basePos, rightPos, oppositePos]),
          });
        }

        // Type 3: top-right missing (base, down, opposite)
        if (
          !this.blackCells.get(row, col) &&
          !this.blackCells.get(row + 1, col) &&
          !this.blackCells.get(row + 1, col + 1)
        ) {
          candidates.push({
            type: 3,
            positions: new Set([basePos, downPos, oppositePos]),
          });
        }

        // Type 4: top-left missing (right, down, opposite)
        if (
          !this.blackCells.get(row, col + 1) &&
          !this.blackCells.get(row + 1, col) &&
          !this.blackCells.get(row + 1, col + 1)
        ) {
          candidates.push({
            type: 4,
            positions: new Set([rightPos, downPos, oppositePos]),
          });
        }
      }
    }

    // I-shaped vertical (type 5)
    for (let row = 0; row < this.height - 2; row++) {
      for (let col = 0; col < this.width; col++) {
        if (
          !this.blackCells.get(row, col) &&
          !this.blackCells.get(row + 1, col) &&
          !this.blackCells.get(row + 2, col)
        ) {
          candidates.push({
            type: 5,
            positions: new Set([
              posKey({ row, col }),
              posKey({ row: row + 1, col }),
              posKey({ row: row + 2, col }),
            ]),
          });
        }
      }
    }

    // I-shaped horizontal (type 6)
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width - 2; col++) {
        if (
          !this.blackCells.get(row, col) &&
          !this.blackCells.get(row, col + 1) &&
          !this.blackCells.get(row, col + 2)
        ) {
          candidates.push({
            type: 6,
            positions: new Set([
              posKey({ row, col }),
              posKey({ row, col: col + 1 }),
              posKey({ row, col: col + 2 }),
            ]),
          });
        }
      }
    }

    return candidates;
  }

  /** Check if a shape is banned by a fixed shape */
  private isBanned(fixed: Shape, other: Shape): boolean {
    // Overlap is not allowed
    for (const pos of other.positions) {
      if (fixed.positions.has(pos)) {
        return true;
      }
    }

    // Same type shapes cannot be adjacent
    if (fixed.type === other.type) {
      for (const posStr of other.positions) {
        const [row, col] = posStr.split(',').map(Number);
        const adjacentKeys = [
          posKey({ row: row + 1, col }),
          posKey({ row: row - 1, col }),
          posKey({ row, col: col + 1 }),
          posKey({ row, col: col - 1 }),
        ];
        for (const adjKey of adjacentKeys) {
          if (fixed.positions.has(adjKey)) {
            return true;
          }
        }
      }
    }

    return false;
  }

  /** Remove banned candidates based on fixed shapes */
  private shapeSolve(): boolean {
    for (const fixed of this.shapeFixed) {
      this.shapeCand = this.shapeCand.filter((cand) => !this.isBanned(fixed, cand));
    }

    // Check if fixed shapes conflict with each other
    for (let i = 0; i < this.shapeFixed.length; i++) {
      for (let j = i + 1; j < this.shapeFixed.length; j++) {
        if (this.isBanned(this.shapeFixed[i], this.shapeFixed[j])) {
          return false;
        }
      }
    }

    return true;
  }

  /** Check if all non-black cells can be covered */
  private countSolve(): boolean {
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        if (this.blackCells.get(row, col)) continue;

        const key = posKey({ row, col });

        // Check if already fixed
        let isFixed = false;
        for (const fixed of this.shapeFixed) {
          if (fixed.positions.has(key)) {
            isFixed = true;
            break;
          }
        }
        if (isFixed) continue;

        // Find candidates covering this cell
        const coveringCands: Shape[] = [];
        for (const cand of this.shapeCand) {
          if (cand.positions.has(key)) {
            coveringCands.push(cand);
          }
        }

        // No candidate can cover this cell
        if (coveringCands.length === 0) {
          return false;
        }

        // Only one candidate - promote to fixed
        if (coveringCands.length === 1) {
          const onlyCand = coveringCands[0];
          this.shapeCand = this.shapeCand.filter((c) => c !== onlyCand);
          this.shapeFixed.push(onlyCand);
        }
      }
    }

    return true;
  }

  // ========== FieldState implementation ==========

  clone(): HeterominoField {
    const cloned = new HeterominoField(this.height, this.width);
    for (const [pos, val] of this.blackCells.entries()) {
      cloned.blackCells.set(pos, val);
    }
    cloned.shapeCand = this.shapeCand.map((s) => ({
      type: s.type,
      positions: new Set(s.positions),
    }));
    cloned.shapeFixed = this.shapeFixed.map((s) => ({
      type: s.type,
      positions: new Set(s.positions),
    }));
    return cloned;
  }

  getStateDump(): string {
    return `${this.shapeFixed.length}:${this.shapeCand.length}`;
  }

  isSolved(): boolean {
    return this.shapeCand.length === 0 && this.solveAndCheck();
  }

  solveAndCheck(): boolean {
    if (!this.shapeSolve()) return false;
    if (!this.countSolve()) return false;
    return true;
  }

  toString(): string {
    const grid: string[][] = [];
    for (let row = 0; row < this.height; row++) {
      grid.push([]);
      for (let col = 0; col < this.width; col++) {
        if (this.blackCells.get(row, col)) {
          grid[row].push('■');
        } else {
          grid[row].push('.');
        }
      }
    }

    // Mark fixed shapes
    const typeChars = ['', '┘', '└', '┐', '┌', '│', '─'];
    for (let i = 0; i < this.shapeFixed.length; i++) {
      const shape = this.shapeFixed[i];
      const char = typeChars[shape.type];
      for (const posStr of shape.positions) {
        const [row, col] = posStr.split(',').map(Number);
        grid[row][col] = char;
      }
    }

    return grid.map((row) => row.join(' ')).join('\n');
  }

  /** Get shape candidates for branching */
  getShapeCandidates(): Shape[] {
    return this.shapeCand;
  }

  /** Get fixed shapes */
  getFixedShapes(): Shape[] {
    return this.shapeFixed;
  }

  /** Fix a shape (move from candidate to fixed) */
  fixShape(shape: Shape): void {
    this.shapeCand = this.shapeCand.filter((s) => s !== shape);
    this.shapeFixed.push(shape);
  }

  /** Remove a shape from candidates */
  removeCandidate(shape: Shape): void {
    this.shapeCand = this.shapeCand.filter((s) => s !== shape);
  }
}

// ============================================
// Heteromino Solver
// ============================================

export class HeterominoSolver extends BaseSolver<HeterominoField> {
  constructor(field: HeterominoField) {
    super(field);
  }

  /** Create solver from puzzle string array */
  static fromString(height: number, width: number, puzzle: string[]): HeterominoSolver {
    const field = new HeterominoField(height, width);

    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const ch = puzzle[row]?.[col];
        if (ch === '#' || ch === '■') {
          field.setBlack(row, col);
        }
      }
    }

    field.initCandidates();
    return new HeterominoSolver(field);
  }

  protected getBranchCandidates(state: HeterominoField): BranchCandidate<HeterominoField>[] {
    const candidates = state.getShapeCandidates();
    if (candidates.length === 0) return [];

    const shape = candidates[0];

    return [
      {
        apply: (s) => {
          const cloned = s.clone();
          cloned.fixShape(
            cloned.getShapeCandidates().find(
              (c) =>
                c.type === shape.type &&
                [...c.positions].every((p) => shape.positions.has(p))
            )!
          );
          return cloned;
        },
        description: `Fix shape type ${shape.type}`,
      },
      {
        apply: (s) => {
          const cloned = s.clone();
          cloned.removeCandidate(
            cloned.getShapeCandidates().find(
              (c) =>
                c.type === shape.type &&
                [...c.positions].every((p) => shape.positions.has(p))
            )!
          );
          return cloned;
        },
        description: `Remove shape type ${shape.type}`,
      },
    ];
  }
}
