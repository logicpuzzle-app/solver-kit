/*
 * Yajilin Kit — library entry point.
 *
 * The CLI is one consumer of this package; puzzle-kit is the other. Everything a host
 * application needs is re-exported here, grouped by what it is for, so that importing
 * `yajilin-kit` never requires reaching into internal module paths.
 *
 * The two solvers are deliberately both public and are not interchangeable:
 *   - `runAll` is the technique solver. Use it to explain an answer or to score
 *     difficulty. It is not complete and may stop short.
 *   - `countSolutions` / `search` are the constraint engine. Use them whenever the answer
 *     has to be trusted — uniqueness, generation, validation.
 */

export type { Board, Cell } from "./board.js";
export { cellAt, cloneBoard, createBoard, isClue, maxSize, toId, toPos } from "./board.js";

export type { Position } from "./position.js";
export { add, around, dirList, dirs, equals, subtract } from "./position.js";

// Reading and writing puzzles.
export {
  decodeBody,
  decodeUrl,
  encodeBody,
  encodeCode,
  encodeUrl,
  parseUrl,
  type ParsedUrl,
} from "./puzzlink.js";
export {
  formatAnswerGrid,
  formatProblemText,
  formatSolutionSummary,
  parseProblemText,
} from "./format.js";

// Answers and rule checking.
export type { Solution, ValidationError } from "./solution.js";
export {
  countBlacksAlongArrow,
  createSolution,
  describeValidationError,
  extractSolution,
  solutionKey,
  validateSolution,
} from "./solution.js";

// The technique solver: difficulty and human-style solving.
export type { SolveOptions, SolveOutcome, TrialStats } from "./solver.js";
export { runAll, solve } from "./solver.js";
export type { AnswerModel } from "./answerModel.js";
export { createAnswerModel, LineState } from "./answerModel.js";
export type { Recorder, TraceEntry } from "./answerMethods.js";
export { Reason, REASON_WEIGHT } from "./reasons.js";
export type { DifficultyBand } from "./difficulty.js";
export {
  band,
  difficulty,
  puzsqRating,
  puzsqRatingHundredths,
  sizeScale,
  SIZE_SCALE_UNIT,
  techniqueScore,
  techniqueWork,
  UNFINISHED_BASE,
} from "./difficulty.js";

// The constraint engine: uniqueness, search and generation support.
export type { SearchLimits, SearchResult } from "./search.js";
export {
  analysePropagation,
  countLoopRoutings,
  countSolutions,
  drawSolution,
  findInitialSolution,
  findRandomSolution,
  hasUniqueSolution,
  maximumCoverage,
  propagationCoverage,
  search,
  searchEngine,
} from "./search.js";
export { CellState, EdgeState, createEngine, isSolved, propagateEngine } from "./engine.js";

// Generation.
export type { Generated, GenerateOptions, Symmetry } from "./generator.js";
export { buildPattern, generateLoop, generatePattern } from "./generator.js";
export { Rng } from "./random.js";
