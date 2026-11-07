/*
 * Yajilin Kit — TypeScript reference implementation.
 * Ported from gridkit `frontend/src/puzzle/yajilin/answerModel.ts`.
 *
 * Iteration order of every Set/Map below is part of the contract: `getBlackCells`,
 * `getAllEdge` and the `newBlacks`/`newWhites` intersections in the lookahead all feed
 * positions back into the solver in insertion order.
 */

import { toId, toPos } from "./board.js";
import { equals, type Position } from "./position.js";
import { UnionFind } from "./unionfind.js";

export const LineState = {
  None: -1,
  Blank: 0,
  Line: 1,
  Bar: 2,
} as const;
export type LineState = (typeof LineState)[keyof typeof LineState];

export type AnswerModel = {
  blackCells: Set<number>;
  whiteCells: Set<number>;
  /** Maps one endpoint of a line segment to the opposite endpoint. */
  edge: Map<number, number>;
  lineUf: UnionFind;
  /** Cells the line passes through, endpoints excluded. */
  innerLine: Set<number>;
  /** Keyed by the left cell of the pair. */
  horizontal: Map<number, LineState>;
  /** Keyed by the upper cell of the pair. */
  vertical: Map<number, LineState>;
  hasLoop: boolean;
};

export const createAnswerModel = (): AnswerModel => ({
  blackCells: new Set(),
  whiteCells: new Set(),
  edge: new Map(),
  lineUf: new UnionFind(),
  innerLine: new Set(),
  horizontal: new Map(),
  vertical: new Map(),
  hasLoop: false,
});

export const normalize = (answer: AnswerModel, newLine: Position[]): void => {
  const newEnd1 = toId(newLine[0]!);
  const newEnd2 = toId(newLine[newLine.length - 1]!);
  const prevEnd1 = answer.edge.get(newEnd1);
  const prevEnd2 = answer.edge.get(newEnd2);
  if (prevEnd1 !== undefined && prevEnd2 !== undefined && newEnd1 !== prevEnd2) {
    newLine.forEach((pos, i) => {
      if (i === 0 || i === newLine.length - 1) {
        answer.edge.delete(toId(pos));
      }
      answer.innerLine.add(toId(pos));
      answer.whiteCells.delete(toId(pos));
    });
    answer.edge.set(prevEnd1, prevEnd2);
    answer.edge.set(prevEnd2, prevEnd1);
  } else if (prevEnd1 !== undefined) {
    newLine.forEach((pos, i) => {
      if (i !== newLine.length - 1) {
        answer.innerLine.add(toId(pos));
      }
      answer.whiteCells.delete(toId(pos));
    });
    answer.edge.delete(newEnd1);
    answer.edge.set(newEnd2, prevEnd1);
    answer.edge.set(prevEnd1, newEnd2);
    if (prevEnd2 !== undefined) {
      answer.edge.delete(newEnd2);
      answer.innerLine.add(newEnd2);
      answer.hasLoop = true;
    }
  } else if (prevEnd2 !== undefined) {
    newLine.forEach((pos, i) => {
      if (i !== 0) {
        answer.innerLine.add(toId(pos));
      }
      answer.whiteCells.delete(toId(pos));
    });
    answer.edge.set(newEnd1, prevEnd2);
    answer.edge.set(prevEnd2, newEnd1);
    answer.edge.delete(newEnd2);
  } else {
    newLine.forEach((pos, i) => {
      if (i !== 0 && i !== newLine.length - 1) {
        answer.innerLine.add(toId(pos));
      }
      answer.whiteCells.delete(toId(pos));
    });
    answer.edge.set(newEnd1, newEnd2);
    answer.edge.set(newEnd2, newEnd1);
  }
};

export const addLine = (answer: AnswerModel, line: Position[]): void => {
  line.reduce((prev, cur) => {
    answer.lineUf.connect(toId(prev), toId(cur));
    if (prev.x === cur.x) {
      answer.vertical.set(toId(prev.y < cur.y ? prev : cur), LineState.Line);
    }
    if (prev.y === cur.y) {
      answer.horizontal.set(toId(prev.x < cur.x ? prev : cur), LineState.Line);
    }
    return cur;
  });
  normalize(answer, line);
};

