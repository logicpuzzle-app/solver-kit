#!/usr/bin/env -S node --import tsx
/*
 * Yajilin Kit — command line interface.
 *
 * Every command prints plain ASCII/UTF-8 with integers only, so the Rust and Python ports
 * can be compared against this one with `cmp`.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { cloneBoard, type Board } from "./board.js";
import { formatAnswerGrid, formatProblemText, formatSolutionSummary, parseProblemText } from "./format.js";
import { decodeUrl, encodeCode, encodeUrl } from "./puzzlink.js";
import { runAll } from "./solver.js";
import { extractSolution, describeValidationError, validateSolution } from "./solution.js";
import { countSolutions } from "./search.js";
import { Rng } from "./random.js";
import { band, difficulty, puzsqRatingHundredths } from "./difficulty.js";
import {
  generateLoop,
  generatePattern,
  type Generated,
  type GenerateOptions,
  type Symmetry,
} from "./generator.js";

const USAGE = `usage: yajilin <command> [options]

commands:
  solve <problem>              solve a puzzle and report the answer and difficulty
  count <problem> [--limit N]  count solutions (default limit 2)
  generate-loop [options]      generate by drawing the loop first
  generate-pattern [options]   generate from a clue pattern
  bench [options]              time solving and generation

<problem> is a file path, a puzz.link url, or a bare "yajilin/W/H/body" code.

common options:
  --seed N            rng seed (default 0)
  --size WxH          board size (default 10x10)
  --clues N           number of arrow clues
  --clue-ratio R      clues as a fraction of the board (default 0.16)
  --attempts N        retry budget, 0 = unlimited (default 100)
  --dp-min N          reject puzzles below this difficulty
  --dp-max N          reject puzzles above this difficulty
  --max-nodes N       search node cap, 0 = unlimited (default 200000)
  --symmetry S        none|rot2|rot4|mirror-h|mirror-v (pattern mode, default rot2)
  --pattern FILE      explicit clue pattern (pattern mode)
  --no-weaken         keep the most informative clue directions
  --no-reduce         keep every clue, even redundant ones (loop mode)
  --refine N          hill-climb N rounds for a harder puzzle (default 0)
  --anneal N          annealing rounds when the greedy repair stalls (default 8 per cell)
  --vary-clue-count   let the annealing add and remove clues: harder puzzles, ~40% slower
  --black-bias N      per-mille chance of trying a cell as black first (default 850)
  --no-trial          solve without the lookahead
  --format F          url|code|text|grid (default grid)
  --out FILE          write to a file instead of stdout
  --count N           bench iterations (default 10)
`;

type Options = {
  positional: string[];
  flags: Set<string>;
  values: Map<string, string>;
};

const parseArgs = (argv: string[]): Options => {
  const positional: string[] = [];
  const flags = new Set<string>();
  const values = new Map<string, string>();
  const valued = new Set([
    "--seed",
    "--size",
    "--clues",
    "--clue-ratio",
    "--attempts",
    "--dp-min",
    "--dp-max",
    "--max-nodes",
    "--symmetry",
    "--pattern",
    "--format",
    "--out",
    "--limit",
    "--count",
    "--refine",
    "--black-bias",
    "--anneal",
  ]);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (valued.has(arg)) {
      const value = argv[++i];
      if (value === undefined) {
        throw new Error(`${arg} requires a value`);
      }
      values.set(arg, value);
    } else if (arg.startsWith("--")) {
      flags.add(arg);
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags, values };
};

const intOption = (options: Options, name: string, fallback: number): number => {
  const raw = options.values.get(name);
  if (raw === undefined) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) throw new Error(`${name} must be an integer`);
  return value;
};

const floatOption = (options: Options, name: string, fallback: number): number => {
  const raw = options.values.get(name);
  if (raw === undefined) return fallback;
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number`);
  return value;
};

const sizeOption = (options: Options): { cols: number; rows: number } => {
  const raw = options.values.get("--size") ?? "10x10";
  const match = /^(\d+)x(\d+)$/.exec(raw);
  if (!match) throw new Error("--size must look like 10x10");
  return { cols: Number.parseInt(match[1]!, 10), rows: Number.parseInt(match[2]!, 10) };
};

const readProblem = (source: string): Board => {
  const text = existsSync(source) ? readFileSync(source, "utf8") : source;
  const trimmed = text.trim();
  if (trimmed.includes("yajilin/")) {
    return decodeUrl(trimmed);
  }
  return parseProblemText(trimmed);
};

const readPattern = (source: string, cols: number, rows: number): boolean[] => {
  const text = readFileSync(source, "utf8");
  // A pattern row may legitimately start with '#', so only "# " counts as a comment.
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) => line.length > 0 && !(line.startsWith("#") && (line.length === 1 || line[1] === " "))
    );
  if (lines.length !== rows) {
    throw new Error(`pattern must have ${rows} rows, found ${lines.length}`);
  }
  const pattern = new Array<boolean>(cols * rows).fill(false);
  lines.forEach((line, y) => {
    const cells = line.split(/\s+/).length === cols ? line.split(/\s+/) : [...line];
    if (cells.length !== cols) {
      throw new Error(`pattern row ${y + 1} must have ${cols} cells`);
    }
    cells.forEach((token, x) => {
      pattern[y * cols + x] = token !== "." && token !== "0";
    });
  });
  return pattern;
};

/**
 * The puzzle-square 1-5 rating, formatted from integer hundredths so that the three ports
 * print identical bytes — dividing first and formatting a float would not guarantee that.
 */
