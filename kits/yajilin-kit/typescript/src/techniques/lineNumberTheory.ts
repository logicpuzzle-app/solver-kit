/*
 * Yajilin Kit — ported from gridkit `solver/lineNumberTheory.ts`.
 */

import type { Board } from "../board.js";
import type { AnswerMethods } from "../answerMethods.js";
import type { Status } from "../status.js";
import { createConnectionMap } from "./connectionMap.js";
import { closedLineNumberTheory } from "./closedLineNumberTheory.js";

export const lineNumberTheory = (board: Board, answer: AnswerMethods): Status => {
  const connectionMap = createConnectionMap(board, answer);
  return closedLineNumberTheory(board, answer, connectionMap);
};
