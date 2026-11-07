/**
 * Core types for solver-kit
 * Mapped from SDVX's Common.java abstractions
 */
// ============================================
// Cell State Types (Masu equivalent)
// ============================================
/**
 * Cell shading state - for puzzles with black/white cell painting
 * Maps to SDVX Masu enum
 */
export var CellState;
(function (CellState) {
    /** Unknown/undetermined */
    CellState["UNKNOWN"] = "unknown";
    /** Definitely not black (white/empty) */
    CellState["WHITE"] = "white";
    /** Definitely black (filled) */
    CellState["BLACK"] = "black";
})(CellState || (CellState = {}));
/**
 * Generic tri-state for any binary decision
 */
export var TriState;
(function (TriState) {
    TriState["UNKNOWN"] = "unknown";
    TriState["FALSE"] = "false";
    TriState["TRUE"] = "true";
})(TriState || (TriState = {}));
// ============================================
// Edge/Wall Types (Wall equivalent)
// ============================================
/**
 * Edge/wall state - for line-drawing puzzles (Slither Link, etc.)
 * Maps to SDVX Wall enum
 */
export var EdgeState;
(function (EdgeState) {
    /** Unknown/undetermined */
    EdgeState["UNKNOWN"] = "unknown";
    /** Definitely no edge */
    EdgeState["EMPTY"] = "empty";
    /** Definitely has edge */
    EdgeState["LINE"] = "line";
})(EdgeState || (EdgeState = {}));
/**
 * Wall state - for region division puzzles (Fillomino, etc.)
 * Maps to SDVX Wall enum for region boundaries
 */
export var WallState;
(function (WallState) {
    /** Unknown/undetermined */
    WallState["UNKNOWN"] = "unknown";
    /** Definitely no wall (cells connected) */
    WallState["NO_WALL"] = "no_wall";
    /** Definitely has wall (cells separated) */
    WallState["WALL"] = "wall";
})(WallState || (WallState = {}));
// ============================================
// Direction Types (Direction equivalent)
// ============================================
/**
 * Cardinal directions
 * Maps to SDVX Direction enum
 */
export var Direction;
(function (Direction) {
    Direction["UP"] = "up";
    Direction["RIGHT"] = "right";
    Direction["DOWN"] = "down";
    Direction["LEFT"] = "left";
})(Direction || (Direction = {}));
/** Direction delta vectors */
export const DIRECTION_DELTA = {
    [Direction.UP]: { dy: -1, dx: 0 },
    [Direction.RIGHT]: { dy: 0, dx: 1 },
    [Direction.DOWN]: { dy: 1, dx: 0 },
    [Direction.LEFT]: { dy: 0, dx: -1 },
};
/** All four cardinal directions */
export const DIRECTIONS = [Direction.UP, Direction.RIGHT, Direction.DOWN, Direction.LEFT];
/** Get opposite direction */
export function oppositeDirection(dir) {
    switch (dir) {
        case Direction.UP: return Direction.DOWN;
        case Direction.DOWN: return Direction.UP;
        case Direction.LEFT: return Direction.RIGHT;
        case Direction.RIGHT: return Direction.LEFT;
    }
}
/** Get clockwise direction */
export function clockwiseDirection(dir) {
    switch (dir) {
        case Direction.UP: return Direction.RIGHT;
        case Direction.RIGHT: return Direction.DOWN;
        case Direction.DOWN: return Direction.LEFT;
        case Direction.LEFT: return Direction.UP;
    }
}
/** Create a position */
export function pos(row, col) {
    return { row, col };
}
/** Check position equality */
export function posEqual(a, b) {
    return a.row === b.row && a.col === b.col;
}
/** Get adjacent position in given direction */
export function adjacent(p, dir) {
    const delta = DIRECTION_DELTA[dir];
    return { row: p.row + delta.dy, col: p.col + delta.dx };
}
/** Get all adjacent positions */
export function adjacentPositions(p) {
    return DIRECTIONS.map(dir => adjacent(p, dir));
}
/** Convert position to string key */
export function posKey(p) {
    return `${p.row},${p.col}`;
}
/** Parse position from string key */
export function parsePos(key) {
    const [row, col] = key.split(',').map(Number);
    return { row, col };
}
/** Create rectangle from corners */
export function rect(top, left, bottom, right) {
    return { top, left, bottom, right };
}
/** Get rectangle width */
export function rectWidth(r) {
    return r.right - r.left + 1;
}
/** Get rectangle height */
export function rectHeight(r) {
    return r.bottom - r.top + 1;
}
/** Get rectangle area (cell count) */
export function rectArea(r) {
    return rectWidth(r) * rectHeight(r);
}
/** Check if position is inside rectangle */
export function rectContains(r, p) {
    return p.row >= r.top && p.row <= r.bottom && p.col >= r.left && p.col <= r.right;
}
/** Iterate all positions in rectangle */
export function* rectPositions(r) {
    for (let row = r.top; row <= r.bottom; row++) {
        for (let col = r.left; col <= r.right; col++) {
            yield { row, col };
        }
    }
}
// ============================================
// Difficulty Types
// ============================================
/**
 * Puzzle difficulty levels
 * Maps to SDVX Difficulty enum (Japanese puzzle difficulty scale)
 */
export var Difficulty;
(function (Difficulty) {
    /** Very easy - らくらく */
    Difficulty["EASY"] = "easy";
    /** Moderate - おてごろ */
    Difficulty["MEDIUM"] = "medium";
    /** Hard - たいへん */
    Difficulty["HARD"] = "hard";
    /** Very hard - アゼン */
    Difficulty["EXPERT"] = "expert";
    /** Extreme - ハバネロ */
    Difficulty["EXTREME"] = "extreme";
})(Difficulty || (Difficulty = {}));
// ============================================
// Solver Result Types
// ============================================
/**
 * Solver result status
 */
export var SolveStatus;
(function (SolveStatus) {
    /** Found unique solution */
    SolveStatus["SOLVED"] = "solved";
    /** No solution exists */
    SolveStatus["UNSOLVABLE"] = "unsolvable";
    /** Multiple solutions exist */
    SolveStatus["MULTIPLE"] = "multiple";
    /** Solver gave up (too complex) */
    SolveStatus["TIMEOUT"] = "timeout";
    /** Error during solving */
    SolveStatus["ERROR"] = "error";
})(SolveStatus || (SolveStatus = {}));
