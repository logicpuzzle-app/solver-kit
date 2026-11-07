/**
 * Guide Arrow Solver
 *
 * Rules:
 * 1. Draw a path from start to goal
 * 2. Arrows indicate the direction the path must travel through that cell
 * 3. The path cannot cross itself
 * 4. All arrows must be passed through
 */

import { WallState } from '../core/types.js';
import { FieldState, Grid } from '../core/field.js';
import { BaseSolver, BranchCandidate } from '../core/solver.js';

// ============================================
// Guide Arrow Types
// ============================================

export enum GuidearrowDirection {
  NONE = 0,
  UP = 1,
  DOWN = 2,
  LEFT = 3,
  RIGHT = 4,
  START = 5,
  GOAL = 6,
}

// ============================================
// Guide Arrow Field State
// ============================================

export class GuidearrowField implements FieldState<GuidearrowField> {
  readonly height: number;
  readonly width: number;
  /** Arrow directions at cells */
  private arrows: Grid<GuidearrowDirection>;
  /** Horizontal edges (path between cells) */
  private yokoEdge: Grid<WallState>;
  /** Vertical edges (path between cells) */
  private tateEdge: Grid<WallState>;

  constructor(height: number, width: number) {
    this.height = height;
    this.width = width;
    this.arrows = new Grid(height, width, () => GuidearrowDirection.NONE);
    this.yokoEdge = new Grid(height, width - 1, () => WallState.UNKNOWN);
    this.tateEdge = new Grid(height - 1, width, () => WallState.UNKNOWN);
  }

  setArrow(row: number, col: number, dir: GuidearrowDirection): void {
    this.arrows.set(row, col, dir);
  }

  getYokoEdge(row: number, col: number): WallState {
    if (col < 0 || col >= this.width - 1) return WallState.WALL;
    return this.yokoEdge.get(row, col);
  }

  getTateEdge(row: number, col: number): WallState {
    if (row < 0 || row >= this.height - 1) return WallState.WALL;
    return this.tateEdge.get(row, col);
  }

  setYokoEdge(row: number, col: number, state: WallState): void {
    if (col >= 0 && col < this.width - 1) {
      this.yokoEdge.set(row, col, state);
    }
  }

  setTateEdge(row: number, col: number, state: WallState): void {
    if (row >= 0 && row < this.height - 1) {
      this.tateEdge.set(row, col, state);
    }
  }

  private countEdges(row: number, col: number): { paths: number; walls: number; unknowns: number } {
    let paths = 0;
    let walls = 0;
    let unknowns = 0;

    const edgeUp = row === 0 ? WallState.WALL : this.getTateEdge(row - 1, col);
    const edgeDown = row === this.height - 1 ? WallState.WALL : this.getTateEdge(row, col);
    const edgeLeft = col === 0 ? WallState.WALL : this.getYokoEdge(row, col - 1);
    const edgeRight = col === this.width - 1 ? WallState.WALL : this.getYokoEdge(row, col);

    for (const edge of [edgeUp, edgeDown, edgeLeft, edgeRight]) {
      if (edge === WallState.NO_WALL) paths++;
      else if (edge === WallState.WALL) walls++;
      else unknowns++;
    }

    return { paths, walls, unknowns };
  }

