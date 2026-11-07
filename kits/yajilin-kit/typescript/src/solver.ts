/*
 * Yajilin Kit — ported from gridkit `frontend/src/puzzle/yajilin/useYajilinSolver.tsx`,
 * with the React state stripped out.
 *
 * `solve` runs one propagation pass over all techniques. `trySolve` is the lookahead:
 * for every undecided cell and every undecided edge it tentatively assumes both options,
 * propagates, and keeps whatever the contradiction (or the agreement between both
 * branches) proves. `runAll` alternates the two until nothing moves.
 */

import { toId, toPos, type Board } from "./board.js";
import type { Position } from "./position.js";
import * as Model from "./answerModel.js";
import {
  createAnswerMethods,
  createRecorder,
  type AnswerMethods,
  type Recorder,
} from "./answerMethods.js";
import { addBlackCellWithNumber } from "./techniques/addBlackCellWithNumber.js";
import { addFixedLine } from "./techniques/addFixedLine.js";
import { addWhiteAroundBlack } from "./techniques/addWhiteAroundBlack.js";
import { addWhiteCellWithZero } from "./techniques/addWhiteCellWithZero.js";
import { cutParity } from "./techniques/cutParity.js";
import { lineNumberTheory } from "./techniques/lineNumberTheory.js";
import { rowColLineNumberTheory } from "./techniques/rowColLineNumberTheory.js";
import { Reason } from "./reasons.js";
import type { Status } from "./status.js";

type Broken =
  | {
      count: number;
      target: Position;
      type: "white" | "black";
      reason: "contradiction";
    }
  | {
      count: number;
      target: Position;
      type: "white" | "black";
      reason: "any-case";
      reasonPos: Position;
    }
  | {
      count: number;
      line: Position[];
      type: "line" | "bar";
      reason: "contradiction" | "any-case";
    };

export type TrialStats = {
  /** Number of deductions that required lookahead. */
  trialDeductions: number;
  /** Deepest propagation chain a successful lookahead needed. */
  maxTrialCount: number;
  /** Number of propagation passes (`solve` calls) issued on the real board. */
  passes: number;
  /**
   * The deepest stage of reasoning the puzzle actually needed (see `LEVEL_*`).
   *
   * `solve` is already a cascade — each stage runs only when every cheaper stage has
   * stalled — so the deepest stage that fired is the minimum set of techniques that
   * cracks the puzzle. That is how players describe difficulty.
   */
  level: number;
  /** Cells still undecided the first time the techniques ran out, before any lookahead. */
  pureUndecided: number;
};

/** Stages of reasoning, cheapest first. The stage is the difficulty model's main axis. */
export const LEVEL_BASIC = 1;
export const LEVEL_ROW_COL = 2;
export const LEVEL_CUT_PARITY = 3;
export const LEVEL_LINE_THEORY = 4;
export const LEVEL_TRIAL = 5;
export const LEVEL_UNSOLVED = 6;

const createTrialStats = (): TrialStats => ({
  trialDeductions: 0,
  maxTrialCount: 0,
  passes: 0,
  level: 0,
  pureUndecided: 0,
});

export const solve = (board: Board, answer: AnswerMethods): Status =>
  solveAt(board, answer, { level: 0 });

/** `solve`, recording the deepest stage that fired into `reached.level`. */
export const solveAt = (
  board: Board,
  answer: AnswerMethods,
  reached: { level: number }
): Status => {
  const at = (stage: number, status: Status): Status => {
    if (status === "advanced") {
      reached.level = Math.max(reached.level, stage);
    }
    return status;
  };
  addWhiteAroundBlack(answer);
  const status1 = at(LEVEL_BASIC, addBlackCellWithNumber(board, answer));
  if (status1 === "broken") {
    return "broken";
  }
  const status2 = at(LEVEL_BASIC, addWhiteCellWithZero(board, answer));
  const status4 = at(LEVEL_BASIC, addFixedLine(board, answer));
  if (status4 === "broken") {
    return "broken";
  }

  if (answer.hasSmallLoop()) {
    return "broken";
  }
  if (status1 === "stopped" && status2 === "stopped" && status4 === "stopped") {
    const status5 = at(LEVEL_ROW_COL, rowColLineNumberTheory(board, answer));
    if (status5 === "stopped") {
      const status6 = at(LEVEL_CUT_PARITY, cutParity(board, answer));
      if (status6 === "stopped") {
        return at(LEVEL_LINE_THEORY, lineNumberTheory(board, answer));
      }
      return status6;
    }
    return status5;
  }
  return "advanced";
};

