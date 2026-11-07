/*
 * Yajilin Kit — TypeScript reference implementation.
 * Ported from gridkit `frontend/src/puzzle/yajilin/solver/createAnswerMethods.ts`.
 *
 * The original took a `log` flag and printed to the console; here the same flag drives
 * a recorder so the top-level board can accumulate the technique statistics that feed
 * difficulty scoring. Clones created during lookahead pass `record = false`, exactly as
 * they passed `log = false`.
 */

import { toId, type Board } from "./board.js";
import { around, type Position } from "./position.js";
import * as Model from "./answerModel.js";
import { addWhiteAroundSingleBlack } from "./techniques/addWhiteAroundSingleBlack.js";

export type TraceEntry = {
  kind: "black" | "white" | "line" | "bar";
  cells: Position[];
  reason: string;
};

export type Recorder = {
  entries: TraceEntry[];
  counts: Map<string, number>;
  add: (entry: TraceEntry) => void;
};

export const createRecorder = (): Recorder => {
  const recorder: Recorder = {
    entries: [],
    counts: new Map(),
    add: (entry) => {
      recorder.entries.push(entry);
      recorder.counts.set(entry.reason, (recorder.counts.get(entry.reason) ?? 0) + 1);
    },
  };
  return recorder;
};

export type AnswerMethods = {
  addBlackCell: (
    answerMethods: AnswerMethods,
    pos: Position,
    reason: string
  ) => boolean;
  addWhiteCell: (
    answerMethods: AnswerMethods,
    pos: Position,
    reason: string
  ) => boolean;
  addLine: (line: Position[], reason: string) => boolean;
  isSingleLine: () => boolean;
  isSameLine: (pos1: Position, pos2: Position) => boolean;
  isLineEdge: (pos: Position) => boolean;
  hasBlackCell: (pos: Position) => boolean;
  hasWhiteCell: (pos: Position) => boolean;
  hasLine: (pos: Position) => boolean;
  getBlackCells: () => Position[];
  getWhiteCells: () => Position[];
  getAllEdge: () => Position[];
  forbidden: (pos: Position) => boolean;
  getEdgeId: (pos: Position) => number | undefined;
  isLineConnection: (pos1: Position, pos2: Position) => boolean;
  edgeAround: (pos: Position) => { pos: Position; dir: Position }[];
  hasSmallLoop: () => boolean;
  getLineState: (pos1: Position, pos2: Position) => Model.LineState | undefined;
  setLineBar: (pos1: Position, pos2: Position) => void;
  blackCandidatesHorizontal: Set<number>;
  blackCandidatesVertical: Set<number>;
  newBlacks: Set<number>;
  newWhites: Set<number>;
  recorder: Recorder | undefined;
};

