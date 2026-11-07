/*
 * Yajilin Kit — ported from gridkit `solver/addWhiteAroundBlack.ts`.
 *
 * In the original the `broken` check sits at the end of a forEach callback, so its
 * "broken" result is discarded and the pass always reports advanced/stopped. The
 * contradiction is caught later by `addBlackCellWithNumber`; the behaviour is kept.
 */

import { around } from "../position.js";
import type { AnswerMethods } from "../answerMethods.js";
import { Reason } from "../reasons.js";
import type { Status } from "../status.js";

export const addWhiteAroundBlack = (answer: AnswerMethods): Status => {
  const { addWhiteCell, forbidden, getBlackCells } = answer;
  let isAdvanced = false;
  getBlackCells().forEach((black) => {
    around(black).forEach(({ pos }) => {
      if (!forbidden(pos)) {
        const flag = addWhiteCell(answer, pos, Reason.WhiteAroundBlack);
        isAdvanced ||= flag;
      }
    });
  });
  return isAdvanced ? "advanced" : "stopped";
};
