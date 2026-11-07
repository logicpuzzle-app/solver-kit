/*
 * Yajilin Kit — ported from gridkit `solver/addWhiteAroundSingleBlack.ts`.
 */

import { around, type Position } from "../position.js";
import type { AnswerMethods } from "../answerMethods.js";
import { Reason } from "../reasons.js";
import type { Status } from "../status.js";

export const addWhiteAroundSingleBlack = (
  answer: AnswerMethods,
  black: Position
): Status => {
  const { addWhiteCell, hasBlackCell, forbidden } = answer;
  let isAdvanced = false;
  let broken = false;
  around(black).forEach(({ pos }) => {
    if (!forbidden(pos)) {
      const flag = addWhiteCell(answer, pos, Reason.WhiteAroundBlack);
      isAdvanced ||= flag;
    } else if (hasBlackCell(pos)) {
      broken = true;
    }
  });
  if (broken) {
    return "broken";
  }
  return isAdvanced ? "advanced" : "stopped";
};
