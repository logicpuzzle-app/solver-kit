/*
 * Yajilin Kit — ported from gridkit `solver/addFixedLine.ts`.
 *
 * Local line deductions, dispatched by what the target cell already is:
 * a line endpoint (extend / forbid closing a short loop), a known white cell
 * (its two open sides must carry the line), or an undecided cell (blocked cells
 * become black, and several "the line would have to branch" patterns force white).
 */

import type { Board } from "../board.js";
import { add, dirList, type Position } from "../position.js";
import type { AnswerMethods } from "../answerMethods.js";
import { Reason } from "../reasons.js";
import type { Status } from "../status.js";

const addFixedLineEdge = (answer: AnswerMethods, targetPos: Position): Status => {
  const { addLine, isSingleLine, isSameLine } = answer;
  let isAdvanced = false;
  const enables = answer.edgeAround(targetPos);
  if (enables.length === 1) {
    const flag = addLine([targetPos, enables[0]!.pos], Reason.ExtendLineEnd);
    isAdvanced ||= flag;
  } else if (enables.length === 2) {
    if (!isSingleLine() && isSameLine(targetPos, enables[0]!.pos)) {
      const flag = addLine([targetPos, enables[1]!.pos], Reason.SmallLoopBan);
      isAdvanced ||= flag;
    } else if (!isSingleLine() && isSameLine(targetPos, enables[1]!.pos)) {
      const flag = addLine([targetPos, enables[0]!.pos], Reason.SmallLoopBanExtension);
      isAdvanced ||= flag;
    }
  } else if (enables.length === 0) {
    return "broken";
  } else if (enables.length === 3) {
    if (!isSingleLine() && isSameLine(targetPos, enables[0]!.pos)) {
      answer.setLineBar(targetPos, enables[0]!.pos);
      isAdvanced = true;
    }
    if (!isSingleLine() && isSameLine(targetPos, enables[1]!.pos)) {
      answer.setLineBar(targetPos, enables[1]!.pos);
      isAdvanced = true;
    }
    if (!isSingleLine() && isSameLine(targetPos, enables[2]!.pos)) {
      answer.setLineBar(targetPos, enables[2]!.pos);
      isAdvanced = true;
    }
  }
  return isAdvanced ? "advanced" : "stopped";
};

const addFixedLineWhite = (answer: AnswerMethods, targetPos: Position): Status => {
  const { isSingleLine, isSameLine, addLine, isLineEdge } = answer;
  let isAdvanced = false;
  const enables = answer.edgeAround(targetPos);
  if (enables.length === 2) {
    const flag = addLine(
      [add(targetPos, enables[0]!.dir), targetPos, add(targetPos, enables[1]!.dir)],
      Reason.LineFixed
    );
    isAdvanced ||= flag;
  } else if (enables.length <= 1) {
    return "broken";
  } else if (enables.length === 3) {
    const notLineEdge = enables.filter(({ pos }) => !isLineEdge(pos));
    const lineEdge = enables.filter(({ pos }) => isLineEdge(pos));
    if (
      notLineEdge.length === 1 &&
      !isSingleLine() &&
      isSameLine(lineEdge[0]!.pos, lineEdge[1]!.pos)
    ) {
      const flag = addLine(
        [targetPos, notLineEdge[0]!.pos],
        Reason.SimpleLoopTechnique
      );
      isAdvanced ||= flag;
    }
  }
  return isAdvanced ? "advanced" : "stopped";
};

export const addFixedLineWithTarget = (
  answer: AnswerMethods,
  targetPos: Position
): Status => {
  const {
    addBlackCell,
    addWhiteCell,
    isLineEdge,
    isSingleLine,
    isSameLine,
    hasWhiteCell,
    forbidden,
  } = answer;
  let isAdvanced = false;

  if (isLineEdge(targetPos)) {
    const status = addFixedLineEdge(answer, targetPos);
    if (status === "broken") {
      return "broken";
    }
    isAdvanced ||= status === "advanced";
  } else if (hasWhiteCell(targetPos)) {
    const status = addFixedLineWhite(answer, targetPos);
    if (status === "broken") {
      return "broken";
    }
    isAdvanced ||= status === "advanced";
  } else {
    const enables = answer.edgeAround(targetPos);
    let targetAdvanced = false;
    if (enables.length <= 1) {
      const flag = addBlackCell(answer, targetPos, Reason.UnreachableBlack);
      isAdvanced ||= flag;
      targetAdvanced ||= flag;
    } else if (enables.length === 2) {
      if (!isSingleLine() && isSameLine(enables[0]!.pos, enables[1]!.pos)) {
        const flag = addBlackCell(answer, targetPos, Reason.SmallLoopBanBlack);
        isAdvanced ||= flag;
        targetAdvanced ||= flag;
      }
    }
    if (!targetAdvanced) {
      enables.forEach(({ pos, dir }) => {
        if (isLineEdge(pos)) {
          return;
        }
        const enables2 = answer.edgeAround(pos);
        if (enables2.length === 2) {
          const flag = addWhiteCell(answer, targetPos, Reason.ExitTechnique);
          isAdvanced ||= flag;
          targetAdvanced ||= flag;
        } else if (enables2.length === 3) {
          const others = enables2.filter(
            ({ dir: dir2 }) => dir.x + dir2.x !== 0 || dir.y + dir2.y !== 0
          );
          if (
            !isSingleLine() &&
            isSameLine(add(pos, others[0]!.dir), add(pos, others[1]!.dir))
          ) {
            const flag = addWhiteCell(answer, targetPos, Reason.SmallLoopBanWhite);
            isAdvanced ||= flag;
            targetAdvanced ||= flag;
          }
        }
      });
    }
    if (!targetAdvanced) {
      [
        { x: 1, y: 1 },
        { x: 1, y: -1 },
        { x: -1, y: 1 },
        { x: -1, y: -1 },
      ].forEach((dir) => {
        if (!isLineEdge({ x: targetPos.x + dir.x, y: targetPos.y + dir.y })) {
          return;
        }
        const xh = targetPos.x + dir.x;
        const yh = targetPos.y;
        const xv = targetPos.x;
        const yv = targetPos.y + dir.y;
        if (forbidden({ x: xh, y: yh })) {
          return;
        }
        if (forbidden({ x: xv, y: yv })) {
          return;
        }

        const enableDirsH = dirList.filter(
          (dir2) => !forbidden({ x: xh + dir2.x, y: yh + dir2.y })
        );
        const enableDirsV = dirList.filter(
          (dir2) => !forbidden({ x: xv + dir2.x, y: yv + dir2.y })
        );
        if (
          (enableDirsH.length === 2 ||
            (!isLineEdge({ x: xh, y: yh }) && enableDirsH.length === 3)) &&
          (enableDirsV.length === 2 ||
            (!isLineEdge({ x: xv, y: yv }) && enableDirsV.length === 3))
        ) {
          const flag = addWhiteCell(answer, targetPos, Reason.BranchBanWhite);
          isAdvanced ||= flag;
        }
      });
    }
  }
  return isAdvanced ? "advanced" : "stopped";
};

export const addFixedLine = (board: Board, answer: AnswerMethods): Status => {
  let isAdvanced = false;

  for (let i = 0, len = board.cell.length; i < len; i++) {
    const targetPos = { x: i % board.cols, y: Math.floor(i / board.cols) };
    if (answer.forbidden(targetPos)) {
      continue;
    }
    const ret = addFixedLineWithTarget(answer, targetPos);
    if (ret === "broken") {
      return "broken";
    }
    isAdvanced ||= ret === "advanced";
  }
  return isAdvanced ? "advanced" : "stopped";
};