export const isLoop = (line: Position[]): boolean =>
  line.length > 2 && equals(line[0]!, line[line.length - 1]!);

export const hasLine = (answer: AnswerModel, posId: number): boolean =>
  answer.innerLine.has(posId);

export const isLineEdge = (answer: AnswerModel, pos: Position): boolean =>
  answer.edge.has(toId(pos));

export const getEdgeId = (
  answer: AnswerModel,
  pos: Position
): number | undefined => answer.edge.get(toId(pos));

export const getLineState = (
  answer: AnswerModel,
  pos1: Position,
  pos2: Position
): LineState | undefined => {
  if (pos1.x === pos2.x) {
    return answer.vertical.get(toId(pos1.y < pos2.y ? pos1 : pos2));
  }
  if (pos1.y === pos2.y) {
    return answer.horizontal.get(toId(pos1.x < pos2.x ? pos1 : pos2));
  }
  return LineState.None;
};

export const setLineBar = (
  answer: AnswerModel,
  pos1: Position,
  pos2: Position
): void => {
  if (pos1.x === pos2.x) {
    answer.vertical.set(toId(pos1.y < pos2.y ? pos1 : pos2), LineState.Bar);
  }
  if (pos1.y === pos2.y) {
    answer.horizontal.set(toId(pos1.x < pos2.x ? pos1 : pos2), LineState.Bar);
  }
};

export const isLineConnection = (
  answer: AnswerModel,
  pos1: Position,
  pos2: Position
): boolean => {
  if (pos1.x === pos2.x) {
    const y = Math.min(pos1.y, pos2.y);
    return answer.vertical.get(toId({ x: pos1.x, y })) === LineState.Line;
  }
  if (pos1.y === pos2.y) {
    const x = Math.min(pos1.x, pos2.x);
    return answer.horizontal.get(toId({ x, y: pos1.y })) === LineState.Line;
  }
  return false;
};

export const hasLineWithEnd = (answer: AnswerModel, pos: Position): boolean =>
  answer.innerLine.has(toId(pos)) || answer.edge.has(toId(pos));

export const isSameLine = (
  answer: AnswerModel,
  pos1: Position,
  pos2: Position
): boolean => answer.lineUf.isUnion(toId(pos1), toId(pos2));

export const isSingleLine = (answer: AnswerModel): boolean =>
  answer.edge.size <= 2 &&
  answer.whiteCells.size <= 2 &&
  answer.innerLine.size >= 2;

export const addBlackCell = (
  blackCells: Set<number>,
  pos: Position
): Set<number> => {
  blackCells.add(toId(pos));
  return blackCells;
};

export const addWhiteCell = (
  whiteCells: Set<number>,
  pos: Position
): Set<number> => {
  whiteCells.add(toId(pos));
  return whiteCells;
};

export const hasBlackCell = (blackCells: Set<number>, posId: number): boolean =>
  blackCells.has(posId);

export const hasWhiteCell = (whiteCells: Set<number>, pos: Position): boolean =>
  whiteCells.has(toId(pos));

export const getBlackCells = (blackCells: Set<number>): Position[] =>
  [...blackCells].map(toPos);

export const getWhiteCells = (whiteCells: Set<number>): Position[] =>
  [...whiteCells].map(toPos);

export const getAllEdge = (answer: AnswerModel): Position[] =>
  [...answer.edge].map(([id]) => toPos(id));

export const removeBlackCell = (blackCells: Set<number>, pos: Position): void => {
  blackCells.delete(toId(pos));
};

export const removeWhiteCell = (whiteCells: Set<number>, pos: Position): void => {
  whiteCells.delete(toId(pos));
};

/** Note: `hasLoop` is deliberately reset — the original relies on this for lookahead. */
export const clone = (answer: AnswerModel): AnswerModel => ({
  blackCells: new Set(answer.blackCells),
  whiteCells: new Set(answer.whiteCells),
  edge: new Map(answer.edge),
  lineUf: UnionFind.fromUF(answer.lineUf),
  innerLine: new Set(answer.innerLine),
  horizontal: new Map(answer.horizontal),
  vertical: new Map(answer.vertical),
  hasLoop: false,
});