const formatRating = (score: number): string => {
  const hundredths = puzsqRatingHundredths(score);
  const whole = Math.floor(hundredths / 100);
  const fraction = hundredths - whole * 100;
  return `${whole}.${String(fraction).padStart(2, "0")}`;
};

/**
 * Node budget for the uniqueness check. A budget rather than a deadline: the node count is
 * deterministic, so the three ports agree on when to give up, which a clock never would.
 *
 * The value buys what it can and no more. On the 164 puzzles in the corpus that the
 * technique solver cannot finish, this settles roughly two thirds of them at about a second
 * each; the rest do not settle at any budget worth spending — 34 of them were still running
 * after twenty minutes apiece. Past that point the honest answer is "unverified".
 *
 * It costs nothing on an ordinary puzzle, because a finished solve is never asked.
 */
const UNIQUENESS_NODES = 250_000;

/**
 * How many answers the puzzle has, as "0", "1", "2+" or "?" when the budget ran out.
 *
 * Only asked when the technique solver stopped short. Every deduction it makes is forced —
 * even the trials, which only ever rule a colour out by contradiction — so a solve that
 * finishes has proved its answer is the only one, and searching again would be waste.
 *
 * It has to be asked at all because a puzzle with two answers is not hard, it is broken,
 * and the solver stalling on it looks exactly like the solver stalling on a hard one.
 */
const countAnswers = (board: Board, status: string): string => {
  if (status === "completed") return "1";
  const found = countSolutions(board, 2, UNIQUENESS_NODES);
  if (found.aborted) return "?";
  if (found.solutions.length >= 2) return "2+";
  return String(found.solutions.length);
};

const emit = (options: Options, text: string): void => {
  const out = options.values.get("--out");
  if (out) {
    writeFileSync(out, text);
  } else {
    process.stdout.write(text);
  }
};

const solveCommand = (options: Options): number => {
  const source = options.positional[0];
  if (!source) throw new Error("solve needs a problem");
  const board = readProblem(source);
  const outcome = runAll(board, undefined, { noTrial: options.flags.has("--no-trial") });
  const solution = extractSolution(outcome.answer);
  const errors =
    outcome.status === "completed" ? validateSolution(board, solution) : [];

  const lines: string[] = [];
  lines.push(`STATUS ${outcome.status.toUpperCase()}`);
  const solutions = countAnswers(board, outcome.status);
  lines.push(`SOLUTIONS ${solutions}`);
  const score = difficulty(outcome, board);
  lines.push(`DP ${score}`);
  lines.push(`BAND ${band(score)}`);
  // A score says how hard the puzzle was to work through, which means nothing when there
  // is nothing single to work towards.
  lines.push(`RATING ${solutions === "1" ? formatRating(score) : "-"}`);
  lines.push(`LEVEL ${outcome.stats.level}`);
  lines.push(`PASSES ${outcome.stats.passes}`);
  lines.push(
    `TRIAL ${outcome.stats.trialDeductions} ${outcome.stats.maxTrialCount}`
  );
  if (errors.length > 0) {
    lines.push(`INVALID ${errors.length}`);
    errors.slice(0, 5).forEach((error) => {
      lines.push(`  ${describeValidationError(error)}`);
    });
  }
  let text = `${lines.join("\n")}\n`;
  text += formatAnswerGrid(board, solution);
  text += formatSolutionSummary(solution);
  emit(options, text);

  if (outcome.status === "broken") return 1;
  if (outcome.status !== "completed") return 2;
  return errors.length > 0 ? 1 : 0;
};

const countCommand = (options: Options): number => {
  const source = options.positional[0];
  if (!source) throw new Error("count needs a problem");
  const board = readProblem(source);
  const limit = intOption(options, "--limit", 2);
  const maxNodes = intOption(options, "--max-nodes", 0);
  const result = countSolutions(board, limit, maxNodes);
  emit(
    options,
    `SOLUTIONS ${result.solutions.length}\nNODES ${result.nodes}\nABORTED ${
      result.aborted ? 1 : 0
    }\n`
  );
  return result.solutions.length === 1 ? 0 : 1;
};

