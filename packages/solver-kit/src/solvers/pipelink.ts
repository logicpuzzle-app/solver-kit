/**
 * Pipelink Solver
 *
 * Rules:
 * 1. Connect all cells with a single closed loop (or multiple loops that pass through every cell)
 * 2. Each cell has either 0, 2, or 4 connections (crossings are allowed)
 * 3. Some cells have predetermined pipe shapes (L, I, T, +)
 * 4. The loop(s) must pass through all cells exactly once or cross
 */

import { Position, Direction, posKey } from '../core/types.js';
import { FieldState, Grid } from '../core/field.js';
import { BaseSolver, BranchCandidate } from '../core/solver.js';
import { LoopEdgeState } from './simpleloop.js';

// ============================================
// Pipelink Types
// ============================================

/** Pipe shape types - indicates which directions are connected */
export type PipeShape =
  | 'cross' // + shape - all 4 directions
  | 'vertical' // │ shape - up and down
  | 'horizontal' // ─ shape - left and right
  | 'corner_ne' // └ shape - up and right
  | 'corner_se' // ┌ shape - down and right
  | 'corner_sw' // ┐ shape - down and left
  | 'corner_nw'; // ┘ shape - up and left

// ============================================
// Pipelink Field State
// ============================================

export class PipelinkField implements FieldState<PipelinkField> {
  readonly height: number;
  readonly width: number;
  /** Horizontal edges (between col and col+1) - LINE means loop passes through */
  private yokoEdge: Grid<LoopEdgeState>;
  /** Vertical edges (between row and row+1) */
  private tateEdge: Grid<LoopEdgeState>;
  /** Cells with fixed pipe shapes */
  private fixedCells: Set<string>;

  constructor(height: number, width: number) {
    this.height = height;
    this.width = width;
    this.yokoEdge = new Grid(height, width - 1, () => LoopEdgeState.UNKNOWN);
    this.tateEdge = new Grid(height - 1, width, () => LoopEdgeState.UNKNOWN);
    this.fixedCells = new Set();
  }

  /** Set a fixed pipe shape at position */
  setFixedPipe(row: number, col: number, shape: PipeShape): void {
    this.fixedCells.add(posKey({ row, col }));

    // Set edges based on shape
    const up = row > 0;
    const down = row < this.height - 1;
    const left = col > 0;
    const right = col < this.width - 1;

    // First close all edges, then open based on shape
    if (up) this.setTateEdge(row - 1, col, LoopEdgeState.WALL);
    if (down) this.setTateEdge(row, col, LoopEdgeState.WALL);
    if (left) this.setYokoEdge(row, col - 1, LoopEdgeState.WALL);
    if (right) this.setYokoEdge(row, col, LoopEdgeState.WALL);

    switch (shape) {
      case 'cross':
        if (up) this.setTateEdge(row - 1, col, LoopEdgeState.LINE);
        if (down) this.setTateEdge(row, col, LoopEdgeState.LINE);
        if (left) this.setYokoEdge(row, col - 1, LoopEdgeState.LINE);
        if (right) this.setYokoEdge(row, col, LoopEdgeState.LINE);
        break;
      case 'vertical':
        if (up) this.setTateEdge(row - 1, col, LoopEdgeState.LINE);
        if (down) this.setTateEdge(row, col, LoopEdgeState.LINE);
        break;
      case 'horizontal':
        if (left) this.setYokoEdge(row, col - 1, LoopEdgeState.LINE);
        if (right) this.setYokoEdge(row, col, LoopEdgeState.LINE);
        break;
      case 'corner_ne':
        if (up) this.setTateEdge(row - 1, col, LoopEdgeState.LINE);
        if (right) this.setYokoEdge(row, col, LoopEdgeState.LINE);
        break;
      case 'corner_se':
        if (down) this.setTateEdge(row, col, LoopEdgeState.LINE);
        if (right) this.setYokoEdge(row, col, LoopEdgeState.LINE);
        break;
      case 'corner_sw':
        if (down) this.setTateEdge(row, col, LoopEdgeState.LINE);
        if (left) this.setYokoEdge(row, col - 1, LoopEdgeState.LINE);
        break;
      case 'corner_nw':
        if (up) this.setTateEdge(row - 1, col, LoopEdgeState.LINE);
        if (left) this.setYokoEdge(row, col - 1, LoopEdgeState.LINE);
        break;
    }
  }

