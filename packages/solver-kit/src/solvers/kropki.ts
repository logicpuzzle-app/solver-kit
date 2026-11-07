/**
 * Kropki Solver
 *
 * Rules:
 * 1. Fill the grid with numbers 1 to N (Latin square - each number once per row/column)
 * 2. Black dot (●): One adjacent number is twice the other (1:2 ratio)
 * 3. White dot (○): Adjacent numbers differ by 1 (consecutive)
 * 4. No dot: Neither of the above conditions holds
 */

import { FieldState } from '../core/field.js';
import { BaseSolver, BranchCandidate } from '../core/solver.js';

// ============================================
// Kropki Types
// ============================================

/** Dot type between cells */
export enum DotType {
  /** No dot - numbers are not consecutive and not in 1:2 ratio */
  SPACE = 'space',
  /** White dot - numbers are consecutive (differ by 1) */
  WHITE = 'white',
  /** Black dot - one number is twice the other */
  BLACK = 'black',
}

// ============================================
// Kropki Field State
// ============================================

export class KropkiField implements FieldState<KropkiField> {
  readonly height: number;
  readonly width: number;
  /** Number candidates for each cell */
  private numbersCand: number[][][];
  /** Horizontal dots: yokoDot[y][x] is dot between (y,x) and (y,x+1) */
  private yokoDot: DotType[][];
  /** Vertical dots: tateDot[y][x] is dot between (y,x) and (y+1,x) */
  private tateDot: DotType[][];

  constructor(height: number, width: number) {
    this.height = height;
    this.width = width;
    this.numbersCand = [];
    this.yokoDot = [];
    this.tateDot = [];

    // Initialize candidates: 1 to max(height, width)
    const maxNum = Math.max(height, width);
    for (let y = 0; y < height; y++) {
      this.numbersCand[y] = [];
      for (let x = 0; x < width; x++) {
        this.numbersCand[y][x] = [];
        for (let n = 1; n <= maxNum; n++) {
          this.numbersCand[y][x].push(n);
        }
      }
    }

    // Initialize dots as SPACE
    for (let y = 0; y < height; y++) {
      this.yokoDot[y] = new Array(width - 1).fill(DotType.SPACE);
    }
    for (let y = 0; y < height - 1; y++) {
      this.tateDot[y] = new Array(width).fill(DotType.SPACE);
    }
  }

  /** Set dots and initialize constraints */
  setDots(yokoDot: DotType[][], tateDot: DotType[][]): void {
    this.yokoDot = yokoDot;
    this.tateDot = tateDot;
    this.initConstraints();
  }

