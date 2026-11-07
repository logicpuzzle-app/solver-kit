/*
 * Yajilin Kit — text problem format and answer rendering.
 *
 * Text problems are the hand-writable input; the puzz.link code is the interchange
 * format. Both readers produce the same `Board`, and every renderer here is pure text so
 * the Rust and Python ports can be compared byte for byte.
 *
 * Cell syntax: `.` empty, `^N` `vN` `<N` `>N` an arrow with a count, `?` in place of N
 * for an arrow without a number, `+` for a plain blocked cell.
 */

import { createBoard, toId, type Board } from "./board.js";
import type { Solution } from "./solution.js";

const DIR_CHARS: Record<number, string> = { 1: "^", 2: "v", 3: "<", 4: ">" };
const CHAR_DIRS: Record<string, number> = { "^": 1, v: 2, "<": 3, ">": 4 };

export const parseProblemText = (text: string): Board => {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  if (lines.length === 0) {
    throw new Error("empty problem");
  }

  let header = lines[0]!.split(/\s+/);
  if (header[0] === "yajilin") {
    header = header.slice(1);
  }
  const cols = Number.parseInt(header[0]!, 10);
  const rows = Number.parseInt(header[1]!, 10);
  if (!Number.isFinite(cols) || !Number.isFinite(rows)) {
    throw new Error(`invalid size header: ${lines[0]}`);
  }
  const board = createBoard(cols, rows);

  const body = lines.slice(1);
  if (body.length !== rows) {
    throw new Error(`expected ${rows} rows, found ${body.length}`);
  }
  body.forEach((line, y) => {
    const tokens = line.split(/\s+/);
    if (tokens.length !== cols) {
      throw new Error(`row ${y + 1}: expected ${cols} cells, found ${tokens.length}`);
    }
    tokens.forEach((token, x) => {
      const cell = board.cell[y * cols + x]!;
      if (token === ".") {
        return;
      }
      if (token === "+") {
        cell.qdir = 0;
        cell.qnum = -3;
        return;
      }
      const dir = CHAR_DIRS[token.charAt(0)];
      if (dir === undefined) {
        throw new Error(`row ${y + 1}, cell ${x + 1}: unknown token ${token}`);
      }
      const rest = token.slice(1);
      cell.qdir = dir;
      if (rest === "?" || rest === "") {
        cell.qnum = -2;
        return;
      }
      const num = Number.parseInt(rest, 10);
      if (!Number.isFinite(num) || num < 0) {
        throw new Error(`row ${y + 1}, cell ${x + 1}: invalid clue ${token}`);
      }
      cell.qnum = num;
    });
  });
  return board;
};

const problemToken = (qdir: number, qnum: number): string => {
  if (qnum === -1) return ".";
  if (qnum === -3) return "+";
  const dirChar = DIR_CHARS[qdir] ?? "*";
  if (qnum === -2) return `${dirChar}?`;
  return `${dirChar}${qnum}`;
};

export const formatProblemText = (board: Board): string => {
  const lines: string[] = [`yajilin ${board.cols} ${board.rows}`];
  for (let y = 0; y < board.rows; y++) {
    const tokens: string[] = [];
    let width = 1;
    for (let x = 0; x < board.cols; x++) {
      const cell = board.cell[y * board.cols + x]!;
      const token = problemToken(cell.qdir, cell.qnum);
      width = Math.max(width, token.length);
      tokens.push(token);
    }
    lines.push(tokens.join(" "));
  }
  return `${lines.join("\n")}\n`;
};

const loopChar = (
  up: boolean,
  down: boolean,
  left: boolean,
  right: boolean
): string => {
  if (up && down) return "|";
  if (left && right) return "-";
  if (up && right) return "L";
  if (up && left) return "J";
  if (down && right) return "r";
  if (down && left) return "7";
  if (up || down) return "|";
  if (left || right) return "-";
  return "o";
};

/**
 * Renders the answer as a grid: cells on odd columns, connectors between them.
 * `#` black, `.` a cell with no line, arrows for clues, loop pieces otherwise.
 */
export const formatAnswerGrid = (board: Board, solution: Solution): string => {
  const lines: string[] = [];
  for (let y = 0; y < board.rows; y++) {
    let row = "";
    for (let x = 0; x < board.cols; x++) {
      const id = toId({ x, y });
      const cell = board.cell[y * board.cols + x]!;
      if (solution.blacks.has(id)) {
        row += "#";
      } else if (cell.qnum !== -1) {
        row += cell.qnum === -3 ? "+" : (DIR_CHARS[cell.qdir] ?? "*");
      } else {
        const up = solution.vertical.has(toId({ x, y: y - 1 }));
        const down = solution.vertical.has(id);
        const left = solution.horizontal.has(toId({ x: x - 1, y }));
        const right = solution.horizontal.has(id);
        row += up || down || left || right ? loopChar(up, down, left, right) : ".";
      }
      if (x < board.cols - 1) {
        row += solution.horizontal.has(id) ? "-" : " ";
      }
    }
    lines.push(row);
    if (y < board.rows - 1) {
      let between = "";
      for (let x = 0; x < board.cols; x++) {
        between += solution.vertical.has(toId({ x, y })) ? "|" : " ";
        if (x < board.cols - 1) {
          between += " ";
        }
      }
      lines.push(between);
    }
  }
  return `${lines.join("\n")}\n`;
};

const positionsOf = (ids: Set<number>): string =>
  [...ids]
    .sort((a, b) => a - b)
    .map((id) => `${(id & 0xff) + 1},${(id >> 16) + 1}`)
    .join(" ");

/** Machine-readable summary; stable ordering makes cross-language diffs trivial. */
export const formatSolutionSummary = (solution: Solution): string => {
  const lines = [
    `BLACK ${positionsOf(solution.blacks)}`.trimEnd(),
    `HLINE ${positionsOf(solution.horizontal)}`.trimEnd(),
    `VLINE ${positionsOf(solution.vertical)}`.trimEnd(),
  ];
  return `${lines.join("\n")}\n`;
};