  /** Check if cell has fixed shape */
  isFixed(row: number, col: number): boolean {
    return this.fixedCells.has(posKey({ row, col }));
  }

  /** Get horizontal edge state */
  getYokoEdge(row: number, col: number): LoopEdgeState {
    if (col < 0 || col >= this.width - 1) return LoopEdgeState.WALL;
    return this.yokoEdge.get(row, col);
  }

  /** Get vertical edge state */
  getTateEdge(row: number, col: number): LoopEdgeState {
    if (row < 0 || row >= this.height - 1) return LoopEdgeState.WALL;
    return this.tateEdge.get(row, col);
  }

  /** Set horizontal edge */
  setYokoEdge(row: number, col: number, state: LoopEdgeState): void {
    if (col >= 0 && col < this.width - 1) {
      this.yokoEdge.set(row, col, state);
    }
  }

  /** Set vertical edge */
  setTateEdge(row: number, col: number, state: LoopEdgeState): void {
    if (row >= 0 && row < this.height - 1) {
      this.tateEdge.set(row, col, state);
    }
  }

  // ========== Constraint solving ==========

  /** Each cell must have 0, 2, or 4 edges */
  private nextSolve(): boolean {
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        let wallCount = 0;
        let lineCount = 0;

        const edgeUp = row === 0 ? LoopEdgeState.WALL : this.getTateEdge(row - 1, col);
        const edgeDown = row === this.height - 1 ? LoopEdgeState.WALL : this.getTateEdge(row, col);
        const edgeLeft = col === 0 ? LoopEdgeState.WALL : this.getYokoEdge(row, col - 1);
        const edgeRight = col === this.width - 1 ? LoopEdgeState.WALL : this.getYokoEdge(row, col);

        if (edgeUp === LoopEdgeState.WALL) wallCount++;
        else if (edgeUp === LoopEdgeState.LINE) lineCount++;
        if (edgeDown === LoopEdgeState.WALL) wallCount++;
        else if (edgeDown === LoopEdgeState.LINE) lineCount++;
        if (edgeLeft === LoopEdgeState.WALL) wallCount++;
        else if (edgeLeft === LoopEdgeState.LINE) lineCount++;
        if (edgeRight === LoopEdgeState.WALL) wallCount++;
        else if (edgeRight === LoopEdgeState.LINE) lineCount++;

        // Invalid: 3 lines and 1 wall, or more than 2 walls with lines
        if (wallCount > 2 || (lineCount === 3 && wallCount === 1)) {
          return false;
        }

        // If 2 walls, remaining 2 must be lines (can't have 0 connections if other cells need this)
        if (wallCount === 2) {
          if (edgeUp === LoopEdgeState.UNKNOWN) this.setTateEdge(row - 1, col, LoopEdgeState.LINE);
          if (edgeDown === LoopEdgeState.UNKNOWN) this.setTateEdge(row, col, LoopEdgeState.LINE);
          if (edgeLeft === LoopEdgeState.UNKNOWN) this.setYokoEdge(row, col - 1, LoopEdgeState.LINE);
          if (edgeRight === LoopEdgeState.UNKNOWN) this.setYokoEdge(row, col, LoopEdgeState.LINE);
        }
        // If 1 wall and 2 lines, remaining must be wall
        else if (wallCount === 1 && lineCount === 2) {
          if (edgeUp === LoopEdgeState.UNKNOWN) this.setTateEdge(row - 1, col, LoopEdgeState.WALL);
          if (edgeDown === LoopEdgeState.UNKNOWN) this.setTateEdge(row, col, LoopEdgeState.WALL);
          if (edgeLeft === LoopEdgeState.UNKNOWN) this.setYokoEdge(row, col - 1, LoopEdgeState.WALL);
          if (edgeRight === LoopEdgeState.UNKNOWN) this.setYokoEdge(row, col, LoopEdgeState.WALL);
        }
        // If 3 lines, remaining must be line (crossing)
        else if (lineCount === 3) {
          if (edgeUp === LoopEdgeState.UNKNOWN) this.setTateEdge(row - 1, col, LoopEdgeState.LINE);
          if (edgeDown === LoopEdgeState.UNKNOWN) this.setTateEdge(row, col, LoopEdgeState.LINE);
          if (edgeLeft === LoopEdgeState.UNKNOWN) this.setYokoEdge(row, col - 1, LoopEdgeState.LINE);
          if (edgeRight === LoopEdgeState.UNKNOWN) this.setYokoEdge(row, col, LoopEdgeState.LINE);
        }
      }
    }
    return true;
  }

  /** Parity check: loop crossings must be even */
  private oddSolve(): boolean {
    // Check horizontal lines (tateEdge)
    for (let row = 0; row < this.height - 1; row++) {
      let lineCount = 0;
      let hasUnknown = false;
      for (let col = 0; col < this.width; col++) {
        const edge = this.tateEdge.get(row, col);
        if (edge === LoopEdgeState.UNKNOWN) {
          hasUnknown = true;
          break;
        } else if (edge === LoopEdgeState.LINE) {
          lineCount++;
        }
      }
      if (!hasUnknown && lineCount % 2 !== 0) return false;
    }

    // Check vertical lines (yokoEdge)
    for (let col = 0; col < this.width - 1; col++) {
      let lineCount = 0;
      let hasUnknown = false;
      for (let row = 0; row < this.height; row++) {
        const edge = this.yokoEdge.get(row, col);
        if (edge === LoopEdgeState.UNKNOWN) {
          hasUnknown = true;
          break;
        } else if (edge === LoopEdgeState.LINE) {
          lineCount++;
        }
      }
      if (!hasUnknown && lineCount % 2 !== 0) return false;
    }

    return true;
  }

  /** Check connectivity - all cells must be part of the loop(s) */
  private connectSolve(): boolean {
    // Find a cell that's not a crossing to start
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        let wallCount = 0;
        const edgeUp = row === 0 ? LoopEdgeState.WALL : this.getTateEdge(row - 1, col);
        const edgeDown = row === this.height - 1 ? LoopEdgeState.WALL : this.getTateEdge(row, col);
        const edgeLeft = col === 0 ? LoopEdgeState.WALL : this.getYokoEdge(row, col - 1);
        const edgeRight = col === this.width - 1 ? LoopEdgeState.WALL : this.getYokoEdge(row, col);

        if (edgeUp === LoopEdgeState.WALL) wallCount++;
        if (edgeDown === LoopEdgeState.WALL) wallCount++;
        if (edgeLeft === LoopEdgeState.WALL) wallCount++;
        if (edgeRight === LoopEdgeState.WALL) wallCount++;

        // Skip potential crossing cells (0 walls)
        if (wallCount === 0) continue;

        const originPos: Position = { row, col };
        const visited = new Set<string>();
        visited.add(posKey(originPos));

        if (this.traceLoop(originPos, originPos, visited, null)) {
          return visited.size === this.height * this.width;
        }
      }
    }
    return true;
  }

  /** Trace the loop from position, preferring straight lines */
  private traceLoop(
    origin: Position,
    pos: Position,
    visited: Set<string>,
    from: Direction | null
  ): boolean {
    const { row, col } = pos;

    // Try to go straight first
    if (from === Direction.DOWN && row > 0 && this.getTateEdge(row - 1, col) === LoopEdgeState.LINE) {
      const next: Position = { row: row - 1, col };
      if (posKey(next) === posKey(origin)) return true;
      visited.add(posKey(next));
      return this.traceLoop(origin, next, visited, Direction.DOWN);
    }
    if (from === Direction.UP && row < this.height - 1 && this.getTateEdge(row, col) === LoopEdgeState.LINE) {
      const next: Position = { row: row + 1, col };
      if (posKey(next) === posKey(origin)) return true;
      visited.add(posKey(next));
      return this.traceLoop(origin, next, visited, Direction.UP);
    }
    if (from === Direction.RIGHT && col > 0 && this.getYokoEdge(row, col - 1) === LoopEdgeState.LINE) {
      const next: Position = { row, col: col - 1 };
      if (posKey(next) === posKey(origin)) return true;
      visited.add(posKey(next));
      return this.traceLoop(origin, next, visited, Direction.RIGHT);
    }
    if (from === Direction.LEFT && col < this.width - 1 && this.getYokoEdge(row, col) === LoopEdgeState.LINE) {
      const next: Position = { row, col: col + 1 };
      if (posKey(next) === posKey(origin)) return true;
      visited.add(posKey(next));
      return this.traceLoop(origin, next, visited, Direction.LEFT);
    }

    // Check if straight is still possible but unknown
    if (from === Direction.DOWN && row > 0 && this.getTateEdge(row - 1, col) !== LoopEdgeState.WALL) {
      return false;
    }
    if (from === Direction.UP && row < this.height - 1 && this.getTateEdge(row, col) !== LoopEdgeState.WALL) {
      return false;
    }
    if (from === Direction.RIGHT && col > 0 && this.getYokoEdge(row, col - 1) !== LoopEdgeState.WALL) {
      return false;
    }
    if (from === Direction.LEFT && col < this.width - 1 && this.getYokoEdge(row, col) !== LoopEdgeState.WALL) {
      return false;
    }

    // Try turning
    if (from !== Direction.UP && row > 0 && this.getTateEdge(row - 1, col) === LoopEdgeState.LINE) {
      const next: Position = { row: row - 1, col };
      if (posKey(next) === posKey(origin)) return true;
      visited.add(posKey(next));
      return this.traceLoop(origin, next, visited, Direction.DOWN);
    }
    if (from !== Direction.DOWN && row < this.height - 1 && this.getTateEdge(row, col) === LoopEdgeState.LINE) {
      const next: Position = { row: row + 1, col };
      if (posKey(next) === posKey(origin)) return true;
      visited.add(posKey(next));
      return this.traceLoop(origin, next, visited, Direction.UP);
    }
    if (from !== Direction.LEFT && col > 0 && this.getYokoEdge(row, col - 1) === LoopEdgeState.LINE) {
      const next: Position = { row, col: col - 1 };
      if (posKey(next) === posKey(origin)) return true;
      visited.add(posKey(next));
      return this.traceLoop(origin, next, visited, Direction.RIGHT);
    }
    if (from !== Direction.RIGHT && col < this.width - 1 && this.getYokoEdge(row, col) === LoopEdgeState.LINE) {
      const next: Position = { row, col: col + 1 };
      if (posKey(next) === posKey(origin)) return true;
      visited.add(posKey(next));
      return this.traceLoop(origin, next, visited, Direction.LEFT);
    }

    return false;
  }

  // ========== FieldState implementation ==========

  clone(): PipelinkField {
    const cloned = new PipelinkField(this.height, this.width);
    for (const [pos, edge] of this.yokoEdge.entries()) {
      cloned.yokoEdge.set(pos, edge);
    }
    for (const [pos, edge] of this.tateEdge.entries()) {
      cloned.tateEdge.set(pos, edge);
    }
    cloned.fixedCells = new Set(this.fixedCells);
    return cloned;
  }

  getStateDump(): string {
    let dump = '';
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width - 1; col++) {
        const e = this.yokoEdge.get(row, col);
        dump += e === LoopEdgeState.LINE ? 'L' : e === LoopEdgeState.WALL ? 'W' : 'U';
      }
    }
    for (let row = 0; row < this.height - 1; row++) {
      for (let col = 0; col < this.width; col++) {
        const e = this.tateEdge.get(row, col);
        dump += e === LoopEdgeState.LINE ? 'L' : e === LoopEdgeState.WALL ? 'W' : 'U';
      }
    }
    return dump;
  }

  isSolved(): boolean {
    // All edges must be determined
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width - 1; col++) {
        if (this.yokoEdge.get(row, col) === LoopEdgeState.UNKNOWN) return false;
      }
    }
    for (let row = 0; row < this.height - 1; row++) {
      for (let col = 0; col < this.width; col++) {
        if (this.tateEdge.get(row, col) === LoopEdgeState.UNKNOWN) return false;
      }
    }
    return this.solveAndCheck();
  }

  solveAndCheck(): boolean {
    let changed = true;
    while (changed) {
      const beforeDump = this.getStateDump();

      if (!this.nextSolve()) return false;
      if (!this.oddSolve()) return false;

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
        const edgeUp = row === 0 ? LoopEdgeState.WALL : this.getTateEdge(row - 1, col);
        const edgeDown = row === this.height - 1 ? LoopEdgeState.WALL : this.getTateEdge(row, col);
        const edgeLeft = col === 0 ? LoopEdgeState.WALL : this.getYokoEdge(row, col - 1);
        const edgeRight = col === this.width - 1 ? LoopEdgeState.WALL : this.getYokoEdge(row, col);

        const u = edgeUp === LoopEdgeState.LINE;
        const d = edgeDown === LoopEdgeState.LINE;
        const l = edgeLeft === LoopEdgeState.LINE;
        const r = edgeRight === LoopEdgeState.LINE;

        if (u && d && l && r) cellLine += '┼';
        else if (u && d) cellLine += '│';
        else if (l && r) cellLine += '─';
        else if (u && r) cellLine += '└';
        else if (d && r) cellLine += '┌';
        else if (u && l) cellLine += '┘';
        else if (d && l) cellLine += '┐';
        else cellLine += '·';

        if (col < this.width - 1) {
          const edge = this.yokoEdge.get(row, col);
          cellLine += edge === LoopEdgeState.LINE ? '─' : edge === LoopEdgeState.WALL ? ' ' : '?';
        }
      }
      lines.push(cellLine);

      if (row < this.height - 1) {
        let edgeLine = '';
        for (let col = 0; col < this.width; col++) {
          const edge = this.tateEdge.get(row, col);
          edgeLine += edge === LoopEdgeState.LINE ? '│' : edge === LoopEdgeState.WALL ? ' ' : '?';
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
        if (this.yokoEdge.get(row, col) === LoopEdgeState.UNKNOWN) {
          unknowns.push({ type: 'h', row, col });
        }
      }
    }

    for (let row = 0; row < this.height - 1; row++) {
      for (let col = 0; col < this.width; col++) {
        if (this.tateEdge.get(row, col) === LoopEdgeState.UNKNOWN) {
          unknowns.push({ type: 'v', row, col });
        }
      }
    }

    return unknowns;
  }
}

