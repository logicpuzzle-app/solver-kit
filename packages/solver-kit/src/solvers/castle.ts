/**
 * Castle Wall (Castle) Solver
 *
 * Rules:
 * 1. Draw a single closed loop through the grid
 * 2. Arrow clues indicate the number of cells the loop passes through in that direction
 * 3. Arrow cells are obstacles - the loop cannot pass through them
 * 4. Black/white arrow markers indicate if the arrow is inside or outside the loop
 * 5. Each loop cell has exactly 2 edges
 */

import { CellState, Position, Direction, posKey, DIRECTION_DELTA } from '../core/types.js';
import { FieldState, Grid } from '../core/field.js';
import { BaseSolver, BranchCandidate } from '../core/solver.js';
import { LoopEdgeState } from './simpleloop.js';

// ============================================
// Castle Types
// ============================================

/** Arrow clue for Castle puzzle */
export interface CastleArrow {
  direction: Direction;
  count: number; // -1 means unknown count
  /** Inside/outside marker: 'inside' = BLACK marker, 'outside' = WHITE marker, 'unknown' = no marker */
  marker: 'inside' | 'outside' | 'unknown';
}

// ============================================
// Castle Field State
// ============================================

export class CastleField implements FieldState<CastleField> {
  readonly height: number;
  readonly width: number;
  /** Cell states (UNKNOWN = undetermined, WHITE = loop or inside, BLACK = outside) */
  private cells: Grid<CellState>;
  /** Arrow clues - null means no clue at this position */
  private arrows: Grid<CastleArrow | null>;
  /** Horizontal edges (between col and col+1) */
  private yokoEdge: Grid<LoopEdgeState>;
  /** Vertical edges (between row and row+1) */
  private tateEdge: Grid<LoopEdgeState>;

  constructor(height: number, width: number) {
    this.height = height;
    this.width = width;
    this.cells = new Grid(height, width, () => CellState.UNKNOWN);
    this.arrows = new Grid(height, width, () => null);
    this.yokoEdge = new Grid(height, width - 1, () => LoopEdgeState.UNKNOWN);
    this.tateEdge = new Grid(height - 1, width, () => LoopEdgeState.UNKNOWN);
  }

  /** Set an arrow clue at position */
  setArrow(row: number, col: number, direction: Direction, count: number, marker: 'inside' | 'outside' | 'unknown' = 'unknown'): void {
    this.arrows.set(row, col, { direction, count, marker });
    // Arrow cells are black (obstacles, not part of loop)
    this.cells.set(row, col, CellState.BLACK);
    // Close all edges around arrow
    if (row > 0) this.setTateEdge(row - 1, col, LoopEdgeState.EMPTY);
    if (row < this.height - 1) this.setTateEdge(row, col, LoopEdgeState.EMPTY);
    if (col > 0) this.setYokoEdge(row, col - 1, LoopEdgeState.EMPTY);
    if (col < this.width - 1) this.setYokoEdge(row, col, LoopEdgeState.EMPTY);
  }

  /** Get arrow at position */
  getArrow(row: number, col: number): CastleArrow | null {
    return this.arrows.get(row, col);
  }

  /** Get cell state */
  getCell(row: number, col: number): CellState {
    return this.cells.get(row, col);
  }

  /** Set cell state */
  setCell(row: number, col: number, state: CellState): void {
    this.cells.set(row, col, state);
  }

  /** Get horizontal edge state */
  getYokoEdge(row: number, col: number): LoopEdgeState {
    if (col < 0 || col >= this.width - 1) return LoopEdgeState.EMPTY;
    return this.yokoEdge.get(row, col);
  }

