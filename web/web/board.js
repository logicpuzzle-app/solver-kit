import { cspuzBoardSVG } from "./cspuz-board.js";
import { answerSVG } from "./numlin/answer.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const CELL = 40;
// Numberlink boards use the full content width (main is 720px minus padding).
const NUMLIN_MAX_WIDTH = 680;
const ARROWS = { 1: "↑", 2: "↓", 3: "←", 4: "→" };
const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", sans-serif';

export function boardSVG(raw, { doc = document, labels = {} } = {}) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.engine === "cspuz") return cspuzBoardSVG(raw.board, { doc, labels, example: raw.example });
  if (raw.fallback?.engine === "cspuz") return cspuzBoardSVG(raw.fallback.board, { doc, labels });
  const renderers = {
    sudoku: sudokuSVG, slitherlink: slitherSVG, yajilin: yajilinSVG,
    nurikabe: nurikabeSVG, akari: akariSVG, masyu: masyuSVG, numlin: numlinSVG,
  };
  const render = renderers[raw.kind];
  if (typeof render !== "function" || !Object.hasOwn(renderers, raw.kind)) return null;
  const width = raw.kind === "sudoku" ? raw.size : raw.kind === "numlin" ? raw.width : raw.cols;
  const height = raw.kind === "sudoku" ? raw.size : raw.kind === "numlin" ? raw.height : raw.rows;
  if (![width, height].every(n => Number.isInteger(n) && n > 0)) return null;
  const arrays = {
    sudoku: ["problem", "solution"], slitherlink: ["clues", "hlines", "vlines"],
    yajilin: ["clues", "blacks", "hlines", "vlines"], nurikabe: ["clues", "blacks", "whites"],
    akari: ["cells", "lit", "empties", "lamps"], masyu: ["whites", "blacks", "hlines", "vlines"],
    numlin: ["clues"],
  };
  if (!arrays[raw.kind].every(key => Array.isArray(raw[key]))) return null;
  if (raw.kind === "numlin" && raw.answer &&
      (raw.answer.width !== width || raw.answer.height !== height || !Array.isArray(raw.answer.links))) return null;
  const svgEl = (tag, attrs, text) => {
    const el = doc.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    if (text != null) el.textContent = text;
    return el;
  };
  const root = render(raw, svgEl, labels, doc);
  const answer = raw.kind === "numlin" ? !!raw.answer : raw.solutions === "1" || raw.solutions === "?" ||
    raw.kind === "sudoku" && raw.solution.some((value, i) => value && !raw.problem[i]);
  const attrs = { role: "img", "aria-label": answer ? labels.answer ?? "Answer" : labels.problem ?? "Problem",
    "font-family": FONT_FAMILY, "font-size": 16, "font-weight": 400, fill: "#000", stroke: "none" };
  for (const [key, value] of Object.entries(attrs)) root.setAttribute(key, value);
  return root;
}

function numlinSVG(r, svgEl, labels, doc) {
  if (r.answer) {
    const svg = answerSVG(r.answer, r.clues, labels.answer ?? "Answer", { doc, detour: r.detour });
    svg.setAttribute("width", Math.min(r.width * CELL, NUMLIN_MAX_WIDTH));
    svg.removeAttribute("height");
    return svg;
  }
  const w = r.width * CELL, h = r.height * CELL;
  const svg = svgEl("svg", { viewBox: `-2 -2 ${w + 4} ${h + 4}`,
    width: Math.min(w, NUMLIN_MAX_WIDTH), role: "img", "aria-label": labels.problem ?? "Problem" });
  svg.append(svgEl("rect", { x: 0, y: 0, width: w, height: h, fill: "#fff" }));
  for (let x = 0; x <= r.width; x++) {
    svg.append(svgEl("line", { x1: x * CELL, y1: 0, x2: x * CELL, y2: h,
      stroke: "#aaa", "stroke-width": x === 0 || x === r.width ? 2.5 : 1 }));
  }
  for (let y = 0; y <= r.height; y++) {
    svg.append(svgEl("line", { x1: 0, y1: y * CELL, x2: w, y2: y * CELL,
      stroke: "#aaa", "stroke-width": y === 0 || y === r.height ? 2.5 : 1 }));
  }
  r.clues.forEach((clue, i) => {
    if (!clue) return;
    svg.append(svgEl("text", { x: (i % r.width + .5) * CELL,
      y: (Math.floor(i / r.width) + .5) * CELL + 1,
      "text-anchor": "middle", "dominant-baseline": "central",
      "font-size": clue >= 100 ? 14 : 20, "font-weight": 600, fill: "#111" }, clue));
  });
  return svg;
}