// ============================================
// Pipelink Solver
// ============================================

export class PipelinkSolver extends BaseSolver<PipelinkField> {
  constructor(field: PipelinkField) {
    super(field);
  }

  /** Create solver with fixed pipe shapes */
  static create(
    height: number,
    width: number,
    config: {
      pipes?: Array<{ row: number; col: number; shape: PipeShape }>;
    }
  ): PipelinkSolver {
    const field = new PipelinkField(height, width);

    if (config.pipes) {
      for (const pipe of config.pipes) {
        field.setFixedPipe(pipe.row, pipe.col, pipe.shape);
      }
    }

    return new PipelinkSolver(field);
  }

  protected getBranchCandidates(state: PipelinkField): BranchCandidate<PipelinkField>[] {
    const unknowns = state.getUnknownEdges();
    if (unknowns.length === 0) return [];

    const edge = unknowns[0];

    return [
      {
        apply: (s) => {
          const cloned = s.clone();
          if (edge.type === 'h') {
            cloned.setYokoEdge(edge.row, edge.col, LoopEdgeState.LINE);
          } else {
            cloned.setTateEdge(edge.row, edge.col, LoopEdgeState.LINE);
          }
          return cloned;
        },
        description: `Set ${edge.type === 'h' ? 'horizontal' : 'vertical'} edge at (${edge.row}, ${edge.col}) to LINE`,
      },
      {
        apply: (s) => {
          const cloned = s.clone();
          if (edge.type === 'h') {
            cloned.setYokoEdge(edge.row, edge.col, LoopEdgeState.WALL);
          } else {
            cloned.setTateEdge(edge.row, edge.col, LoopEdgeState.WALL);
          }
          return cloned;
        },
        description: `Set ${edge.type === 'h' ? 'horizontal' : 'vertical'} edge at (${edge.row}, ${edge.col}) to WALL`,
      },
    ];
  }
}
