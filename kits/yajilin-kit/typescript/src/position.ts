/*
 * Yajilin Kit — TypeScript reference implementation.
 * Ported from gridkit `frontend/src/puzzle/Position.ts`.
 */

export type Position = {
  x: number;
  y: number;
};

export const equals = (a: Position, b: Position): boolean =>
  a.x === b.x && a.y === b.y;

/** Arrow direction codes as used by the puzz.link `yajilin` format. */
export const dirs: Record<number, Position> = {
  1: { x: 0, y: -1 },
  2: { x: 0, y: 1 },
  3: { x: -1, y: 0 },
  4: { x: 1, y: 0 },
};

/** Iteration order matters: it fixes the order of `around()` and therefore the solver's output. */
export const dirList: Position[] = [dirs[1]!, dirs[2]!, dirs[3]!, dirs[4]!];

export const around = (pos: Position): { pos: Position; dir: Position }[] =>
  dirList.map((dir) => ({ pos: { x: pos.x + dir.x, y: pos.y + dir.y }, dir }));

export const add = (a: Position, b: Position): Position => ({
  x: a.x + b.x,
  y: a.y + b.y,
});

export const subtract = (a: Position, b: Position): Position => ({
  x: a.x - b.x,
  y: a.y - b.y,
});