  /** Initialize constraints based on dots */
  private initConstraints(): void {
    const maxNum = Math.max(this.height, this.width);

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const upDot = y > 0 ? this.tateDot[y - 1][x] : null;
        const rightDot = x < this.width - 1 ? this.yokoDot[y][x] : null;
        const downDot = y < this.height - 1 ? this.tateDot[y][x] : null;
        const leftDot = x > 0 ? this.yokoDot[y][x - 1] : null;

        // If surrounded by black dots on opposite sides, eliminate odd and >half numbers
        if (
          (upDot === DotType.BLACK && downDot === DotType.BLACK) ||
          (rightDot === DotType.BLACK && leftDot === DotType.BLACK)
        ) {
          this.numbersCand[y][x] = this.numbersCand[y][x].filter(
            (cand) => cand % 2 === 0 && cand * 2 <= maxNum
          );
        }
        // If adjacent to any black dot, eliminate odd numbers that are >half
        else if (
          upDot === DotType.BLACK ||
          rightDot === DotType.BLACK ||
          downDot === DotType.BLACK ||
          leftDot === DotType.BLACK
        ) {
          this.numbersCand[y][x] = this.numbersCand[y][x].filter(
            (cand) => !(cand % 2 === 1 && cand * 2 > maxNum)
          );
        }
      }
    }
  }

  /** Latin square constraint: eliminate same number in same row/column */
  private roomSolve(): boolean {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const cands = this.numbersCand[y][x];

        if (cands.length !== 1) {
          // Remove determined numbers from same row/column
          for (let targetY = 0; targetY < this.height; targetY++) {
            if (targetY !== y && this.numbersCand[targetY][x].length === 1) {
              const val = this.numbersCand[targetY][x][0];
              this.numbersCand[y][x] = this.numbersCand[y][x].filter((c) => c !== val);
            }
          }
          for (let targetX = 0; targetX < this.width; targetX++) {
            if (targetX !== x && this.numbersCand[y][targetX].length === 1) {
              const val = this.numbersCand[y][targetX][0];
              this.numbersCand[y][x] = this.numbersCand[y][x].filter((c) => c !== val);
            }
          }
          if (this.numbersCand[y][x].length === 0) return false;
        }

        // Hidden single check
        if (this.numbersCand[y][x].length !== 1) {
          for (const cand of this.numbersCand[y][x]) {
            // Check column (if height >= width)
            if (this.height >= this.width) {
              let isHiddenSingle = true;
              for (let targetY = 0; targetY < this.height; targetY++) {
                if (targetY !== y && this.numbersCand[targetY][x].includes(cand)) {
                  isHiddenSingle = false;
                  break;
                }
              }
              if (isHiddenSingle) {
                this.numbersCand[y][x] = [cand];
                break;
              }
            }

            // Check row (if width >= height)
            if (this.width >= this.height) {
              let isHiddenSingle = true;
              for (let targetX = 0; targetX < this.width; targetX++) {
                if (targetX !== x && this.numbersCand[y][targetX].includes(cand)) {
                  isHiddenSingle = false;
                  break;
                }
              }
              if (isHiddenSingle) {
                this.numbersCand[y][x] = [cand];
                break;
              }
            }
          }
        }
      }
    }
    return true;
  }

  /** Dot constraint: apply kropki rules */
  private aroundSolve(): boolean {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const upCands = y > 0 ? this.numbersCand[y - 1][x] : null;
        const rightCands = x < this.width - 1 ? this.numbersCand[y][x + 1] : null;
        const downCands = y < this.height - 1 ? this.numbersCand[y + 1][x] : null;
        const leftCands = x > 0 ? this.numbersCand[y][x - 1] : null;

        const upDot = y > 0 ? this.tateDot[y - 1][x] : null;
        const rightDot = x < this.width - 1 ? this.yokoDot[y][x] : null;
        const downDot = y < this.height - 1 ? this.tateDot[y][x] : null;
        const leftDot = x > 0 ? this.yokoDot[y][x - 1] : null;

        // Apply constraint for each direction
        if (!this.applyDotConstraint(y, x, upCands, upDot)) return false;
        if (!this.applyDotConstraint(y, x, rightCands, rightDot)) return false;
        if (!this.applyDotConstraint(y, x, downCands, downDot)) return false;
        if (!this.applyDotConstraint(y, x, leftCands, leftDot)) return false;
      }
    }
    return true;
  }

  /** Apply dot constraint between current cell and neighbor */
  private applyDotConstraint(
    y: number,
    x: number,
    neighborCands: number[] | null,
    dot: DotType | null
  ): boolean {
    if (neighborCands === null || dot === null) return true;

    if (dot === DotType.BLACK) {
      // Black dot: one must be twice the other
      const validCands = new Set<number>();
      for (const cand of neighborCands) {
        validCands.add(cand * 2);
        if (cand % 2 === 0) {
          validCands.add(cand / 2);
        }
      }
      this.numbersCand[y][x] = this.numbersCand[y][x].filter((c) => validCands.has(c));
    } else if (dot === DotType.WHITE) {
      // White dot: must differ by 1
      const validCands = new Set<number>();
      for (const cand of neighborCands) {
        validCands.add(cand + 1);
        validCands.add(cand - 1);
      }
      this.numbersCand[y][x] = this.numbersCand[y][x].filter((c) => validCands.has(c));
    } else {
      // No dot: must NOT satisfy black or white conditions
      // Find numbers that would satisfy black or white with ALL neighbor candidates
      const invalidCands = new Set<number>();
      for (const cand of neighborCands) {
        const oneCand = new Set<number>();
        // Add black dot matches
        oneCand.add(cand * 2);
        if (cand % 2 === 0) {
          oneCand.add(cand / 2);
        }
        // Add white dot matches
        oneCand.add(cand + 1);
        oneCand.add(cand - 1);

        if (invalidCands.size === 0) {
          for (const c of oneCand) {
            invalidCands.add(c);
          }
        } else {
          // Keep only those that appear in ALL neighbor candidates
          for (const c of invalidCands) {
            if (!oneCand.has(c)) {
              invalidCands.delete(c);
            }
          }
          if (invalidCands.size === 0) break;
        }
      }
      this.numbersCand[y][x] = this.numbersCand[y][x].filter((c) => !invalidCands.has(c));
    }

    return this.numbersCand[y][x].length > 0;
  }

  // ========== FieldState implementation ==========

  clone(): KropkiField {
    const cloned = new KropkiField(this.height, this.width);
    cloned.numbersCand = this.numbersCand.map((row) => row.map((cands) => [...cands]));
    cloned.yokoDot = this.yokoDot.map((row) => [...row]);
    cloned.tateDot = this.tateDot.map((row) => [...row]);
    return cloned;
  }

  getStateDump(): string {
    let dump = '';
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        dump += this.numbersCand[y][x].length + ':';
      }
    }
    return dump;
  }

  isSolved(): boolean {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.numbersCand[y][x].length !== 1) return false;
      }
    }
    return this.solveAndCheck();
  }

  solveAndCheck(): boolean {
    let changed = true;
    while (changed) {
      const befStr = this.getStateDump();
      if (!this.roomSolve()) return false;
      if (!this.aroundSolve()) return false;
      changed = this.getStateDump() !== befStr;
    }
    return true;
  }

  toString(): string {
    const lines: string[] = [];
    for (let y = 0; y < this.height; y++) {
      let line = '';
      for (let x = 0; x < this.width; x++) {
        const cands = this.numbersCand[y][x];
        if (cands.length === 0) {
          line += 'X';
        } else if (cands.length === 1) {
          line += String(cands[0]);
        } else {
          line += '?';
        }
        if (x < this.width - 1) {
          const dot = this.yokoDot[y][x];
          line += dot === DotType.BLACK ? '●' : dot === DotType.WHITE ? '○' : ' ';
        }
      }
      lines.push(line);
      if (y < this.height - 1) {
        let dotLine = '';
        for (let x = 0; x < this.width; x++) {
          const dot = this.tateDot[y][x];
          dotLine += dot === DotType.BLACK ? '●' : dot === DotType.WHITE ? '○' : ' ';
          if (x < this.width - 1) {
            dotLine += ' ';
          }
        }
        lines.push(dotLine);
      }
    }
    return lines.join('\n');
  }

  /** Get branching info */
  getBranchInfo(): { row: number; col: number; candidates: number[] } | null {
    let minCount = Infinity;
    let bestPos: { row: number; col: number } | null = null;

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const count = this.numbersCand[y][x].length;
        if (count > 1 && count < minCount) {
          minCount = count;
          bestPos = { row: y, col: x };
        }
      }
    }

    if (!bestPos) return null;
    return {
      row: bestPos.row,
      col: bestPos.col,
      candidates: this.numbersCand[bestPos.row][bestPos.col],
    };
  }

  /** Set cell to specific value */
  setCell(row: number, col: number, value: number): void {
    this.numbersCand[row][col] = [value];
  }
}