const trySolve = (
  board: Board,
  answer: Model.AnswerModel,
  answerMethods: AnswerMethods,
  stats: TrialStats
): Status => {
  const brokenList: Broken[] = [];

  let minCountFlag = false;
  let minCount = 100;

  // Tentative black / white per undecided cell.
  if (!minCountFlag) {
    for (let i = 0, len = board.cell.length; i < len; i++) {
      const targetX = i % board.cols;
      const targetY = Math.floor(i / board.cols);
      const target = { x: targetX, y: targetY };
      if (board.cell[i]!.qnum !== -1) {
        continue;
      }
      if (Model.hasBlackCell(answer.blackCells, toId(target))) {
        continue;
      }
      if (Model.hasWhiteCell(answer.whiteCells, target)) {
        continue;
      }
      if (Model.hasLineWithEnd(answer, target)) {
        continue;
      }

      const answerBlack = Model.clone(answer);
      const answerMethodsBlack = createAnswerMethods(board, answerBlack, undefined);
      Model.addBlackCell(answerBlack.blackCells, target);
      let blackStatus: Status = "advanced";
      let blackCount = 0;
      do {
        blackStatus = solve(board, answerMethodsBlack);
        ++blackCount;
        if (blackCount > minCount) {
          blackStatus = "stopped";
        }
      } while (blackStatus === "advanced");
      if (blackStatus === "broken") {
        brokenList.push({
          target,
          count: blackCount,
          type: "white",
          reason: "contradiction",
        });
        if (blackCount === 1) {
          minCountFlag = true;
          break;
        }
        if (blackCount < minCount) {
          minCount = blackCount;
        }
      }

      const answerWhite = Model.clone(answer);
      const answerMethodsWhite = createAnswerMethods(board, answerWhite, undefined);
      Model.addWhiteCell(answerWhite.whiteCells, target);
      let whiteStatus: Status = "advanced";
      let whiteCount = 0;
      do {
        whiteStatus = solve(board, answerMethodsWhite);
        ++whiteCount;
        if (whiteCount > minCount) {
          whiteStatus = "stopped";
        }
      } while (whiteStatus === "advanced");
      if (whiteStatus === "broken") {
        brokenList.push({
          target,
          count: whiteCount,
          type: "black",
          reason: "contradiction",
        });
        if (whiteCount === 1) {
          minCountFlag = true;
          break;
        }
        if (whiteCount < minCount) {
          minCount = whiteCount;
        }
      }

      const commonBlack = [...answerMethodsBlack.newBlacks].filter((e) =>
        answerMethodsWhite.newBlacks.has(e)
      );
      if (commonBlack.length > 0) {
        minCount = Math.min(minCount, Math.max(blackCount, whiteCount));
        brokenList.push({
          target: toPos(commonBlack[0]!),
          count: Math.max(blackCount, whiteCount),
          type: "black",
          reason: "any-case",
          reasonPos: target,
        });
      }
      const commonWhite = [...answerMethodsBlack.newWhites].filter((e) =>
        answerMethodsWhite.newWhites.has(e)
      );
      if (commonWhite.length > 0) {
        minCount = Math.min(minCount, Math.max(blackCount, whiteCount));
        brokenList.push({
          target: toPos(commonWhite[0]!),
          count: Math.max(blackCount, whiteCount),
          type: "white",
          reason: "any-case",
          reasonPos: target,
        });
      }
    }
  }

  // Tentative line / bar on every horizontal edge.
  for (let y = 0; y < board.rows; y++) {
    for (let x = 0; x < board.cols - 1; x++) {
      const target = { x, y };
      if ((answer.horizontal.get(toId(target)) ?? -1) !== Model.LineState.None) {
        continue;
      }
      if (answerMethods.forbidden(target)) {
        continue;
      }
      if (answerMethods.forbidden({ x: x + 1, y })) {
        continue;
      }

      const answerLine = Model.clone(answer);
      const answerMethodsLine = createAnswerMethods(board, answerLine, undefined);
      Model.addLine(answerLine, [target, { x: x + 1, y }]);
      let lineStatus: Status = "advanced";
      let lineCount = 0;
      do {
        lineStatus = solve(board, answerMethodsLine);
        ++lineCount;
        if (lineCount > minCount) {
          lineStatus = "stopped";
        }
      } while (lineStatus === "advanced");
      if (lineStatus === "broken") {
        brokenList.push({
          line: [target, { x: x + 1, y }],
          count: lineCount,
          type: "bar",
          reason: "contradiction",
        });
        if (lineCount === 1) {
          minCountFlag = true;
          minCount = lineCount;
          break;
        }
        if (lineCount < minCount) {
          minCount = lineCount;
        }
      }

      const answerBar = Model.clone(answer);
      const answerMethodsBar = createAnswerMethods(board, answerBar, undefined);
      Model.setLineBar(answerBar, target, { x: x + 1, y });
      let barStatus: Status = "advanced";
      let barCount = 0;
      do {
        barStatus = solve(board, answerMethodsBar);
        ++barCount;
        if (barCount > minCount) {
          barStatus = "stopped";
        }
      } while (barStatus === "advanced");
      if (barStatus === "broken") {
        brokenList.push({
          line: [target, { x: x + 1, y }],
          count: barCount,
          type: "line",
          reason: "contradiction",
        });
        if (barCount === 1) {
          minCountFlag = true;
          break;
        }
        if (barCount < minCount) {
          minCount = barCount;
        }
      }

      const commonBlack = [...answerMethodsLine.newBlacks].filter((e) =>
        answerMethodsBar.newBlacks.has(e)
      );
      if (commonBlack.length > 0) {
        minCount = Math.min(minCount, Math.max(lineCount, barCount));
        brokenList.push({
          target: toPos(commonBlack[0]!),
          count: Math.max(lineCount, barCount),
          type: "black",
          reason: "any-case",
          reasonPos: target,
        });
      }
      const commonWhite = [...answerMethodsLine.newWhites].filter((e) =>
        answerMethodsBar.newWhites.has(e)
      );
      if (commonWhite.length > 0) {
        minCount = Math.min(minCount, Math.max(lineCount, barCount));
        brokenList.push({
          target: toPos(commonWhite[0]!),
          count: Math.max(lineCount, barCount),
          type: "white",
          reason: "any-case",
          reasonPos: target,
        });
      }
    }
  }

  // Tentative line / bar on every vertical edge. Note the `>=` cut-off here versus `>`
  // in the horizontal pass — the asymmetry is in the original and changes which
  // deduction wins, so it is preserved.
  for (let y = 0; y < board.rows - 1; y++) {
    for (let x = 0; x < board.cols; x++) {
      const target = { x, y };
      if ((answer.vertical.get(toId(target)) ?? -1) !== Model.LineState.None) {
        continue;
      }
      if (answerMethods.forbidden(target)) {
        continue;
      }
      if (answerMethods.forbidden({ x, y: y + 1 })) {
        continue;
      }
      const answerLine = Model.clone(answer);
      const answerMethodsLine = createAnswerMethods(board, answerLine, undefined);
      Model.addLine(answerLine, [target, { x, y: y + 1 }]);
      let lineStatus: Status = "advanced";
      let lineCount = 0;
      do {
        lineStatus = solve(board, answerMethodsLine);
        ++lineCount;
        if (lineCount >= minCount) {
          lineStatus = "stopped";
        }
      } while (lineStatus === "advanced");
      if (lineStatus === "broken") {
        brokenList.push({
          line: [target, { x, y: y + 1 }],
          count: lineCount,
          type: "bar",
          reason: "contradiction",
        });
        if (lineCount === 1) {
          minCountFlag = true;
          break;
        }
        if (lineCount < minCount) {
          minCount = lineCount;
        }
      }
      const answerBar = Model.clone(answer);
      const answerMethodsBar = createAnswerMethods(board, answerBar, undefined);
      Model.setLineBar(answerBar, target, { x, y: y + 1 });
      let barStatus: Status = "advanced";
      let barCount = 0;
      do {
        barStatus = solve(board, answerMethodsBar);
        ++barCount;
        if (barCount >= minCount) {
          barStatus = "stopped";
        }
      } while (barStatus === "advanced");
      if (barStatus === "broken") {
        brokenList.push({
          line: [target, { x, y: y + 1 }],
          count: barCount,
          type: "line",
          reason: "contradiction",
        });
        if (barCount === 1) {
          minCountFlag = true;
          break;
        }
        if (barCount < minCount) {
          minCount = barCount;
        }
      }
    }
  }

  if (brokenList.length === 0) {
    return "stopped";
  }

  brokenList.forEach((broken) => {
    stats.trialDeductions++;
    if (broken.count > stats.maxTrialCount) {
      stats.maxTrialCount = broken.count;
    }
    if (broken.type === "white") {
      answerMethods.addWhiteCell(
        answerMethods,
        broken.target,
        broken.reason === "contradiction" ? Reason.TrialContradiction : Reason.TrialAnyCase
      );
    } else if (broken.type === "black") {
      answerMethods.addBlackCell(
        answerMethods,
        broken.target,
        broken.reason === "contradiction" ? Reason.TrialContradiction : Reason.TrialAnyCase
      );
    } else if (broken.type === "line") {
      // The original bypasses AnswerMethods.addLine here, so the duplicate-line guard
      // does not apply. Kept as is.
      Model.addLine(answer, broken.line);
      answerMethods.recorder?.add({
        kind: "line",
        cells: broken.line,
        reason: Reason.TrialLineContradiction,
      });
    } else if (broken.type === "bar") {
      Model.setLineBar(answer, broken.line[0]!, broken.line[1]!);
      answerMethods.recorder?.add({
        kind: "bar",
        cells: broken.line,
        reason: Reason.TrialLineContradiction,
      });
    }
  });
  return "advanced";
};