function sudokuSVG(r, svgEl) {
  const n = r.size;
  const w = n * CELL;
  const svg = svgEl("svg", { viewBox: `-2 -2 ${w + 4} ${w + 4}`, width: Math.min(w, 480) });
  svg.append(svgEl("rect", { x: 0, y: 0, width: w, height: w, fill: "#fff" }));
  for (let i = 0; i <= n; i++) {
    const thickH = i % r.block_height === 0 ? 2.5 : 1;
    const thickV = i % r.block_width === 0 ? 2.5 : 1;
    svg.append(svgEl("line", { x1: 0, y1: i * CELL, x2: w, y2: i * CELL,
      stroke: "#333", "stroke-width": thickH }));
    svg.append(svgEl("line", { x1: i * CELL, y1: 0, x2: i * CELL, y2: w,
      stroke: "#333", "stroke-width": thickV }));
  }
  const unique = r.solutions === "1";
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const given = r.problem[i] !== 0;
      const byTechnique = r.solution[i] !== 0;
      // 唯一解のときだけ、手筋で届かないマスもバックトラック解で埋めて表示する
      const value = given
        ? r.problem[i]
        : byTechnique
          ? r.solution[i]
          : unique && r.full_solution
            ? r.full_solution[i]
            : 0;
      if (!value) continue;
      svg.append(svgEl("text", {
        x: x * CELL + CELL / 2, y: y * CELL + CELL / 2 + 1,
        "text-anchor": "middle", "dominant-baseline": "central",
        "font-size": n > 9 ? 16 : 22,
        "font-weight": given ? 700 : 400,
        fill: given ? "#111" : byTechnique ? "#2456d6" : "#9b59b6",
      }, value <= 9 ? String(value) : String.fromCharCode(55 + value)));
    }
  }
  return svg;
}

function slitherSVG(r, svgEl) {
  const M = 12; // 外周マージン(線が端の点の外へはみ出ないように)
  const w = r.cols * CELL;
  const h = r.rows * CELL;
  const svg = svgEl("svg", {
    viewBox: `${-M} ${-M} ${w + 2 * M} ${h + 2 * M}`,
    width: Math.min(w + 2 * M, 480),
  });
  svg.append(svgEl("rect", { x: -M, y: -M, width: w + 2 * M, height: h + 2 * M, fill: "#fff" }));
  for (let y = 0; y < r.rows; y++) {
    for (let x = 0; x < r.cols; x++) {
      const clue = r.clues[y * r.cols + x];
      if (clue < 0) continue;
      svg.append(svgEl("text", {
        x: x * CELL + CELL / 2, y: y * CELL + CELL / 2 + 1,
        "text-anchor": "middle", "dominant-baseline": "central",
        "font-size": 18, fill: "#111",
      }, String(clue)));
    }
  }
  const drawMarks = r.solutions === "1" || r.solutions === "?";
  if (drawMarks) {
    const lineAttr = { stroke: "#2456d6", "stroke-width": 4, "stroke-linecap": "round" };
    for (const [x, y] of r.hlines) {
      svg.append(svgEl("line", { ...lineAttr,
        x1: x * CELL, y1: y * CELL, x2: (x + 1) * CELL, y2: y * CELL }));
    }
    for (const [x, y] of r.vlines) {
      svg.append(svgEl("line", { ...lineAttr,
        x1: x * CELL, y1: y * CELL, x2: x * CELL, y2: (y + 1) * CELL }));
    }
  }
  for (let y = 0; y <= r.rows; y++) {
    for (let x = 0; x <= r.cols; x++) {
      svg.append(svgEl("circle", { cx: x * CELL, cy: y * CELL, r: 2.4, fill: "#444" }));
    }
  }
  return svg;
}