  /** Get vertical edge state */
  getTateEdge(row: number, col: number): LoopEdgeState {
    if (row < 0 || row >= this.height - 1) return LoopEdgeState.EMPTY;
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

  /** Arrow constraint: count cells the loop passes through in direction */
  private arrowSolve(): boolean {
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        const arrow = this.arrows.get(row, col);
        if (!arrow || arrow.count === -1) continue;

        let loopCount = 0;
        let unknownCount = 0;
        const positions: Array<{ row: number; col: number; type: 'h' | 'v' }> = [];

        // Collect edges in the arrow direction
        let r = row, c = col;
        const delta = DIRECTION_DELTA[arrow.direction];

        while (true) {
          r += delta.dy;
          c += delta.dx;

          if (r < 0 || r >= this.height || c < 0 || c >= this.width) break;

          // Check the edge crossed to get here
          let edgeState: LoopEdgeState;
          let edgeType: 'h' | 'v';
          let edgeRow: number, edgeCol: number;

          if (arrow.direction === Direction.UP) {
            edgeState = this.getTateEdge(r, c);
            edgeType = 'v';
            edgeRow = r;
            edgeCol = c;
          } else if (arrow.direction === Direction.DOWN) {
            edgeState = this.getTateEdge(r - 1, c);
            edgeType = 'v';
            edgeRow = r - 1;
            edgeCol = c;
          } else if (arrow.direction === Direction.LEFT) {
            edgeState = this.getYokoEdge(r, c);
            edgeType = 'h';
            edgeRow = r;
            edgeCol = c;
          } else {
            edgeState = this.getYokoEdge(r, c - 1);
            edgeType = 'h';
            edgeRow = r;
            edgeCol = c - 1;
          }

          if (edgeState === LoopEdgeState.LINE) {
            loopCount++;
          } else if (edgeState === LoopEdgeState.UNKNOWN) {
            unknownCount++;
            positions.push({ row: edgeRow, col: edgeCol, type: edgeType });
          }
        }

        // Check validity
        if (loopCount > arrow.count) return false;
        if (loopCount + unknownCount < arrow.count) return false;

        // If we've reached the exact count, remaining must be empty
        if (loopCount === arrow.count) {
          for (const pos of positions) {
            if (pos.type === 'h') {
              this.setYokoEdge(pos.row, pos.col, LoopEdgeState.EMPTY);
            } else {
              this.setTateEdge(pos.row, pos.col, LoopEdgeState.EMPTY);
            }
          }
        }

        // If all unknowns must be lines
        if (loopCount + unknownCount === arrow.count) {
          for (const pos of positions) {
            if (pos.type === 'h') {
              this.setYokoEdge(pos.row, pos.col, LoopEdgeState.LINE);
            } else {
              this.setTateEdge(pos.row, pos.col, LoopEdgeState.LINE);
            }
          }
        }
      }
    }
    return true;
  }

  /** Each non-obstacle cell on loop must have exactly 2 edges */
  private nextSolve(): boolean {
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        if (this.arrows.get(row, col) !== null) continue; // Skip arrow cells

        let lineCount = 0;
        let emptyCount = 0;

        const edgeUp = row === 0 ? LoopEdgeState.EMPTY : this.getTateEdge(row - 1, col);
        const edgeDown = row === this.height - 1 ? LoopEdgeState.EMPTY : this.getTateEdge(row, col);
        const edgeLeft = col === 0 ? LoopEdgeState.EMPTY : this.getYokoEdge(row, col - 1);
        const edgeRight = col === this.width - 1 ? LoopEdgeState.EMPTY : this.getYokoEdge(row, col);

        if (edgeUp === LoopEdgeState.EMPTY) emptyCount++;
        else if (edgeUp === LoopEdgeState.LINE) lineCount++;
        if (edgeDown === LoopEdgeState.EMPTY) emptyCount++;
        else if (edgeDown === LoopEdgeState.LINE) lineCount++;
        if (edgeLeft === LoopEdgeState.EMPTY) emptyCount++;
        else if (edgeLeft === LoopEdgeState.LINE) lineCount++;
        if (edgeRight === LoopEdgeState.EMPTY) emptyCount++;
        else if (edgeRight === LoopEdgeState.LINE) lineCount++;

        const cell = this.cells.get(row, col);

        if (cell === CellState.BLACK) {
          // Black cell (not on loop): no lines allowed
          if (lineCount > 0) return false;
          if (edgeUp === LoopEdgeState.UNKNOWN) this.setTateEdge(row - 1, col, LoopEdgeState.EMPTY);
          if (edgeDown === LoopEdgeState.UNKNOWN) this.setTateEdge(row, col, LoopEdgeState.EMPTY);
          if (edgeLeft === LoopEdgeState.UNKNOWN) this.setYokoEdge(row, col - 1, LoopEdgeState.EMPTY);
          if (edgeRight === LoopEdgeState.UNKNOWN) this.setYokoEdge(row, col, LoopEdgeState.EMPTY);
        } else if (cell === CellState.WHITE) {
          // White cell (on loop or inside): must have exactly 2 or 0 lines
          if (lineCount > 2) return false;

          if (lineCount === 2) {
            if (edgeUp === LoopEdgeState.UNKNOWN) this.setTateEdge(row - 1, col, LoopEdgeState.EMPTY);
            if (edgeDown === LoopEdgeState.UNKNOWN) this.setTateEdge(row, col, LoopEdgeState.EMPTY);
            if (edgeLeft === LoopEdgeState.UNKNOWN) this.setYokoEdge(row, col - 1, LoopEdgeState.EMPTY);
            if (edgeRight === LoopEdgeState.UNKNOWN) this.setYokoEdge(row, col, LoopEdgeState.EMPTY);
          } else if (emptyCount >= 2 && lineCount > 0) {
            // Force remaining to be lines
            if (4 - emptyCount <= 2) {
              if (edgeUp === LoopEdgeState.UNKNOWN) this.setTateEdge(row - 1, col, LoopEdgeState.LINE);
              if (edgeDown === LoopEdgeState.UNKNOWN) this.setTateEdge(row, col, LoopEdgeState.LINE);
              if (edgeLeft === LoopEdgeState.UNKNOWN) this.setYokoEdge(row, col - 1, LoopEdgeState.LINE);
              if (edgeRight === LoopEdgeState.UNKNOWN) this.setYokoEdge(row, col, LoopEdgeState.LINE);
            }
          }
        } else {
          // Unknown cell
          if ((emptyCount === 3 && lineCount === 1) || lineCount > 2) {
            return false;
          }
          if (lineCount > 0) {
            this.cells.set(row, col, CellState.WHITE);
          } else if (emptyCount > 2) {
            this.cells.set(row, col, CellState.BLACK);
          }
        }
      }
    }
    return true;
  }

  /** Parity check */
  private oddSolve(): boolean {
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

  /** Connectivity check */
  private connectSolve(): boolean {
    const whitePosSet = new Set<string>();

    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        if (this.arrows.get(row, col) !== null) continue;
        if (this.cells.get(row, col) === CellState.WHITE) {
          // Check if it has any lines (is on loop)
          const hasLine =
            (row > 0 && this.getTateEdge(row - 1, col) === LoopEdgeState.LINE) ||
            (row < this.height - 1 && this.getTateEdge(row, col) === LoopEdgeState.LINE) ||
            (col > 0 && this.getYokoEdge(row, col - 1) === LoopEdgeState.LINE) ||
            (col < this.width - 1 && this.getYokoEdge(row, col) === LoopEdgeState.LINE);

          if (hasLine) {
            const pos: Position = { row, col };
            if (whitePosSet.size === 0) {
              whitePosSet.add(posKey(pos));
              this.collectLoopCells(pos, whitePosSet);
            } else if (!whitePosSet.has(posKey(pos))) {
              return false;
            }
          }
        }
      }
    }
    return true;
  }

  private collectLoopCells(pos: Position, visited: Set<string>): void {
    const { row, col } = pos;

    if (row > 0 && this.getTateEdge(row - 1, col) === LoopEdgeState.LINE) {
      const next: Position = { row: row - 1, col };
      const key = posKey(next);
      if (!visited.has(key)) {
        visited.add(key);
        this.collectLoopCells(next, visited);
      }
    }
    if (row < this.height - 1 && this.getTateEdge(row, col) === LoopEdgeState.LINE) {
      const next: Position = { row: row + 1, col };
      const key = posKey(next);
      if (!visited.has(key)) {
        visited.add(key);
        this.collectLoopCells(next, visited);
      }
    }
    if (col > 0 && this.getYokoEdge(row, col - 1) === LoopEdgeState.LINE) {
      const next: Position = { row, col: col - 1 };
      const key = posKey(next);
      if (!visited.has(key)) {
        visited.add(key);
        this.collectLoopCells(next, visited);
      }
    }
    if (col < this.width - 1 && this.getYokoEdge(row, col) === LoopEdgeState.LINE) {
      const next: Position = { row, col: col + 1 };
      const key = posKey(next);
      if (!visited.has(key)) {
        visited.add(key);
        this.collectLoopCells(next, visited);
      }
    }
  }

  // ========== FieldState implementation ==========

  clone(): CastleField {
    const cloned = new CastleField(this.height, this.width);
    for (const [pos, val] of this.cells.entries()) {
      cloned.cells.set(pos, val);
    }
    for (const [pos, val] of this.arrows.entries()) {
      cloned.arrows.set(pos, val);
    }
    for (const [pos, val] of this.yokoEdge.entries()) {
      cloned.yokoEdge.set(pos, val);
    }
    for (const [pos, val] of this.tateEdge.entries()) {
      cloned.tateEdge.set(pos, val);
    }
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
        const e = this.yokoEdge.get(row, col);
        dump += e === LoopEdgeState.LINE ? 'L' : e === LoopEdgeState.EMPTY ? 'E' : 'U';
      }
    }
    for (let row = 0; row < this.height - 1; row++) {
      for (let col = 0; col < this.width; col++) {
        const e = this.tateEdge.get(row, col);
        dump += e === LoopEdgeState.LINE ? 'L' : e === LoopEdgeState.EMPTY ? 'E' : 'U';
      }
    }
    return dump;
  }

  isSolved(): boolean {
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

      if (!this.arrowSolve()) return false;
      if (!this.nextSolve()) return false;

      changed = this.getStateDump() !== beforeDump;
    }

    if (!this.oddSolve()) return false;
    if (!this.connectSolve()) return false;

    return true;
  }

  toString(): string {
    const lines: string[] = [];

    for (let row = 0; row < this.height; row++) {
      let cellLine = '';
      for (let col = 0; col < this.width; col++) {
        const arrow = this.arrows.get(row, col);
        if (arrow) {
          const dirChar =
            arrow.direction === Direction.UP
              ? '↑'
              : arrow.direction === Direction.DOWN
                ? '↓'
                : arrow.direction === Direction.LEFT
                  ? '←'
                  : '→';
          cellLine += arrow.count === -1 ? dirChar + '?' : dirChar + arrow.count;
        } else {
          const cell = this.cells.get(row, col);
          cellLine += cell === CellState.BLACK ? '■■' : cell === CellState.WHITE ? '··' : '??';
        }

        if (col < this.width - 1) {
          const edge = this.yokoEdge.get(row, col);
          cellLine += edge === LoopEdgeState.LINE ? '─' : edge === LoopEdgeState.EMPTY ? ' ' : '?';
        }
      }
      lines.push(cellLine);

      if (row < this.height - 1) {
        let edgeLine = '';
        for (let col = 0; col < this.width; col++) {
          const edge = this.tateEdge.get(row, col);
          edgeLine += edge === LoopEdgeState.LINE ? ' │ ' : edge === LoopEdgeState.EMPTY ? '   ' : ' ? ';
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
// Castle Solver
// ============================================

export class CastleSolver extends BaseSolver<CastleField> {
  constructor(field: CastleField) {
    super(field);
  }

  /** Create solver with arrow clues */
  static create(
    height: number,
    width: number,
    config: {
      arrows?: Array<{
        row: number;
        col: number;
        direction: Direction;
        count: number;
        marker?: 'inside' | 'outside' | 'unknown';
      }>;
    }
  ): CastleSolver {
    const field = new CastleField(height, width);

    if (config.arrows) {
      for (const arrow of config.arrows) {
        field.setArrow(arrow.row, arrow.col, arrow.direction, arrow.count, arrow.marker || 'unknown');
      }
    }

    return new CastleSolver(field);
  }

  protected getBranchCandidates(state: CastleField): BranchCandidate<CastleField>[] {
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
            cloned.setYokoEdge(edge.row, edge.col, LoopEdgeState.EMPTY);
          } else {
            cloned.setTateEdge(edge.row, edge.col, LoopEdgeState.EMPTY);
          }
          return cloned;
        },
        description: `Set ${edge.type === 'h' ? 'horizontal' : 'vertical'} edge at (${edge.row}, ${edge.col}) to EMPTY`,
      },
    ];
  }
}