// ============================================
// Kropki Solver
// ============================================

export class KropkiSolver extends BaseSolver<KropkiField> {
  constructor(field: KropkiField) {
    super(field);
  }

  /** Create solver from pzprv3 URL parameter */
  static fromString(height: number, width: number, param: string): KropkiSolver {
    const field = new KropkiField(height, width);

    // Initialize dots
    const yokoDot: DotType[][] = [];
    const tateDot: DotType[][] = [];

    for (let y = 0; y < height; y++) {
      yokoDot[y] = new Array(width - 1).fill(DotType.SPACE);
    }
    for (let y = 0; y < height - 1; y++) {
      tateDot[y] = new Array(width).fill(DotType.SPACE);
    }

    // Parse parameter - 3 values per character (base 27)
    let index = 0;
    const totalDots = height * (width - 1) + (height - 1) * width;

    for (let i = 0; i < param.length && index < totalDots; i++) {
      const ch = param[i];
      const bitInfo = parseInt(ch, 36);
      const pos1 = Math.floor(bitInfo / 9) % 3;
      const pos2 = Math.floor(bitInfo / 3) % 3;
      const pos3 = bitInfo % 3;

      const values = [pos1, pos2, pos3];
      for (const val of values) {
        if (index >= totalDots) break;

        const isTate = index >= height * (width - 1);
        const useIndex = isTate ? index - height * (width - 1) : index;
        const dot = val === 0 ? DotType.SPACE : val === 1 ? DotType.WHITE : DotType.BLACK;

        if (!isTate) {
          const y = Math.floor(useIndex / (width - 1));
          const x = useIndex % (width - 1);
          yokoDot[y][x] = dot;
        } else {
          const y = Math.floor(useIndex / width);
          const x = useIndex % width;
          tateDot[y][x] = dot;
        }
        index++;
      }
    }

    field.setDots(yokoDot, tateDot);
    return new KropkiSolver(field);
  }

  protected getBranchCandidates(state: KropkiField): BranchCandidate<KropkiField>[] {
    const branchInfo = state.getBranchInfo();
    if (!branchInfo) return [];

    const { row, col, candidates } = branchInfo;

    return candidates.map((cand) => ({
      apply: (s) => {
        const cloned = s.clone();
        cloned.setCell(row, col, cand);
        return cloned;
      },
      description: `Set (${row}, ${col}) to ${cand}`,
    }));
  }
}