function yajilinSVG(r, svgEl) {
  const w = r.cols * CELL;
  const h = r.rows * CELL;
  const svg = svgEl("svg", { viewBox: `-2 -2 ${w + 4} ${h + 4}`, width: Math.min(w, 480) });
  svg.append(svgEl("rect", { x: 0, y: 0, width: w, height: h, fill: "#fff" }));

  for (const c of r.clues) {
    svg.append(svgEl("rect", {
      x: c.x * CELL, y: c.y * CELL, width: CELL, height: CELL, fill: "#e3e3ea",
    }));
    if (c.num !== -3) {
      const num = c.num === -2 ? "?" : String(c.num);
      svg.append(svgEl("text", {
        x: c.x * CELL + CELL / 2 - 6, y: c.y * CELL + CELL / 2 + 1,
        "text-anchor": "middle", "dominant-baseline": "central",
        "font-size": 16, fill: "#111",
      }, num));
      svg.append(svgEl("text", {
        x: c.x * CELL + CELL / 2 + 8, y: c.y * CELL + CELL / 2 + 1,
        "text-anchor": "middle", "dominant-baseline": "central",
        "font-size": 14, fill: "#111",
      }, ARROWS[c.dir] ?? ""));
    }
  }
  // 解なし・複数解のときは途中の確定マークを描かない(誤解のもとになる)
  const drawMarks = r.solutions === "1" || r.solutions === "?";
  if (drawMarks) {
    for (const [x, y] of r.blacks) {
      svg.append(svgEl("rect", {
        x: x * CELL + 4, y: y * CELL + 4, width: CELL - 8, height: CELL - 8,
        fill: "#26262e", rx: 3,
      }));
    }
    const lineAttr = { stroke: "#2456d6", "stroke-width": 4, "stroke-linecap": "round" };
    for (const [x, y] of r.hlines) {
      svg.append(svgEl("line", { ...lineAttr,
        x1: x * CELL + CELL / 2, y1: y * CELL + CELL / 2,
        x2: (x + 1) * CELL + CELL / 2, y2: y * CELL + CELL / 2 }));
    }
    for (const [x, y] of r.vlines) {
      svg.append(svgEl("line", { ...lineAttr,
        x1: x * CELL + CELL / 2, y1: y * CELL + CELL / 2,
        x2: x * CELL + CELL / 2, y2: (y + 1) * CELL + CELL / 2 }));
    }
  }
  for (let i = 0; i <= r.cols; i++) {
    svg.append(svgEl("line", { x1: i * CELL, y1: 0, x2: i * CELL, y2: h, stroke: "#aaa", "stroke-width": i === 0 || i === r.cols ? 2.5 : 1 }));
  }
  for (let i = 0; i <= r.rows; i++) {
    svg.append(svgEl("line", { x1: 0, y1: i * CELL, x2: w, y2: i * CELL, stroke: "#aaa", "stroke-width": i === 0 || i === r.rows ? 2.5 : 1 }));
  }
  return svg;
}

function nurikabeSVG(r, svgEl) {
  const w = r.cols * CELL;
  const h = r.rows * CELL;
  const svg = svgEl("svg", { viewBox: `-2 -2 ${w + 4} ${h + 4}`, width: Math.min(w, 480) });
  svg.append(svgEl("rect", { x: 0, y: 0, width: w, height: h, fill: "#fff" }));

  // 解なし・複数解のときは途中の確定マークを描かない(誤解のもとになる)
  const drawMarks = r.solutions === "1" || r.solutions === "?";
  if (drawMarks) {
    for (const [x, y] of r.blacks) {
      svg.append(svgEl("rect", {
        x: x * CELL, y: y * CELL, width: CELL, height: CELL, fill: "#26262e",
      }));
    }
    // 白と確定したマスは点で示す。塗らないのは、未確定との差を出しつつ
    // 「白は最初からそこにある」という見え方を保つため。
    for (const [x, y] of r.whites) {
      svg.append(svgEl("circle", {
        cx: x * CELL + CELL / 2, cy: y * CELL + CELL / 2, r: 2.5, fill: "#b9b9c4",
      }));
    }
  }

  for (let y = 0; y < r.rows; y++) {
    for (let x = 0; x < r.cols; x++) {
      const clue = r.clues[y * r.cols + x];
      if (clue === -1) continue;
      svg.append(svgEl("rect", {
        x: x * CELL, y: y * CELL, width: CELL, height: CELL, fill: "#e3e3ea",
      }));
      svg.append(svgEl("text", {
        x: x * CELL + CELL / 2, y: y * CELL + CELL / 2 + 1,
        "text-anchor": "middle", "dominant-baseline": "central",
        "font-size": clue >= 100 ? 12 : 16, fill: "#111",
      }, clue === -2 ? "?" : String(clue)));
    }
  }

  for (let i = 0; i <= r.cols; i++) {
    svg.append(svgEl("line", { x1: i * CELL, y1: 0, x2: i * CELL, y2: h, stroke: "#aaa", "stroke-width": i === 0 || i === r.cols ? 2.5 : 1 }));
  }
  for (let i = 0; i <= r.rows; i++) {
    svg.append(svgEl("line", { x1: 0, y1: i * CELL, x2: w, y2: i * CELL, stroke: "#aaa", "stroke-width": i === 0 || i === r.rows ? 2.5 : 1 }));
  }
  return svg;
}