const run = (
  board: Board,
  answer: Model.AnswerModel,
  recorder: Recorder | undefined,
  stats: TrialStats
): Status => {
  const answerMethods = createAnswerMethods(board, answer, recorder);
  stats.passes++;
  const reached = { level: stats.level };
  const status = solveAt(board, answerMethods, reached);
  stats.level = reached.level;

  if (status === "advanced") {
    return status;
  }

  if (status === "stopped" && !Model.isSingleLine(answer)) {
    recordPureUndecided(board, answer, stats);
    const trial = trySolve(board, answer, answerMethods, stats);
    if (trial === "advanced") {
      stats.level = Math.max(stats.level, LEVEL_TRIAL);
    }
    return trial;
  }
  return status;
};

/**
 * Note how many cells were still undecided the first time the techniques ran out.
 *
 * Ported from nurikabe-kit, where this is the single most useful difficulty feature:
 * technique fire counts track board size rather than difficulty, but how far pure
 * deduction gets you separates the ratings cleanly. Recorded once, on the first stall.
 */
const recordPureUndecided = (
  board: Board,
  answer: Model.AnswerModel,
  stats: TrialStats
): void => {
  if (stats.pureUndecided !== 0) {
    return;
  }
  const clueCells = board.cell.filter((cell) => cell.qnum >= 0).length;
  const decided = answer.blackCells.size + answer.whiteCells.size;
  stats.pureUndecided = board.cols * board.rows - clueCells - decided;
};