  private pathSolve(): boolean {
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        const arrow = this.arrows.get(row, col);
        const { paths, walls, unknowns } = this.countEdges(row, col);

        // Start/Goal cells have 1 path, others have 0 or 2
        const isEndpoint = arrow === GuidearrowDirection.START || arrow === GuidearrowDirection.GOAL;

        if (isEndpoint) {
          if (paths > 1) return false;
          if (paths === 1) {
            // Close remaining
            if (row > 0 && this.getTateEdge(row - 1, col) === WallState.UNKNOWN)
              this.setTateEdge(row - 1, col, WallState.WALL);
            if (row < this.height - 1 && this.getTateEdge(row, col) === WallState.UNKNOWN)
              this.setTateEdge(row, col, WallState.WALL);
            if (col > 0 && this.getYokoEdge(row, col - 1) === WallState.UNKNOWN)
              this.setYokoEdge(row, col - 1, WallState.WALL);
            if (col < this.width - 1 && this.getYokoEdge(row, col) === WallState.UNKNOWN)
              this.setYokoEdge(row, col, WallState.WALL);
          }
        } else if (arrow !== GuidearrowDirection.NONE) {
          // Arrow cell needs exactly 2 paths
          if (paths > 2) return false;
          if (paths === 2) {
            if (row > 0 && this.getTateEdge(row - 1, col) === WallState.UNKNOWN)
              this.setTateEdge(row - 1, col, WallState.WALL);
            if (row < this.height - 1 && this.getTateEdge(row, col) === WallState.UNKNOWN)
              this.setTateEdge(row, col, WallState.WALL);
            if (col > 0 && this.getYokoEdge(row, col - 1) === WallState.UNKNOWN)
              this.setYokoEdge(row, col - 1, WallState.WALL);
            if (col < this.width - 1 && this.getYokoEdge(row, col) === WallState.UNKNOWN)
              this.setYokoEdge(row, col, WallState.WALL);
          } else if (walls >= 2 && paths + unknowns === 2) {
            // Must use remaining for path
            if (row > 0 && this.getTateEdge(row - 1, col) === WallState.UNKNOWN)
              this.setTateEdge(row - 1, col, WallState.NO_WALL);
            if (row < this.height - 1 && this.getTateEdge(row, col) === WallState.UNKNOWN)
              this.setTateEdge(row, col, WallState.NO_WALL);
            if (col > 0 && this.getYokoEdge(row, col - 1) === WallState.UNKNOWN)
              this.setYokoEdge(row, col - 1, WallState.NO_WALL);
            if (col < this.width - 1 && this.getYokoEdge(row, col) === WallState.UNKNOWN)
              this.setYokoEdge(row, col, WallState.NO_WALL);
          }

          // Enforce arrow direction
          if (arrow === GuidearrowDirection.UP) {
            if (row > 0 && this.getTateEdge(row - 1, col) === WallState.WALL) return false;
          } else if (arrow === GuidearrowDirection.DOWN) {
            if (row < this.height - 1 && this.getTateEdge(row, col) === WallState.WALL) return false;
          } else if (arrow === GuidearrowDirection.LEFT) {
            if (col > 0 && this.getYokoEdge(row, col - 1) === WallState.WALL) return false;
          } else if (arrow === GuidearrowDirection.RIGHT) {
            if (col < this.width - 1 && this.getYokoEdge(row, col) === WallState.WALL) return false;
          }
        }
      }
    }
    return true;
  }

  clone(): GuidearrowField {
    const cloned = new GuidearrowField(this.height, this.width);
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        cloned.arrows.set(row, col, this.arrows.get(row, col));
      }
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
      for (let col = 0; col < this.width - 1; col++) {
        const e = this.yokoEdge.get(row, col);
        dump += e === WallState.NO_WALL ? 'P' : e === WallState.WALL ? 'W' : 'U';
      }
    }
    for (let row = 0; row < this.height - 1; row++) {
      for (let col = 0; col < this.width; col++) {
        const e = this.tateEdge.get(row, col);
        dump += e === WallState.NO_WALL ? 'P' : e === WallState.WALL ? 'W' : 'U';
      }
    }
    return dump;
  }

  isSolved(): boolean {
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width - 1; col++) {
        if (this.yokoEdge.get(row, col) === WallState.UNKNOWN) return false;
      }
    }
    for (let row = 0; row < this.height - 1; row++) {
      for (let col = 0; col < this.width; col++) {
        if (this.tateEdge.get(row, col) === WallState.UNKNOWN) return false;
      }
    }
    return this.solveAndCheck();
  }

  solveAndCheck(): boolean {
    let changed = true;
    while (changed) {
      const beforeDump = this.getStateDump();
      if (!this.pathSolve()) return false;
      changed = this.getStateDump() !== beforeDump;
    }
    return true;
  }

  toString(): string {
    const lines: string[] = [];
    for (let row = 0; row < this.height; row++) {
      let line = '';
      for (let col = 0; col < this.width; col++) {
        const arrow = this.arrows.get(row, col);
        switch (arrow) {
          case GuidearrowDirection.UP: line += '↑'; break;
          case GuidearrowDirection.DOWN: line += '↓'; break;
          case GuidearrowDirection.LEFT: line += '←'; break;
          case GuidearrowDirection.RIGHT: line += '→'; break;
          case GuidearrowDirection.START: line += 'S'; break;
          case GuidearrowDirection.GOAL: line += 'G'; break;
          default: line += '.'; break;
        }
      }
      lines.push(line);
    }
    return lines.join('\n');
  }

  getUnknownEdges(): Array<{ type: 'h' | 'v'; row: number; col: number }> {
    const unknowns: Array<{ type: 'h' | 'v'; row: number; col: number }> = [];
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width - 1; col++) {
        if (this.yokoEdge.get(row, col) === WallState.UNKNOWN) {
          unknowns.push({ type: 'h', row, col });
        }
      }
    }
    for (let row = 0; row < this.height - 1; row++) {
      for (let col = 0; col < this.width; col++) {
        if (this.tateEdge.get(row, col) === WallState.UNKNOWN) {
          unknowns.push({ type: 'v', row, col });
        }
      }
    }
    return unknowns;
  }
}