function akariSVG(r, svgEl) {
  const w = r.cols * CELL;
  const h = r.rows * CELL;
  const svg = svgEl("svg", { viewBox: `-2 -2 ${w + 4} ${h + 4}`, width: Math.min(w, 480) });
  svg.append(svgEl("rect", { x: 0, y: 0, width: w, height: h, fill: "#fff" }));

  const drawMarks = r.solutions === "1" || r.solutions === "?";
  if (drawMarks) {
    for (const [x, y] of r.lit) {
      svg.append(svgEl("rect", {
        x: x * CELL, y: y * CELL, width: CELL, height: CELL, fill: "#fdf3d8",
      }));
    }
  }

  for (let y = 0; y < r.rows; y++) {
    for (let x = 0; x < r.cols; x++) {
      const cell = r.cells[y * r.cols + x];
      if (cell === -1) continue;
      svg.append(svgEl("rect", {
        x: x * CELL, y: y * CELL, width: CELL, height: CELL, fill: "#26262e",
      }));
      if (cell >= 0) {
        svg.append(svgEl("text", {
          x: x * CELL + CELL / 2, y: y * CELL + CELL / 2 + 1,
          "text-anchor": "middle", "dominant-baseline": "central",
          "font-size": 16, fill: "#f2f2f5",
        }, String(cell)));
      }
    }
  }

  if (drawMarks) {
    // 照明を置かないと決まったマスは点。未確定との差を出すため
    for (const [x, y] of r.empties) {
      svg.append(svgEl("circle", {
        cx: x * CELL + CELL / 2, cy: y * CELL + CELL / 2, r: 2, fill: "#c3bda9",
      }));
    }
    for (const [x, y] of r.lamps) {
      svg.append(svgEl("circle", {
        cx: x * CELL + CELL / 2, cy: y * CELL + CELL / 2,
        r: CELL * 0.3, fill: "#f0b429", stroke: "#8a5a00", "stroke-width": 1.2,
      }));
    }
  }

  for (let i = 0; i <= r.cols; i++) {
    svg.append(svgEl("line", { x1: i * CELL, y1: 0, x2: i * CELL, y2: h, stroke: "#aaa", "stroke-width": i === 0 || i === r.cols ? 2.5 : 1 }));
  }
  for (let i = 0; i <= r.rows; i++) {
    svg.append(svgEl("line", { x1: 0, y1: i * CELL, x2: w, y2: i * CELL, stroke: "#aaa", "stroke-width": i === 0 || i === r.rows ? 2.5 : 1 }));
  }
  return svg;
}

function masyuSVG(r, svgEl) {
  const w = r.cols * CELL;
  const h = r.rows * CELL;
  const svg = svgEl("svg", { viewBox: `-2 -2 ${w + 4} ${h + 4}`, width: Math.min(w, 480) });
  svg.append(svgEl("rect", { x: 0, y: 0, width: w, height: h, fill: "#fff" }));

  // 解なし・複数解のときは途中の確定マークを描かない(誤解のもとになる)
  const drawMarks = r.solutions === "1" || r.solutions === "?";
  if (drawMarks) {
    const lineAttr = { stroke: "#2456d6", "stroke-width": 4, "stroke-linecap": "round" };
    for (const [x, y] of r.hlines) {
      svg.append(svgEl("line", { ...lineAttr,
        x1: x * CELL + CELL / 2, y1: y * CELL + CELL / 2,
        x2: (x + 1) * CELL + CELL / 2, y2: y * CELL + CELL / 2 }));
    }
    for (const [x, y] of r.vlines) {
      svg.append(svgEl("line", { ...lineAttr,
        x1: x * CELL + CELL / 2, y1: y * CELL + CELL / 2,
        x2: x * CELL + CELL / 2, y2: (y + 1) * CELL + CELL / 2 }));
    }
  }
  for (const [x, y] of r.whites) {
    svg.append(svgEl("circle", {
      cx: x * CELL + CELL / 2, cy: y * CELL + CELL / 2, r: CELL * 0.32,
      fill: "#fff", stroke: "#111", "stroke-width": 2,
    }));
  }
  for (const [x, y] of r.blacks) {
    svg.append(svgEl("circle", {
      cx: x * CELL + CELL / 2, cy: y * CELL + CELL / 2, r: CELL * 0.32,
      fill: "#26262e",
    }));
  }
  for (let i = 0; i <= r.cols; i++) {
    svg.append(svgEl("line", { x1: i * CELL, y1: 0, x2: i * CELL, y2: h, stroke: "#aaa", "stroke-width": i === 0 || i === r.cols ? 2.5 : 1 }));
  }
  for (let i = 0; i <= r.rows; i++) {
    svg.append(svgEl("line", { x1: 0, y1: i * CELL, x2: w, y2: i * CELL, stroke: "#aaa", "stroke-width": i === 0 || i === r.rows ? 2.5 : 1 }));
  }
  return svg;
}
