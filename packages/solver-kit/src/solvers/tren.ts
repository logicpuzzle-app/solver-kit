/**
 * Tren (Train) Solver
 *
 * Rules:
 * 1. Move train cars on the grid
 * 2. Numbers indicate how many cells the train moves
 * 3. Trains move in straight lines (horizontal or vertical)
 * 4. Trains cannot overlap after moving
 */

import { Position, posKey } from '../core/types.js';
import { FieldState, Grid } from '../core/field.js';
import { BaseSolver, BranchCandidate } from '../core/solver.js';

// ============================================
// Tren Types
// ============================================

export enum TrenDirection {
  HORIZONTAL = 0,
  VERTICAL = 1,
}

interface Train {
  id: number;
  cells: Position[];
  direction: TrenDirection;
  moveCount: number | null;
  currentOffset: number;
}

// ============================================
// Tren Field State
// ============================================

export class TrenField implements FieldState<TrenField> {
  readonly height: number;
  readonly width: number;
  /** Train definitions */
  private trains: Train[];
  /** Cell to train mapping */
  private cellToTrain: Grid<number>;
  /** Wall cells */
  private walls: Grid<boolean>;

  constructor(height: number, width: number) {
    this.height = height;
    this.width = width;
    this.trains = [];
    this.cellToTrain = new Grid(height, width, () => -1);
    this.walls = new Grid(height, width, () => false);
  }

  setWall(row: number, col: number): void {
    this.walls.set(row, col, true);
  }

  addTrain(cells: Position[], direction: TrenDirection, moveCount: number | null): void {
    const id = this.trains.length;
    this.trains.push({ id, cells, direction, moveCount, currentOffset: 0 });
    for (const cell of cells) {
      this.cellToTrain.set(cell.row, cell.col, id);
    }
  }

  moveTrain(trainId: number, offset: number): boolean {
    const train = this.trains[trainId];
    if (!train) return false;

    // Check if move is valid
    for (const cell of train.cells) {
      const newRow = train.direction === TrenDirection.VERTICAL ? cell.row + offset : cell.row;
      const newCol = train.direction === TrenDirection.HORIZONTAL ? cell.col + offset : cell.col;

      if (newRow < 0 || newRow >= this.height || newCol < 0 || newCol >= this.width) {
        return false;
      }
      if (this.walls.get(newRow, newCol)) {
        return false;
      }
    }

    // Clear old positions
    for (const cell of train.cells) {
      this.cellToTrain.set(cell.row, cell.col, -1);
    }

    // Update cells
    const newCells: Position[] = [];
    for (const cell of train.cells) {
      const newRow = train.direction === TrenDirection.VERTICAL ? cell.row + offset : cell.row;
      const newCol = train.direction === TrenDirection.HORIZONTAL ? cell.col + offset : cell.col;
      newCells.push({ row: newRow, col: newCol });
    }
    train.cells = newCells;
    train.currentOffset = offset;

    // Set new positions
    for (const cell of train.cells) {
      this.cellToTrain.set(cell.row, cell.col, trainId);
    }

    return true;
  }

  checkNoOverlap(): boolean {
    const occupied = new Set<string>();
    for (const train of this.trains) {
      for (const cell of train.cells) {
        const key = posKey(cell);
        if (occupied.has(key)) return false;
        occupied.add(key);
      }
    }
    return true;
  }

  clone(): TrenField {
    const cloned = new TrenField(this.height, this.width);
    cloned.trains = this.trains.map(t => ({
      id: t.id,
      cells: t.cells.map(c => ({ ...c })),
      direction: t.direction,
      moveCount: t.moveCount,
      currentOffset: t.currentOffset,
    }));
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        cloned.cellToTrain.set(row, col, this.cellToTrain.get(row, col));
        cloned.walls.set(row, col, this.walls.get(row, col));
      }
    }
    return cloned;
  }

  getStateDump(): string {
    return this.trains.map(t => t.currentOffset).join(':');
  }

  isSolved(): boolean {
    // All trains with move counts must have moved that exact amount
    for (const train of this.trains) {
      if (train.moveCount !== null && Math.abs(train.currentOffset) !== train.moveCount) {
        return false;
      }
    }
    return this.checkNoOverlap();
  }

  solveAndCheck(): boolean {
    return this.checkNoOverlap();
  }

  toString(): string {
    const lines: string[] = [];
    for (let row = 0; row < this.height; row++) {
      let line = '';
      for (let col = 0; col < this.width; col++) {
        if (this.walls.get(row, col)) {
          line += '#';
        } else {
          const trainId = this.cellToTrain.get(row, col);
          if (trainId >= 0) {
            line += String.fromCharCode('A'.charCodeAt(0) + (trainId % 26));
          } else {
            line += '.';
          }
        }
      }
      lines.push(line);
    }
    return lines.join('\n');
  }

  getTrains(): Train[] {
    return this.trains;
  }

  getUnmovedTrains(): number[] {
    return this.trains
      .filter(t => t.currentOffset === 0 && t.moveCount !== null)
      .map(t => t.id);
  }
}

// ============================================
// Tren Solver
// ============================================

export class TrenSolver extends BaseSolver<TrenField> {
  constructor(field: TrenField) {
    super(field);
  }

  static fromString(height: number, width: number, param: string): TrenSolver {
    const field = new TrenField(height, width);

    // Simple parsing - each train is defined by its cells
    const ALPHABET_FROM_G = 'ghijklmnopqrstuvwxyz';
    let index = 0;

    for (let i = 0; i < param.length && index < height * width; i++) {
      const ch = param[i];
      const interval = ALPHABET_FROM_G.indexOf(ch);

      if (interval !== -1) {
        index += interval + 1;
      } else if (ch === '#' || ch === '+') {
        const row = Math.floor(index / width);
        const col = index % width;
        field.setWall(row, col);
        index++;
      } else {
        index++;
      }
    }

    return new TrenSolver(field);
  }

  protected getBranchCandidates(state: TrenField): BranchCandidate<TrenField>[] {
    const unmovedTrains = state.getUnmovedTrains();
    if (unmovedTrains.length === 0) return [];

    const trainId = unmovedTrains[0];
    const train = state.getTrains()[trainId];
    const candidates: BranchCandidate<TrenField>[] = [];

    // Try positive offset
    if (train.moveCount !== null) {
      candidates.push({
        apply: (s) => {
          const cloned = s.clone();
          cloned.moveTrain(trainId, train.moveCount!);
          return cloned;
        },
        description: `Move train ${trainId} by +${train.moveCount}`,
      });

      // Try negative offset
      candidates.push({
        apply: (s) => {
          const cloned = s.clone();
          cloned.moveTrain(trainId, -train.moveCount!);
          return cloned;
        },
        description: `Move train ${trainId} by -${train.moveCount}`,
      });
    }

    return candidates;
  }
}