// ============================================
// Guide Arrow Solver
// ============================================

export class GuidearrowSolver extends BaseSolver<GuidearrowField> {
  constructor(field: GuidearrowField) {
    super(field);
  }

  static fromString(height: number, width: number, param: string): GuidearrowSolver {
    const field = new GuidearrowField(height, width);

    const ALPHABET_FROM_G = 'ghijklmnopqrstuvwxyz';
    let index = 0;

    for (let i = 0; i < param.length && index < height * width; i++) {
      const ch = param[i];
      const interval = ALPHABET_FROM_G.indexOf(ch);

      if (interval !== -1) {
        index += interval + 1;
      } else {
        const row = Math.floor(index / width);
        const col = index % width;

        let dir = GuidearrowDirection.NONE;
        if (ch === '1') dir = GuidearrowDirection.UP;
        else if (ch === '2') dir = GuidearrowDirection.DOWN;
        else if (ch === '3') dir = GuidearrowDirection.LEFT;
        else if (ch === '4') dir = GuidearrowDirection.RIGHT;
        else if (ch === 'S' || ch === 's') dir = GuidearrowDirection.START;
        else if (ch === 'G' || ch === 'e') dir = GuidearrowDirection.GOAL;

        if (dir !== GuidearrowDirection.NONE && row < height && col < width) {
          field.setArrow(row, col, dir);
        }
        index++;
      }
    }

    return new GuidearrowSolver(field);
  }

  protected getBranchCandidates(state: GuidearrowField): BranchCandidate<GuidearrowField>[] {
    const unknowns = state.getUnknownEdges();
    if (unknowns.length === 0) return [];

    const edge = unknowns[0];

    return [
      {
        apply: (s) => {
          const cloned = s.clone();
          if (edge.type === 'h') {
            cloned.setYokoEdge(edge.row, edge.col, WallState.NO_WALL);
          } else {
            cloned.setTateEdge(edge.row, edge.col, WallState.NO_WALL);
          }
          return cloned;
        },
        description: `Set edge at (${edge.row}, ${edge.col}) to PATH`,
      },
      {
        apply: (s) => {
          const cloned = s.clone();
          if (edge.type === 'h') {
            cloned.setYokoEdge(edge.row, edge.col, WallState.WALL);
          } else {
            cloned.setTateEdge(edge.row, edge.col, WallState.WALL);
          }
          return cloned;
        },
        description: `Set edge at (${edge.row}, ${edge.col}) to WALL`,
      },
    ];
  }
}
