/*
 * Runs the ported solver over the gridkit corpus and reports how many puzzles it
 * finishes, how many finished answers actually satisfy the Yajilin rules, and the
 * difficulty spread. Optionally cross-checks uniqueness with the exhaustive search.
 *
 * Usage: node --import tsx tools/run-corpus.mjs [--limit N] [--unique] [--verbose]
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { decodeUrl } from "../src/puzzlink.ts";
import { runAll } from "../src/solver.ts";
import { extractSolution, validateSolution, describeValidationError } from "../src/solution.ts";
import { countSolutions } from "../src/search.ts";
import { difficulty } from "../src/difficulty.ts";

const here = dirname(fileURLToPath(import.meta.url));
const corpus = readFileSync(resolve(here, "../testdata/corpus.tsv"), "utf8")
  .split("\n")
  .filter((line) => line.length > 0)
  .map((line) => {
    const [index, rating, code] = line.split("\t");
    return { index, rating, code };
  });

const args = process.argv.slice(2);
const limitArg = args.indexOf("--limit");
const limit = limitArg >= 0 ? Number.parseInt(args[limitArg + 1], 10) : corpus.length;
const checkUnique = args.includes("--unique");
const verbose = args.includes("--verbose");

let completed = 0;
let valid = 0;
let invalid = 0;
let stopped = 0;
let broken = 0;
let unique = 0;
let notUnique = 0;
let noSolution = 0;
let aborted = 0;
const started = Date.now();
let slowest = { index: "", ms: 0 };

for (const problem of corpus.slice(0, limit)) {
  const board = decodeUrl(problem.code);
  const t0 = Date.now();
  const outcome = runAll(board);
  const ms = Date.now() - t0;
  if (ms > slowest.ms) slowest = { index: problem.index, ms };

  if (outcome.status === "completed") {
    completed++;
    const solution = extractSolution(outcome.answer);
    const errors = validateSolution(board, solution);
    if (errors.length === 0) {
      valid++;
    } else {
      invalid++;
      if (verbose) {
        console.log(
          `#${problem.index} invalid: ${errors.slice(0, 3).map(describeValidationError).join("; ")}`
        );
      }
    }
    if (verbose) {
      console.log(`#${problem.index} rating=${problem.rating} dp=${difficulty(outcome)}`);
    }
  } else if (outcome.status === "broken") {
    broken++;
    if (verbose) console.log(`#${problem.index} broken`);
  } else {
    stopped++;
    if (verbose) console.log(`#${problem.index} stopped`);
  }

  if (checkUnique) {
    const result = countSolutions(board, 2, 200000);
    if (result.aborted) aborted++;
    else if (result.solutions.length === 1) unique++;
    else if (result.solutions.length === 0) noSolution++;
    else notUnique++;
  }
}

const total = Math.min(limit, corpus.length);
console.log(`problems      ${total}`);
console.log(`completed     ${completed}`);
console.log(`  valid       ${valid}`);
console.log(`  invalid     ${invalid}`);
console.log(`stopped       ${stopped}`);
console.log(`broken        ${broken}`);
if (checkUnique) {
  console.log(`unique        ${unique}`);
  console.log(`not unique    ${notUnique}`);
  console.log(`no solution   ${noSolution}`);
  console.log(`aborted       ${aborted}`);
}
console.log(`elapsed       ${Date.now() - started}ms`);
console.log(`slowest       #${slowest.index} ${slowest.ms}ms`);
