/*
 * カットの偶奇。ループは閉路なので、盤面を縦または横の直線で 2 つに分けたとき、
 * その境界を横切る線分の本数は必ず偶数になる。さらにヤジリンの線は黒マス以外の
 * すべての白マスを通る一本のループなので、カットの両側に「必ず通るマス」があるなら
 * 横断は 2 本以上でもある。詳細は Rust 版 techniques/cut_parity.rs を参照。
 */

import type { Board } from "../board.js";
import { LineState } from "../answerModel.js";
import type { AnswerMethods } from "../answerMethods.js";
import type { Position } from "../position.js";
import { Reason } from "../reasons.js";
import type { Status } from "../status.js";

const stripMustBeVisited = (
  board: Board,
  answer: AnswerMethods,
  vertical: boolean,
  start: number,
  stop: number
): boolean => {
  const inner = vertical ? board.rows : board.cols;
  for (let t = start; t < stop; t++) {
    for (let u = 0; u < inner; u++) {
      const pos: Position = vertical ? { x: t, y: u } : { x: u, y: t };
      if (!board.inBoard(pos)) {
        continue;
      }
      if (board.cell[pos.y * board.cols + pos.x]!.qnum !== -1) {
        continue;
      }
      if (answer.hasWhiteCell(pos) || answer.hasLine(pos) || answer.isLineEdge(pos)) {
        return true;
      }
      // ヒントでない隣接ペア: 黒は隣接できないので、少なくとも一方は白=必通
      for (const next of [
        { x: pos.x + 1, y: pos.y },
        { x: pos.x, y: pos.y + 1 },
      ]) {
        const inStrip = vertical ? next.x < stop : next.y < stop;
        if (
          inStrip &&
          board.inBoard(next) &&
          board.cell[next.y * board.cols + next.x]!.qnum === -1
        ) {
          return true;
        }
      }
    }
  }
  return false;
};

export const cutParity = (board: Board, answer: AnswerMethods): Status => {
  let advanced = false;
  for (const vertical of [true, false]) {
    const cuts = vertical ? board.cols : board.rows;
    const length = vertical ? board.rows : board.cols;
    for (let c = 1; c < cuts; c++) {
      let lines = 0;
      const unknowns: [Position, Position][] = [];
      for (let t = 0; t < length; t++) {
        const [a, b]: [Position, Position] = vertical
          ? [{ x: c - 1, y: t }, { x: c, y: t }]
          : [{ x: t, y: c - 1 }, { x: t, y: c }];
        const state = answer.getLineState(a, b);
        if (state === LineState.Line) {
          lines++;
        } else if (state === LineState.Bar || answer.forbidden(a) || answer.forbidden(b)) {
          // この辺は横断できない
        } else {
          unknowns.push([a, b]);
        }
      }
      const bothVisited =
        stripMustBeVisited(board, answer, vertical, 0, c) &&
        stripMustBeVisited(board, answer, vertical, c, cuts);
      const low = bothVisited ? Math.max(lines, 2) : lines;
      const high = lines + unknowns.length;
      const cMin = low % 2 === 0 ? low : low + 1;
      const cMax = high % 2 === 0 ? high : high - 1;
      if (cMin > cMax) {
        return "broken";
      }
      if (unknowns.length === 0 || cMin !== cMax) {
        continue;
      }
      if (cMax === high) {
        for (const [a, b] of unknowns) {
          if (answer.addLine([a, b], Reason.CutParityLine)) {
            advanced = true;
          }
        }
      } else if (cMin === lines) {
        for (const [a, b] of unknowns) {
          answer.setLineBar(a, b);
          advanced = true;
        }
      }
    }
  }
  return advanced ? "advanced" : "stopped";
};