export const createAnswerMethods = (
  board: Board,
  answer: Model.AnswerModel,
  recorder: Recorder | undefined
): AnswerMethods => {
  const blackCandidatesHorizontal = new Set<number>();
  const blackCandidatesVertical = new Set<number>();
  const newBlacks = new Set<number>();
  const newWhites = new Set<number>();

  const addBlackCell = (
    answerMethods: AnswerMethods,
    pos: Position,
    reason: string
  ): boolean => {
    const posId = toId(pos);
    if (Model.hasBlackCell(answer.blackCells, posId)) return false;
    Model.addBlackCell(answer.blackCells, pos);
    newBlacks.add(posId);
    recorder?.add({ kind: "black", cells: [pos], reason });
    addWhiteAroundSingleBlack(answerMethods, pos);

    blackCandidatesHorizontal.has(posId) && blackCandidatesHorizontal.delete(posId);
    blackCandidatesHorizontal.has(posId - 1) &&
      blackCandidatesHorizontal.delete(posId - 1);
    blackCandidatesVertical.has(posId) && blackCandidatesVertical.delete(posId);
    blackCandidatesVertical.has(posId - 65536) &&
      blackCandidatesVertical.delete(posId - 65536);
    return true;
  };

  const addWhiteCell = (
    answerMethods: AnswerMethods,
    pos: Position,
    reason: string
  ): boolean => {
    const posId = toId(pos);
    if (Model.hasWhiteCell(answer.whiteCells, pos)) return false;
    if (Model.isLineEdge(answer, pos)) return false;
    if (answer.innerLine.has(posId)) return false;
    Model.addWhiteCell(answer.whiteCells, pos);
    newWhites.add(posId);
    recorder?.add({ kind: "white", cells: [pos], reason });

    if (blackCandidatesHorizontal.has(posId)) {
      blackCandidatesHorizontal.delete(posId);
      addBlackCell(answerMethods, { x: pos.x + 1, y: pos.y }, "2択の黒が確定");
    }
    if (blackCandidatesHorizontal.has(posId - 1)) {
      blackCandidatesHorizontal.delete(posId - 1);
      addBlackCell(answerMethods, { x: pos.x - 1, y: pos.y }, "2択の黒が確定");
    }
    if (blackCandidatesVertical.has(posId)) {
      blackCandidatesVertical.delete(posId);
      addBlackCell(answerMethods, { x: pos.x, y: pos.y + 1 }, "2択の黒が確定");
    }
    if (blackCandidatesVertical.has(posId - 65536)) {
      blackCandidatesVertical.delete(posId - 65536);
      addBlackCell(answerMethods, { x: pos.x, y: pos.y - 1 }, "2択の黒が確定");
    }
    return true;
  };

  const addLine = (line: Position[], reason: string): boolean => {
    if (line.length === 2 && Model.isLineConnection(answer, line[0]!, line[1]!)) {
      return false;
    }
    Model.addLine(answer, line);
    recorder?.add({ kind: "line", cells: line, reason });
    return true;
  };

  const isSingleLine = () => Model.isSingleLine(answer);
  const isSameLine = (pos1: Position, pos2: Position) =>
    Model.isSameLine(answer, pos1, pos2);
  const isLineEdge = (pos: Position) => Model.isLineEdge(answer, pos);
  const hasBlackCell = (pos: Position) =>
    Model.hasBlackCell(answer.blackCells, toId(pos));
  const hasWhiteCell = (pos: Position) =>
    Model.hasWhiteCell(answer.whiteCells, pos);
  const hasLine = (pos: Position) => Model.hasLine(answer, toId(pos));
  const getEdgeId = (pos: Position) => Model.getEdgeId(answer, pos);
  const getBlackCells = () => Model.getBlackCells(answer.blackCells);
  const getWhiteCells = () => Model.getWhiteCells(answer.whiteCells);
  const getLineState = (pos1: Position, pos2: Position) =>
    Model.getLineState(answer, pos1, pos2);

  const forbidden = (pos: Position): boolean => {
    const posId = toId(pos);
    return (
      !board.inBoard(pos) ||
      Model.hasBlackCell(answer.blackCells, posId) ||
      board.cell[pos.y * board.cols + pos.x]!.qnum !== -1 ||
      Model.hasLine(answer, posId)
    );
  };

  const edgeAround = (pos: Position) =>
    around(pos).filter(
      ({ pos: pos2 }) =>
        !forbidden(pos2) &&
        (Model.getLineState(answer, pos, pos2) ?? 0) === Model.LineState.Blank
    );

  const hasSmallLoop = () =>
    answer.hasLoop && (answer.edge.size > 0 || answer.whiteCells.size > 0);

  const isLineConnection = (pos1: Position, pos2: Position) =>
    Model.isLineConnection(answer, pos1, pos2);

  const setLineBar = (pos1: Position, pos2: Position) =>
    Model.setLineBar(answer, pos1, pos2);

  return {
    addBlackCell,
    addWhiteCell,
    addLine,
    isSingleLine,
    isSameLine,
    isLineEdge,
    hasBlackCell,
    hasWhiteCell,
    hasLine,
    getBlackCells,
    getWhiteCells,
    getAllEdge: () => Model.getAllEdge(answer),
    forbidden,
    getEdgeId,
    isLineConnection,
    edgeAround,
    hasSmallLoop,
    getLineState,
    setLineBar,
    blackCandidatesHorizontal,
    blackCandidatesVertical,
    newBlacks,
    newWhites,
    recorder,
  };
};