const generateOptions = (options: Options): GenerateOptions => {
  const { cols, rows } = sizeOption(options);
  const generate: GenerateOptions = {
    cols,
    rows,
    attempts: intOption(options, "--attempts", 100),
    maxNodes: intOption(options, "--max-nodes", 200000),
    clueRatio: floatOption(options, "--clue-ratio", 0.16),
    weaken: !options.flags.has("--no-weaken"),
    reduce: !options.flags.has("--no-reduce"),
    refine: intOption(options, "--refine", 0),
    varyClueCount: options.flags.has("--vary-clue-count"),
    blackBias: intOption(options, "--black-bias", 850),
  };
  if (options.values.has("--anneal")) {
    generate.anneal = intOption(options, "--anneal", 0);
  }
  if (options.values.has("--clues")) {
    generate.clues = intOption(options, "--clues", 0);
  }
  if (options.values.has("--dp-min")) {
    generate.dpMin = intOption(options, "--dp-min", 0);
  }
  if (options.values.has("--dp-max")) {
    generate.dpMax = intOption(options, "--dp-max", 0);
  }
  const symmetry = options.values.get("--symmetry");
  if (symmetry) {
    generate.symmetry = symmetry as Symmetry;
  }
  const pattern = options.values.get("--pattern");
  if (pattern) {
    generate.pattern = readPattern(pattern, cols, rows);
  }
  return generate;
};

const renderGenerated = (options: Options, generated: Generated): string => {
  const format = options.values.get("--format") ?? "grid";
  if (format === "url") return `${encodeUrl(generated.board)}\n`;
  if (format === "code") return `${encodeCode(generated.board)}\n`;
  if (format === "text") return formatProblemText(generated.board);

  const clues = generated.board.cell.filter((cell) => cell.qnum !== -1).length;
  const lines = [
    `CODE ${encodeCode(generated.board)}`,
    `URL ${encodeUrl(generated.board)}`,
    `DP ${generated.difficulty}`,
    `BAND ${band(generated.difficulty)}`,
    `RATING ${formatRating(generated.difficulty)}`,
    `STATUS ${generated.outcome.status.toUpperCase()}`,
    `CLUES ${clues}`,
    `BLACKS ${generated.solution.blacks.size}`,
    `ATTEMPTS ${generated.attempts}`,
  ];
  return `${lines.join("\n")}\n${formatProblemText(generated.board)}${formatAnswerGrid(
    generated.board,
    generated.solution
  )}`;
};

const generateCommand = (options: Options, mode: "loop" | "pattern"): number => {
  const rng = new Rng(intOption(options, "--seed", 0));
  const generate = generateOptions(options);
  const generated =
    mode === "loop" ? generateLoop(rng, generate) : generatePattern(rng, generate);
  if (!generated) {
    process.stderr.write(`RESULT GENERATE_FAILED attempts=${generate.attempts}\n`);
    return 2;
  }
  emit(options, renderGenerated(options, generated));
  return 0;
};

const benchCommand = (options: Options): number => {
  const count = intOption(options, "--count", 10);
  const seed = intOption(options, "--seed", 0);
  const generate = generateOptions(options);

  const generateStart = Date.now();
  let generated = 0;
  let dpTotal = 0;
  const boards: Board[] = [];
  for (let i = 0; i < count; i++) {
    const rng = new Rng(seed + i);
    const puzzle = generateLoop(rng, generate);
    if (puzzle) {
      generated++;
      dpTotal += puzzle.difficulty;
      boards.push(cloneBoard(puzzle.board));
    }
  }
  const generateMs = Date.now() - generateStart;

  const solveStart = Date.now();
  let solved = 0;
  for (const board of boards) {
    if (runAll(board).status === "completed") solved++;
  }
  const solveMs = Date.now() - solveStart;

  const countStart = Date.now();
  let unique = 0;
  for (const board of boards) {
    const result = countSolutions(board, 2, generate.maxNodes ?? 0);
    if (!result.aborted && result.solutions.length === 1) unique++;
  }
  const countMs = Date.now() - countStart;

  emit(
    options,
    [
      `GENERATED ${generated}/${count}`,
      `GENERATE_MS ${generateMs}`,
      `SOLVED ${solved}/${boards.length}`,
      `SOLVE_MS ${solveMs}`,
      `UNIQUE ${unique}/${boards.length}`,
      `COUNT_MS ${countMs}`,
      `DP_AVG ${generated > 0 ? Math.round(dpTotal / generated) : 0}`,
      "",
    ].join("\n")
  );
  return generated === count ? 0 : 2;
};

const main = (): number => {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(USAGE);
    return argv.length === 0 ? 1 : 0;
  }
  const command = argv[0]!;
  const options = parseArgs(argv.slice(1));
  switch (command) {
    case "solve":
      return solveCommand(options);
    case "count":
      return countCommand(options);
    case "generate-loop":
      return generateCommand(options, "loop");
    case "generate-pattern":
      return generateCommand(options, "pattern");
    case "bench":
      return benchCommand(options);
    default:
      process.stderr.write(`unknown command: ${command}\n`);
      process.stdout.write(USAGE);
      return 1;
  }
};

try {
  process.exitCode = main();
} catch (error) {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exitCode = 1;
}
