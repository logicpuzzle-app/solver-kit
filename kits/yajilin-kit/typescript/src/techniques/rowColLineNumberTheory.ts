/*
 * Yajilin Kit — ported from gridkit `solver/rowColLineNumberTheory.ts`.
 *
 * Parity ("counting") theorem: the loop crosses any grid line an even number of times,
 * so for each inner row/column the number of line crossings above and below must both be
 * even. Cells whose state is still open are collected in `spaces`; when only one or two
 * remain, parity fixes them.
 *
 * The original is asymmetric on purpose-by-accident and is ported as is:
 *   - the row branch tests `spaces[0].y + 1 === spaces[1].y`, which never holds inside a
 *     single row, so only the all-zero-crossing case fires there;
 *   - the row branch guards the two-way black candidate with extra `forbidden` checks
 *     that the column branch omits;
 *   - the row branch chains `else if` over the one-space cases while the column branch
 *     uses independent `if`s.
 */

import { toId, type Board } from "../board.js";
import { LineState } from "../answerModel.js";
import type { AnswerMethods } from "../answerMethods.js";
import { Reason } from "../reasons.js";
import type { Status } from "../status.js";
import type { Position } from "../position.js";

export const rowColLineNumberTheory = (
  board: Board,
  answer: AnswerMethods
): Status => {
  for (let r = 1; r < board.rows - 1; r++) {
    let upLineCount = 0;
    let downLineCount = 0;
    const spaces: Position[] = [];
    for (let c = 0; c < board.cols; c++) {
      const pos = { x: c, y: r };
      const posu = { x: c, y: r - 1 };
      const posd = { x: c, y: r + 1 };
      if (!board.inBoard(pos)) {
        continue;
      }
      if (answer.hasBlackCell(pos)) {
        continue;
      }
      if (board.cell[r * board.cols + c]!.qnum !== -1) {
        continue;
      }
      if (
        answer.blackCandidatesHorizontal.has(toId(pos)) &&
        !answer.forbidden(pos) &&
        !answer.forbidden({ x: c + 1, y: r }) &&
        (answer.forbidden({ x: c - 1, y: r }) ||
          answer.getLineState(pos, { x: c - 1, y: r }) === LineState.Bar) &&
        (answer.forbidden({ x: c + 2, y: r }) ||
          answer.getLineState({ x: c + 1, y: r }, { x: c + 2, y: r }) ===
            LineState.Bar)
      ) {
        ++upLineCount;
        ++downLineCount;
        ++c;
        continue;
      }

      answer.isLineConnection(pos, posu) && upLineCount++;
      answer.isLineConnection(pos, posd) && downLineCount++;
      if (answer.hasLine(pos)) {
        continue;
      }
      if (
        (answer.forbidden(posu) ||
          answer.getLineState(pos, posu) === LineState.Bar) &&
        (answer.forbidden(posd) || answer.getLineState(pos, posd) === LineState.Bar)
      ) {
        continue;
      }
      spaces.push(pos);
    }
    if (spaces.length === 2) {
      let flag = false;
      if (
        spaces[0]!.y + 1 === spaces[1]!.y &&
        upLineCount % 2 === 0 &&
        downLineCount % 2 === 0
      ) {
        const flag1 = answer.addWhiteCell(answer, spaces[0]!, Reason.RowCountTwoWhite);
        const flag2 = answer.addWhiteCell(answer, spaces[1]!, Reason.RowCountTwoWhite);
        flag ||= flag1 || flag2;
      }
      if (upLineCount === 0 && downLineCount === 0) {
        const flag1 = answer.addWhiteCell(
          answer,
          spaces[0]!,
          Reason.RowGlobalSmallLoopTwoWhite
        );
        const flag2 = answer.addWhiteCell(
          answer,
          spaces[1]!,
          Reason.RowGlobalSmallLoopTwoWhite
        );
        flag ||= flag1 || flag2;
      }
      if (
        spaces[0]!.y + 1 === spaces[1]!.y &&
        upLineCount === 0 &&
        downLineCount === 0
      ) {
        answer.setLineBar(spaces[0]!, spaces[1]!);
      }
      if (flag) {
        return "advanced";
      }
    }
    if (spaces.length === 1) {
      if (upLineCount % 2 === 0 && downLineCount % 2 === 0) {
        const isAdvanced = answer.addBlackCell(answer, spaces[0]!, Reason.RowCountBlack);
        if (isAdvanced) {
          return "advanced";
        }
      } else if (upLineCount % 2 === 1 && downLineCount % 2 === 1) {
        const isAdvanced = answer.addWhiteCell(answer, spaces[0]!, Reason.RowCountWhite);
        if (isAdvanced) {
          return "advanced";
        }
      } else if (upLineCount % 2 === 1 && downLineCount % 2 === 0) {
        const isAdvanced = answer.addLine(
          [spaces[0]!, { x: spaces[0]!.x, y: spaces[0]!.y - 1 }],
          Reason.RowCountLine
        );
        if (isAdvanced) {
          return "advanced";
        }
      } else if (upLineCount % 2 === 0 && downLineCount % 2 === 1) {
        const isAdvanced = answer.addLine(
          [spaces[0]!, { x: spaces[0]!.x, y: spaces[0]!.y + 1 }],
          Reason.RowCountLine
        );
        if (isAdvanced) {
          return "advanced";
        }
      }
    } else if (spaces.length === 0) {
      if (upLineCount % 2 !== 0 && downLineCount % 2 !== 0) {
        return "broken";
      }
    }
  }

  for (let c = 1; c < board.cols - 1; c++) {
    let leftLineCount = 0;
    let rightLineCount = 0;
    const spaces: Position[] = [];
    for (let r = 0; r < board.rows; r++) {
      const pos = { x: c, y: r };
      const posl = { x: c - 1, y: r };
      const posr = { x: c + 1, y: r };
      if (!board.inBoard(pos)) {
        continue;
      }
      if (answer.hasBlackCell(pos)) {
        continue;
      }
      if (board.cell[r * board.cols + c]!.qnum !== -1) {
        continue;
      }
      if (
        answer.blackCandidatesVertical.has(toId(pos)) &&
        (answer.forbidden({ x: c, y: r - 1 }) ||
          answer.getLineState(pos, { x: c, y: r - 1 }) === LineState.Bar) &&
        (answer.forbidden({ x: c, y: r + 2 }) ||
          answer.getLineState({ x: c, y: r + 1 }, { x: c, y: r + 2 }) ===
            LineState.Bar)
      ) {
        ++leftLineCount;
        ++rightLineCount;
        ++r;
        continue;
      }

      answer.isLineConnection(pos, posl) && leftLineCount++;
      answer.isLineConnection(pos, posr) && rightLineCount++;
      if (answer.hasLine(pos)) {
        continue;
      }
      if (
        (answer.forbidden(posl) ||
          answer.getLineState(pos, posl) === LineState.Bar) &&
        (answer.forbidden(posr) || answer.getLineState(pos, posr) === LineState.Bar)
      ) {
        continue;
      }
      spaces.push(pos);
    }

    if (spaces.length === 2) {
      let flag = false;
      if (
        spaces[0]!.y + 1 === spaces[1]!.y &&
        leftLineCount % 2 === 0 &&
        rightLineCount % 2 === 0
      ) {
        const flag1 = answer.addWhiteCell(answer, spaces[0]!, Reason.ColCountTwoWhite);
        const flag2 = answer.addWhiteCell(answer, spaces[1]!, Reason.ColCountTwoWhite);
        flag ||= flag1 || flag2;
      }
      if (leftLineCount === 0 && rightLineCount === 0) {
        const flag1 = answer.addWhiteCell(
          answer,
          spaces[0]!,
          Reason.ColGlobalSmallLoopTwoWhite
        );
        const flag2 = answer.addWhiteCell(
          answer,
          spaces[1]!,
          Reason.ColGlobalSmallLoopTwoWhite
        );
        flag ||= flag1 || flag2;
      }
      if (
        spaces[0]!.y + 1 === spaces[1]!.y &&
        leftLineCount === 0 &&
        rightLineCount === 0
      ) {
        answer.setLineBar(spaces[0]!, spaces[1]!);
      }
      if (flag) {
        return "advanced";
      }
    }
    if (spaces.length === 1) {
      if (leftLineCount % 2 === 0 && rightLineCount % 2 === 0) {
        const isAdvanced = answer.addBlackCell(answer, spaces[0]!, Reason.ColCountBlack);
        if (isAdvanced) {
          return "advanced";
        }
      }
      if (leftLineCount % 2 === 1 && rightLineCount % 2 === 1) {
        const isAdvanced = answer.addWhiteCell(answer, spaces[0]!, Reason.ColCountWhite);
        if (isAdvanced) {
          return "advanced";
        }
      }
      if (leftLineCount % 2 === 1 && rightLineCount % 2 === 0) {
        const isAdvanced = answer.addLine(
          [spaces[0]!, { x: spaces[0]!.x - 1, y: spaces[0]!.y }],
          Reason.ColCountLine
        );
        if (isAdvanced) {
          return "advanced";
        }
      }
      if (leftLineCount % 2 === 0 && rightLineCount % 2 === 1) {
        const isAdvanced = answer.addLine(
          [spaces[0]!, { x: spaces[0]!.x + 1, y: spaces[0]!.y }],
          Reason.ColCountLine
        );
        if (isAdvanced) {
          return "advanced";
        }
      }
    } else if (spaces.length === 0) {
      if (leftLineCount % 2 !== 0 && rightLineCount % 2 !== 0) {
        return "broken";
      }
    }
  }
  return "stopped";
};
