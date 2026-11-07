/*
 * Yajilin Kit — puzz.link / pzprjs URL codec.
 *
 * Ported from pzprjs `src/variety-common/Encode.js`
 * (`decodeArrowNumber16` / `encodeArrowNumber16`), which is the format gridkit stores its
 * problems in: `yajilin/<cols>/<rows>/<body>`.
 */

import { createBoard, type Board } from "./board.js";

const BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz";

const isBetween = (ca: string, low: string, high: string): boolean =>
  low <= ca && ca <= high;

export type ParsedUrl = {
  type: string;
  cols: number;
  rows: number;
  body: string;
};

/** Accepts a full puzz.link/pzv.jp URL or a bare `yajilin/10/10/...` code. */
export const parseUrl = (input: string): ParsedUrl => {
  let text = input.trim();
  const queryIndex = text.indexOf("?");
  if (queryIndex >= 0) {
    text = text.slice(queryIndex + 1);
  }
  const parts = text.split("/").filter((part) => part.length > 0);
  if (parts.length < 4) {
    throw new Error(`not a yajilin puzzle url: ${input}`);
  }
  const type = parts[0]!;
  if (type !== "yajilin") {
    throw new Error(`unsupported puzzle type: ${type}`);
  }
  // Variant flags (e.g. "v:") may sit between the type and the size.
  let index = 1;
  while (index < parts.length && !/^\d+$/.test(parts[index]!)) {
    index++;
  }
  const cols = Number.parseInt(parts[index]!, 10);
  const rows = Number.parseInt(parts[index + 1]!, 10);
  const body = parts.slice(index + 2).join("/");
  if (!Number.isFinite(cols) || !Number.isFinite(rows)) {
    throw new Error(`not a yajilin puzzle url: ${input}`);
  }
  return { type, cols, rows, body };
};

export const decodeBody = (body: string, board: Board): void => {
  let c = 0;
  for (let i = 0; i < body.length; i++) {
    const ca = body.charAt(i);
    const cell = board.cell[c];
    if (!cell) {
      break;
    }
    if (ca === "+") {
      cell.qdir = 0;
      cell.qnum = -3;
    } else if (isBetween(ca, "0", "4")) {
      const ca1 = body.charAt(i + 1);
      cell.qdir = Number.parseInt(ca, 16);
      cell.qnum = ca1 !== "." ? Number.parseInt(ca1, 16) : -2;
      i++;
    } else if (isBetween(ca, "5", "9")) {
      cell.qdir = Number.parseInt(ca, 16) - 5;
      cell.qnum = Number.parseInt(body.substring(i + 1, i + 3), 16);
      i += 2;
    } else if (ca === "-") {
      cell.qdir = Number.parseInt(body.substring(i + 1, i + 2), 16);
      cell.qnum = Number.parseInt(body.substring(i + 2, i + 5), 16);
      i += 4;
    } else if (ca >= "a" && ca <= "z") {
      c += Number.parseInt(ca, 36) - 10;
    }

    c++;
    if (!board.cell[c]) {
      break;
    }
  }
};

export const decodeUrl = (input: string): Board => {
  const { cols, rows, body } = parseUrl(input);
  const board = createBoard(cols, rows);
  decodeBody(body, board);
  return board;
};

export const encodeBody = (board: Board): string => {
  let cm = "";
  let count = 0;
  for (let c = 0; c < board.cell.length; c++) {
    let pstr = "";
    const dir = board.cell[c]!.qdir;
    const qn = board.cell[c]!.qnum;
    if (qn === -2) {
      pstr = `${dir}.`;
    } else if (qn === -3) {
      pstr = "+";
    } else if (qn >= 0 && qn < 16) {
      pstr = `${dir}${qn.toString(16)}`;
    } else if (qn >= 16 && qn < 256) {
      pstr = `${dir + 5}${qn.toString(16)}`;
    } else if (qn >= 256 && qn < 4096) {
      pstr = `-${dir}${qn.toString(16)}`;
    } else {
      count++;
    }

    if (count === 0) {
      cm += pstr;
    } else if (pstr || count === 26) {
      cm += BASE36[count + 9]! + pstr;
      count = 0;
    }
  }
  if (count > 0) {
    cm += BASE36[count + 9]!;
  }
  return cm;
};

export const encodeCode = (board: Board): string =>
  `yajilin/${board.cols}/${board.rows}/${encodeBody(board)}`;

export const encodeUrl = (board: Board): string =>
  `https://puzz.link/p?${encodeCode(board)}`;
