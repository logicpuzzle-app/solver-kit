/**
 * Rectangle Slider Solver
 *
 * Rules:
 * 1. Move rectangles horizontally or vertically
 * 2. Numbers indicate how many cells the rectangle moves
 * 3. Rectangles cannot overlap after moving
 * 4. Rectangles must stay within the grid
 */

import { Rectangle, rect, rectPositions } from '../core/types.js';
import { FieldState, Grid } from '../core/field.js';
import { BaseSolver, BranchCandidate } from '../core/solver.js';

// ============================================
// RectSlider Types
// ============================================

interface SliderRect {
  /** Original rectangle position */
  original: Rectangle;
  /** Number clue (how many cells to move) */
  moveCount: number | null;
  /** Possible final positions */
  candidates: Rectangle[];
}

// ============================================
// RectSlider Field State
// ============================================

export class RectsliderField implements FieldState<RectsliderField> {
  readonly height: number;
  readonly width: number;
  private rectangles: SliderRect[];

  constructor(height: number, width: number) {
    this.height = height;
    this.width = width;
    this.rectangles = [];
  }

  addRectangle(top: number, left: number, bottom: number, right: number, moveCount: number | null): void {
    const original = rect(top, left, bottom, right);
    const candidates = this.generateCandidates(original, moveCount);
    this.rectangles.push({ original, moveCount, candidates });
  }

  private generateCandidates(r: Rectangle, moveCount: number | null): Rectangle[] {
    const candidates: Rectangle[] = [];
    const rectHeight = r.bottom - r.top + 1;
    const rectWidth = r.right - r.left + 1;

    // If no move count specified, allow any valid position
    if (moveCount === null) {
      for (let newTop = 0; newTop <= this.height - rectHeight; newTop++) {
        for (let newLeft = 0; newLeft <= this.width - rectWidth; newLeft++) {
          candidates.push(rect(newTop, newLeft, newTop + rectHeight - 1, newLeft + rectWidth - 1));
        }
      }
      return candidates;
    }

    // Move up
    if (r.top - moveCount >= 0) {
      candidates.push(rect(r.top - moveCount, r.left, r.bottom - moveCount, r.right));
    }

    // Move down
    if (r.bottom + moveCount < this.height) {
      candidates.push(rect(r.top + moveCount, r.left, r.bottom + moveCount, r.right));
    }

    // Move left
    if (r.left - moveCount >= 0) {
      candidates.push(rect(r.top, r.left - moveCount, r.bottom, r.right - moveCount));
    }

    // Move right
    if (r.right + moveCount < this.width) {
      candidates.push(rect(r.top, r.left + moveCount, r.bottom, r.right + moveCount));
    }

    return candidates;
  }

  private rectanglesOverlap(r1: Rectangle, r2: Rectangle): boolean {
    return !(r1.right < r2.left || r2.right < r1.left ||
             r1.bottom < r2.top || r2.bottom < r1.top);
  }

  private filterConflictingCandidates(): boolean {
    let changed = false;

    for (let i = 0; i < this.rectangles.length; i++) {
      const rect1 = this.rectangles[i];
      const validCandidates: Rectangle[] = [];

      for (const candidate of rect1.candidates) {
        let valid = true;

        for (let j = 0; j < this.rectangles.length && valid; j++) {
          if (i === j) continue;

          const rect2 = this.rectangles[j];
          let hasNonConflicting = false;

          for (const otherCand of rect2.candidates) {
            if (!this.rectanglesOverlap(candidate, otherCand)) {
              hasNonConflicting = true;
              break;
            }
          }

          if (!hasNonConflicting) {
            valid = false;
          }
        }

        if (valid) {
          validCandidates.push(candidate);
        } else {
          changed = true;
        }
      }

      rect1.candidates = validCandidates;
    }

    return changed;
  }

  clone(): RectsliderField {
    const cloned = new RectsliderField(this.height, this.width);
    cloned.rectangles = this.rectangles.map(r => ({
      original: { ...r.original },
      moveCount: r.moveCount,
      candidates: r.candidates.map(c => ({ ...c })),
    }));
    return cloned;
  }

  getStateDump(): string {
    return this.rectangles.map(r => r.candidates.length).join(':');
  }

  isSolved(): boolean {
    for (const rect of this.rectangles) {
      if (rect.candidates.length !== 1) return false;
    }

    for (let i = 0; i < this.rectangles.length; i++) {
      for (let j = i + 1; j < this.rectangles.length; j++) {
        if (this.rectanglesOverlap(this.rectangles[i].candidates[0], this.rectangles[j].candidates[0])) {
          return false;
        }
      }
    }

    return true;
  }

  solveAndCheck(): boolean {
    for (const rect of this.rectangles) {
      if (rect.candidates.length === 0) return false;
    }

    let changed = true;
    while (changed) {
      changed = false;
      if (this.filterConflictingCandidates()) changed = true;

      for (const rect of this.rectangles) {
        if (rect.candidates.length === 0) return false;
      }
    }

    return true;
  }

  toString(): string {
    const grid = new Grid(this.height, this.width, () => '.');

    for (let i = 0; i < this.rectangles.length; i++) {
      const r = this.rectangles[i];
      const label = String.fromCharCode('A'.charCodeAt(0) + (i % 26));

      if (r.candidates.length === 1) {
        for (const pos of rectPositions(r.candidates[0])) {
          grid.set(pos, label);
        }
      }
    }

    const lines: string[] = [];
    for (let row = 0; row < this.height; row++) {
      let line = '';
      for (let col = 0; col < this.width; col++) {
        line += grid.get(row, col);
      }
      lines.push(line);
    }
    return lines.join('\n');
  }

  getMostConstrainedRect(): number {
    let minCandidates = Infinity;
    let bestRect = -1;

    for (let i = 0; i < this.rectangles.length; i++) {
      const count = this.rectangles[i].candidates.length;
      if (count > 1 && count < minCandidates) {
        minCandidates = count;
        bestRect = i;
      }
    }

    return bestRect;
  }

  getRectCandidates(rectIndex: number): Rectangle[] {
    return this.rectangles[rectIndex].candidates;
  }

  setRectPosition(rectIndex: number, position: Rectangle): void {
    this.rectangles[rectIndex].candidates = [position];
  }
}

// ============================================
// RectSlider Solver
// ============================================

export class RectsliderSolver extends BaseSolver<RectsliderField> {
  constructor(field: RectsliderField) {
    super(field);
  }

  static fromString(height: number, width: number, param: string): RectsliderSolver {
    const field = new RectsliderField(height, width);

    // Parse rectangles from param (simplified format)
    // Format: each rectangle as top,left,bottom,right,moveCount separated by ;
    const parts = param.split(';');
    for (const part of parts) {
      if (!part) continue;
      const [t, l, b, r, m] = part.split(',').map(Number);
      if (!isNaN(t) && !isNaN(l) && !isNaN(b) && !isNaN(r)) {
        field.addRectangle(t, l, b, r, isNaN(m) ? null : m);
      }
    }

    return new RectsliderSolver(field);
  }

  protected getBranchCandidates(state: RectsliderField): BranchCandidate<RectsliderField>[] {
    const rectIndex = state.getMostConstrainedRect();
    if (rectIndex === -1) return [];

    const candidates = state.getRectCandidates(rectIndex);

    return candidates.map((pos) => ({
      apply: (s) => {
        const cloned = s.clone();
        cloned.setRectPosition(rectIndex, pos);
        return cloned;
      },
      description: `Set rect ${rectIndex} to (${pos.top},${pos.left})-(${pos.bottom},${pos.right})`,
    }));
  }
}