export type SolveOutcome = {
  status: "completed" | "stopped" | "broken";
  answer: Model.AnswerModel;
  recorder: Recorder;
  stats: TrialStats;
};

export type SolveOptions = {
  /** Skip the lookahead entirely; only single-pass techniques are applied. */
  noTrial?: boolean;
  /** Safety net against pathological inputs; 0 = unlimited. */
  maxPasses?: number;
};

export const runAll = (
  board: Board,
  initial?: Model.AnswerModel,
  options: SolveOptions = {}
): SolveOutcome => {
  const answer = initial ?? Model.createAnswerModel();
  const recorder = createRecorder();
  const stats = createTrialStats();
  const maxPasses = options.maxPasses ?? 0;

  let status: Status = "advanced";
  while (status === "advanced") {
    if (options.noTrial) {
      const answerMethods = createAnswerMethods(board, answer, recorder);
      stats.passes++;
      const reached = { level: stats.level };
      status = solveAt(board, answerMethods, reached);
      stats.level = reached.level;
      if (status === "stopped" && !Model.isSingleLine(answer)) {
        recordPureUndecided(board, answer, stats);
      }
    } else {
      status = run(board, answer, recorder, stats);
    }
    if (maxPasses > 0 && stats.passes >= maxPasses) {
      break;
    }
  }

  const finished = status === "stopped" && Model.isSingleLine(answer);
  const finalStatus: SolveOutcome["status"] =
    status === "broken" ? "broken" : finished ? "completed" : "stopped";
  if (finalStatus === "stopped") {
    stats.level = LEVEL_UNSOLVED;
  } else if (stats.level === 0) {
    stats.level = LEVEL_BASIC;
  }
  return { status: finalStatus, answer, recorder, stats };
};
