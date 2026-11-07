/*
 * Adapted from semiexp/puzzle-webapp packages/puzzle-board
 * (MIT, Copyright (c) 2025 semiexp).
 * Includes portions adapted from cspuz-solver2/packages/puzzle-board
 * (MIT, Copyright (c) 2022 semiexp).
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

export function cspuzBoardSVG(board, { doc = document, labels = {}, example } = {}) {
  const validBoard = value => value?.kind === "grid" &&
    [value.height, value.width].every(n => Number.isInteger(n) && n > 0) &&
    Array.isArray(value.data) && value.data.every(elem => elem && Number.isFinite(elem.y) && Number.isFinite(elem.x));
  if (!validBoard(board)) return null;
  if (example && (!validBoard(example) || example.height !== board.height || example.width !== board.width)) return null;
  const el = (tag, attrs, ...children) => {
    const node = doc.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, value] of Object.entries(attrs ?? {})) {
      node.setAttribute(key === "viewBox" ? key : key.replace(/[A-Z]/g, c => "-" + c.toLowerCase()), value);
    }
    for (const child of children.flat(Infinity)) {
      if (child != null && child !== false) node.append(typeof child === "object" ? child : doc.createTextNode(String(child)));
    }
    return node;
  };
  function renderItem(env, y, x, color, item) {
      if (typeof item !== "string" && (!item || typeof item !== "object")) return null;
      if (typeof item === "string" && /^firefly(Up|Down|Left|Right)$/.test(item)) {
          item = { kind: "firefly", dot: item.slice(7).toLowerCase(), value: -1 };
      }
      // Remainders of negative odd coordinates are -1, so use parity bits.
      const isVertex = ((y & 1) === 0 && (x & 1) === 0);
      const isCell = ((y & 1) === 1 && (x & 1) === 1);
      const isEdge = !(isVertex || isCell);
      const unitSize = isVertex ? (env.unitSize * 0.7) : env.unitSize;
      if (typeof item !== "string" && item.kind === "lineTo") {
          const y1 = env.offsetY + env.unitSize * (y / 2);
          const x1 = env.offsetX + env.unitSize * (x / 2);
          const y2 = env.offsetY + env.unitSize * (item.destY / 2);
          const x2 = env.offsetX + env.unitSize * (item.destX / 2);
          return el("line", { x1: x1, y1: y1, x2: x2, y2: y2, strokeWidth: 2, stroke: color });
      }
      if (isVertex || isCell) {
          const centerY = env.offsetY + env.unitSize * (y / 2);
          const centerX = env.offsetX + env.unitSize * (x / 2);
          if (item === "dot") {
              return el("rect", { x: centerX - unitSize * 0.1, y: centerY - unitSize * 0.1, width: unitSize * 0.2, height: unitSize * 0.2, fill: color });
          }
          else if (item === "block") {
              return el("rect", { x: centerX - unitSize * 0.4, y: centerY - unitSize * 0.4, width: unitSize * 0.8, height: unitSize * 0.8, fill: color });
          }
          else if (item === "square") {
              return el("rect", { x: centerX - unitSize * 0.3, y: centerY - unitSize * 0.3, width: unitSize * 0.6, height: unitSize * 0.6, stroke: color, fill: "none" });
          }
          else if (item === "triangle") {
              let shape = [
                  [0.2, 0.8],
                  [0.5, 0.2],
                  [0.8, 0.8],
              ];
              let points = [];
              for (let i = 0; i < shape.length; ++i) {
                  let dx = shape[i][0];
                  let dy = shape[i][1];
                  dx = centerX + unitSize * (dx - 0.5);
                  dy = centerY + unitSize * (dy - 0.5);
                  points.push(String(dx) + "," + String(dy));
              }
              return el("polygon", { points: points.join(" "), stroke: color, fill: "none" });
          }
          else if (item === "fill") {
              return el("rect", { x: centerX - unitSize * 0.5, y: centerY - unitSize * 0.5, width: unitSize, height: unitSize, fill: color });
          }
          else if (item === "sideArrowUp" || item === "sideArrowDown" || item === "sideArrowLeft" || item === "sideArrowRight" || item === "arrowUp" || item === "arrowDown" || item === "arrowLeft" || item === "arrowRight") {
              let shape = [
                  [0.1, 0.1],
                  [0.5, 0.1],
                  [0.5, 0.05],
                  [0.9, 0.125],
                  [0.5, 0.2],
                  [0.5, 0.15],
                  [0.1, 0.15]
              ];
              let points = [];
              for (let i = 0; i < shape.length; ++i) {
                  let dx = shape[i][0];
                  let dy = shape[i][1];
                  if (item.startsWith("arrow")) {
                      dy *= 4;
                  }
                  if (item === "sideArrowLeft" || item === "sideArrowUp" || item === "arrowLeft" || item === "arrowUp") {
                      dx = 1 - dx;
                  }
                  if (item === "sideArrowUp" || item === "sideArrowDown" || item === "arrowUp" || item === "arrowDown") {
                      let tmp = dx;
                      dx = dy;
                      dy = tmp;
                  }
                  dx = centerX + unitSize * (dx - 0.5);
                  dy = centerY + unitSize * (dy - 0.5);
                  points.push(String(dx) + "," + String(dy));
              }
              return el("polygon", { points: points.join(" "), stroke: "none", fill: color });
          }
          else if (item === "aboloUpperLeft") {
              return el("polygon", { points: aboloPoints(centerY, centerX, unitSize, 2), stroke: "none", fill: color });
          }
          else if (item === "aboloUpperRight") {
              return el("polygon", { points: aboloPoints(centerY, centerX, unitSize, 1), stroke: "none", fill: color });
          }
          else if (item === "aboloLowerLeft") {
              return el("polygon", { points: aboloPoints(centerY, centerX, unitSize, 3), stroke: "none", fill: color });
          }
          else if (item === "aboloLowerRight") {
              return el("polygon", { points: aboloPoints(centerY, centerX, unitSize, 0), stroke: "none", fill: color });
          }
          else if (item === "pencilLeft") {
              return pencilElement(centerY, centerX, unitSize, 3, color);
          }
          else if (item === "pencilRight") {
              return pencilElement(centerY, centerX, unitSize, 1, color);
          }
          else if (item === "pencilUp") {
              return pencilElement(centerY, centerX, unitSize, 0, color);
          }
          else if (item === "pencilDown") {
              return pencilElement(centerY, centerX, unitSize, 2, color);
          }
          else if (item === "circle") {
              return el("circle", { cx: centerX, cy: centerY, r: unitSize * 0.4, stroke: color, fill: "none" });
          }
          else if (item === "filledCircle") {
              return el("circle", { cx: centerX, cy: centerY, r: unitSize * 0.4, stroke: color, fill: color });
          }
          else if (item === "dottedHorizontalWall") {
              return el("line", { x1: centerX - unitSize / 2, x2: centerX + unitSize / 2, y1: centerY, y2: centerY, strokeWidth: 2, stroke: color, strokeDasharray: "4 2" });
          }
          else if (item === "dottedVerticalWall") {
              return el("line", { x1: centerX, x2: centerX, y1: centerY - unitSize / 2, y2: centerY + unitSize / 2, strokeWidth: 2, stroke: color, strokeDasharray: "4 2" });
          }
          else if (item === "slash") {
              return el("line", { x1: centerX + unitSize / 2, x2: centerX - unitSize / 2, y1: centerY - unitSize / 2, y2: centerY + unitSize / 2, strokeWidth: 1, stroke: color });
          }
          else if (item === "backslash") {
              return el("line", { x1: centerX - unitSize / 2, x2: centerX + unitSize / 2, y1: centerY - unitSize / 2, y2: centerY + unitSize / 2, strokeWidth: 1, stroke: color });
          }
          else if (item === "dottedSlash") {
              return el("line", { x1: centerX + unitSize / 2, x2: centerX - unitSize / 2, y1: centerY - unitSize / 2, y2: centerY + unitSize / 2, strokeWidth: 1, stroke: color, strokeDasharray: "4 2" });
          }
          else if (item === "dottedBackslash") {
              return el("line", { x1: centerX - unitSize / 2, x2: centerX + unitSize / 2, y1: centerY - unitSize / 2, y2: centerY + unitSize / 2, strokeWidth: 1, stroke: color, strokeDasharray: "4 2" });
          }
          else if (item === "plus") {
              return el("g", null,
                  el("line", { x1: centerX - unitSize * 0.4, x2: centerX + unitSize * 0.4, y1: centerY, y2: centerY, strokeWidth: 4, stroke: color }),
                  el("line", { x1: centerX, x2: centerX, y1: centerY - unitSize * 0.4, y2: centerY + unitSize * 0.4, strokeWidth: 4, stroke: color }));
          }
          else if (item === "smallCircle") {
              return el("circle", { cx: centerX, cy: centerY, r: env.unitSize * 0.1, stroke: color, fill: "none" });
          }
          else if (item === "smallFilledCircle") {
              return el("circle", { cx: centerX, cy: centerY, r: env.unitSize * 0.1, stroke: color, fill: color });
          }
          else if (item === "middleFilledCircle") {
              return el("circle", { cx: centerX, cy: centerY, r: env.unitSize * 0.2, stroke: color, fill: color });
          }
          else if (typeof item === "string" && /^firewalkCell(Unknown|Ul|Ur|Dl|Dr|UlDr|UrDl)$/.test(item)) {
              let items = [];
              items.push(el("polygon", { points: `${centerX - unitSize / 4},${centerY} ${centerX},${centerY - unitSize / 4} ${centerX + unitSize / 4},${centerY} ${centerX},${centerY + unitSize / 4}`, fill: "#ffe0e0" }));
              if (item === "firewalkCellUl" || item === "firewalkCellUlDr") {
                  items.push(el("line", { x1: centerX - unitSize / 4, x2: centerX, y1: centerY, y2: centerY - unitSize / 4, strokeWidth: 2, stroke: color }));
              }
              if (item === "firewalkCellUr" || item === "firewalkCellUrDl") {
                  items.push(el("line", { x1: centerX + unitSize / 4, x2: centerX, y1: centerY, y2: centerY - unitSize / 4, strokeWidth: 2, stroke: color }));
              }
              if (item === "firewalkCellDl" || item === "firewalkCellUrDl") {
                  items.push(el("line", { x1: centerX - unitSize / 4, x2: centerX, y1: centerY, y2: centerY + unitSize / 4, strokeWidth: 2, stroke: color }));
              }
              if (item === "firewalkCellDr" || item === "firewalkCellUlDr") {
                  items.push(el("line", { x1: centerX + unitSize / 4, x2: centerX, y1: centerY, y2: centerY + unitSize / 4, strokeWidth: 2, stroke: color }));
              }
              return el("g", null, items);
          }
          else if (typeof item === "string") {
              return null;
          }
          else if ("kind" in item) {
              if (item.kind === "text") {
                  return renderTextItem(centerY, centerX, unitSize, color, item);
              }
              else if (item.kind === "compass") {
                  return el("g", null,
                      el("line", { x1: centerX - unitSize / 2, x2: centerX + unitSize / 2, y1: centerY - unitSize / 2, y2: centerY + unitSize / 2, strokeWidth: 1, stroke: color }),
                      el("line", { x1: centerX - unitSize / 2, x2: centerX + unitSize / 2, y1: centerY + unitSize / 2, y2: centerY - unitSize / 2, strokeWidth: 1, stroke: color }),
                      item.up >= 0 && el("text", { x: centerX, y: centerY - unitSize * 0.3, dominantBaseline: "central", textAnchor: "middle", fontSize: unitSize * 0.4, fill: color }, item.up),
                      item.down >= 0 && el("text", { x: centerX, y: centerY + unitSize * 0.3, dominantBaseline: "central", textAnchor: "middle", fontSize: unitSize * 0.4, fill: color }, item.down),
                      item.left >= 0 && el("text", { x: centerX - unitSize * 0.3, y: centerY, dominantBaseline: "central", textAnchor: "middle", fontSize: unitSize * 0.4, fill: color }, item.left),
                      item.right >= 0 && el("text", { x: centerX + unitSize * 0.3, y: centerY, dominantBaseline: "central", textAnchor: "middle", fontSize: unitSize * 0.4, fill: color }, item.right));
              }
              else if (item.kind === "tapaClue") {
                  let values = [];
                  for (let i = 0; i < item.value.length; ++i) {
                      if (item.value[i] === -2) {
                          values.push("?");
                      }
                      else if (item.value[i] !== -1) {
                          values.push(item.value[i] + "");
                      }
                  }
                  if (values.length === 1) {
                      return el("text", { x: centerX, y: centerY, dominantBaseline: "central", textAnchor: "middle", fontSize: unitSize * 0.8, fill: color }, values[0]);
                  }
                  else if (values.length === 2) {
                      return el("g", null,
                          el("text", { x: centerX - unitSize * 0.2, y: centerY - unitSize * 0.2, dominantBaseline: "central", textAnchor: "middle", fontSize: unitSize * 0.6, fill: color }, values[0]),
                          el("text", { x: centerX + unitSize * 0.2, y: centerY + unitSize * 0.2, dominantBaseline: "central", textAnchor: "middle", fontSize: unitSize * 0.6, fill: color }, values[1]));
                  }
                  else if (values.length === 3) {
                      return el("g", null,
                          el("text", { x: centerX - unitSize * 0.3, y: centerY - unitSize * 0.2, dominantBaseline: "central", textAnchor: "middle", fontSize: unitSize * 0.6, fill: color }, values[0]),
                          el("text", { x: centerX + unitSize * 0.3, y: centerY - unitSize * 0.2, dominantBaseline: "central", textAnchor: "middle", fontSize: unitSize * 0.6, fill: color }, values[1]),
                          el("text", { x: centerX, y: centerY + unitSize * 0.2, dominantBaseline: "central", textAnchor: "middle", fontSize: unitSize * 0.6, fill: color }, values[2]));
                  }
                  else if (values.length === 4) {
                      return el("g", null,
                          el("text", { x: centerX - unitSize * 0.3, y: centerY, dominantBaseline: "central", textAnchor: "middle", fontSize: unitSize * 0.6, fill: color }, values[0]),
                          el("text", { x: centerX, y: centerY - unitSize * 0.25, dominantBaseline: "central", textAnchor: "middle", fontSize: unitSize * 0.6, fill: color }, values[1]),
                          el("text", { x: centerX, y: centerY + unitSize * 0.25, dominantBaseline: "central", textAnchor: "middle", fontSize: unitSize * 0.6, fill: color }, values[2]),
                          el("text", { x: centerX + unitSize * 0.3, y: centerY, dominantBaseline: "central", textAnchor: "middle", fontSize: unitSize * 0.6, fill: color }, values[3]));
                  }
              }
              else if (item.kind === "sudokuCandidateSet" || item.kind === "sudokuForbiddenCandidateMarker") {
                  let items = [];
                  for (let i = 0; i < item.values.length; ++i) {
                      const n = item.values[i];
                      const gx = (n - 1) % item.size;
                      const gy = Math.floor((n - 1) / item.size);
                      const x = centerX - unitSize / 2 + (gx + 0.5) / item.size * unitSize;
                      const y = centerY - unitSize / 2 + (gy + 0.5) / item.size * unitSize;
                      const forbidden = item.kind === "sudokuForbiddenCandidateMarker";
                      items.push(el("text", { x: x, y: y, dominantBaseline: "central", textAnchor: "middle", fontSize: unitSize / item.size * (forbidden ? 0.9 : 1), fill: color }, n));
                      if (forbidden) {
                          const crossSize = unitSize / item.size * 0.3;
                          items.push(el("line", { x1: x - crossSize, y1: y - crossSize, x2: x + crossSize, y2: y + crossSize, stroke: "red", strokeWidth: 1 }));
                          items.push(el("line", { x1: x + crossSize, y1: y - crossSize, x2: x - crossSize, y2: y + crossSize, stroke: "red", strokeWidth: 1 }));
                      }
                  }
                  return el("g", null, items);
              }
              else if (item.kind === "firefly") {
                  let x = centerX, y = centerY;
                  if (item.dot === "up") {
                      y -= unitSize * 0.6;
                  }
                  else if (item.dot === "down") {
                      y += unitSize * 0.6;
                  }
                  else if (item.dot === "left") {
                      x -= unitSize * 0.6;
                  }
                  else if (item.dot === "right") {
                      x += unitSize * 0.6;
                  }
                  return el("g", null,
                      el("circle", { cx: centerX, cy: centerY, r: unitSize * 0.6, stroke: color, fill: "white" }),
                      el("circle", { cx: x, cy: y, r: unitSize * 0.2, stroke: color, fill: color }),
                      item.value >= 0 &&
                          el("text", { x: centerX, y: centerY, dominantBaseline: "central", textAnchor: "middle", fontSize: unitSize, fill: color }, item.value));
              }
              else if (item.kind === "thermo" || item.kind === "arrow") {
                  return renderPathItem(env, centerY, centerX, unitSize, color, item);
              }
              else if (item.kind === "regionBorder") {
                  return renderRegionBorderItem(env, unitSize, color, item);
              }
          }
          return null;
      }
      else if (isEdge) {
          const centerY = env.offsetY + unitSize * (y / 2);
          const centerX = env.offsetX + unitSize * (x / 2);
          if (item === "line") {
              if (y % 2 === 1) {
                  return el("line", { x1: centerX - unitSize / 2, x2: centerX + unitSize / 2, y1: centerY, y2: centerY, strokeWidth: 2, stroke: color });
              }
              else {
                  return el("line", { x1: centerX, x2: centerX, y1: centerY - unitSize / 2, y2: centerY + unitSize / 2, strokeWidth: 2, stroke: color });
              }
          }
          else if (item === "dottedLine") {
              if (y % 2 === 1) {
                  return el("line", { x1: centerX - unitSize / 2, x2: centerX + unitSize / 2, y1: centerY, y2: centerY, strokeWidth: 2, stroke: color, strokeDasharray: "4 2" });
              }
              else {
                  return el("line", { x1: centerX, x2: centerX, y1: centerY - unitSize / 2, y2: centerY + unitSize / 2, strokeWidth: 2, stroke: color, strokeDasharray: "4 2" });
              }
          }
          else if (item === "doubleLine") {
              if (y % 2 === 1) {
                  return el("g", null,
                      el("line", { x1: centerX - unitSize / 2, x2: centerX + unitSize / 2, y1: centerY - unitSize / 10, y2: centerY - unitSize / 10, strokeWidth: 2, stroke: color }),
                      el("line", { x1: centerX - unitSize / 2, x2: centerX + unitSize / 2, y1: centerY + unitSize / 10, y2: centerY + unitSize / 10, strokeWidth: 2, stroke: color }));
              }
              else {
                  return el("g", null,
                      el("line", { x1: centerX - unitSize / 10, x2: centerX - unitSize / 10, y1: centerY - unitSize / 2, y2: centerY + unitSize / 2, strokeWidth: 2, stroke: color }),
                      el("line", { x1: centerX + unitSize / 10, x2: centerX + unitSize / 10, y1: centerY - unitSize / 2, y2: centerY + unitSize / 2, strokeWidth: 2, stroke: color }));
              }
          }
          else if (item === "cross") {
              const crossSize = unitSize * 0.1;
              return el("g", null,
                  el("line", { x1: centerX - crossSize, x2: centerX + crossSize, y1: centerY - crossSize, y2: centerY + crossSize, strokeWidth: 1, stroke: color }),
                  el("line", { x1: centerX + crossSize, x2: centerX - crossSize, y1: centerY - crossSize, y2: centerY + crossSize, strokeWidth: 1, stroke: color }));
          }
          else if (item === "wall" || item === "boldWall") {
              const strokeWidth = (item === "boldWall" ? 2 : 1);
              if (y % 2 === 0) {
                  return el("line", { x1: centerX - unitSize / 2, x2: centerX + unitSize / 2, y1: centerY, y2: centerY, strokeWidth: strokeWidth, stroke: color });
              }
              else {
                  return el("line", { x1: centerX, x2: centerX, y1: centerY - unitSize / 2, y2: centerY + unitSize / 2, strokeWidth: strokeWidth, stroke: color });
              }
          }
          else if (item === "dottedWall") {
              if (y % 2 === 0) {
                  return el("line", { x1: centerX - unitSize / 2, x2: centerX + unitSize / 2, y1: centerY, y2: centerY, strokeWidth: 1, stroke: color, strokeDasharray: "4 2" });
              }
              else {
                  return el("line", { x1: centerX, x2: centerX, y1: centerY - unitSize / 2, y2: centerY + unitSize / 2, strokeWidth: 1, stroke: color, strokeDasharray: "4 2" });
              }
          }
          else if (item === "smallCircle") {
              return el("circle", { cx: centerX, cy: centerY, r: unitSize * 0.1, stroke: color, fill: "none" });
          }
          else if (item === "smallFilledCircle") {
              return el("circle", { cx: centerX, cy: centerY, r: unitSize * 0.1, stroke: color, fill: color });
          }
          else if (item === "middleFilledCircle") {
              return el("circle", { cx: centerX, cy: centerY, r: unitSize * 0.2, stroke: color, fill: color });
          }
          else if (item === "circle" || item === "filledCircle") {
              return el("circle", { cx: centerX, cy: centerY, r: unitSize * 0.4, stroke: color, fill: item === "circle" ? "none" : color });
          }
          else if (item === "bar") {
              const horizontal = y % 2 === 0;
              return el("rect", {
                  x: centerX - unitSize * (horizontal ? 0.3 : 0.1),
                  y: centerY - unitSize * (horizontal ? 0.1 : 0.3),
                  width: unitSize * (horizontal ? 0.6 : 0.2),
                  height: unitSize * (horizontal ? 0.2 : 0.6),
                  fill: color, stroke: "black", strokeWidth: 1,
              });
          }
          else if (typeof item !== "string" && item.kind === "text") {
              return renderTextItem(centerY, centerX, unitSize, color, item);
          }
          return null;
      }
      return null;
  }
  function renderTextItem(centerY, centerX, unitSize, color, item) {
      const sizeMultiplier = item.size !== undefined ? item.size : 1;
      const positions = { upperLeft: [-0.25, -0.25], upperRight: [-0.25, 0.25], lowerLeft: [0.25, -0.25], lowerRight: [0.25, 0.25] };
      const [yRatio, xRatio] = Object.hasOwn(positions, item.pos) ? positions[item.pos] : [0, 0];
      return el("text", {
          x: centerX + unitSize * xRatio, y: centerY + unitSize * yRatio,
          dominantBaseline: "central", textAnchor: "middle",
          fontSize: unitSize * (item.pos ? 0.5 : 0.8) * sizeMultiplier, fill: color,
      }, item.data);
  }
  function renderPathItem(env, centerY, centerX, unitSize, color, item) {
      const arrow = item.kind === "arrow";
      const elements = [el("circle", {
          cx: centerX, cy: centerY, r: unitSize * (arrow ? 0.4 : 0.38),
          stroke: color, fill: arrow ? "none" : color, strokeWidth: 3,
      })];
      let prevY = centerY, prevX = centerX;
      for (let i = 0; i < item.cells.length; ++i) {
          const cell = item.cells[i];
          const cellY = env.offsetY + unitSize * (cell.y / 2);
          const cellX = env.offsetX + unitSize * (cell.x / 2);
          let startY = prevY, startX = prevX;
          if (arrow && i === 0) {
              const d = Math.hypot(cellY - prevY, cellX - prevX);
              if (d > 0) {
                  startY += (cellY - prevY) / d * unitSize * 0.4;
                  startX += (cellX - prevX) / d * unitSize * 0.4;
              }
          }
          elements.push(el("line", {
              x1: startX, y1: startY, x2: cellX, y2: cellY,
              stroke: color, strokeWidth: arrow ? 3 : unitSize * 0.25, strokeLinecap: "round",
          }));
          prevY = cellY;
          prevX = cellX;
      }
      if (arrow && item.cells.length >= 1) {
          let fromY = centerY, fromX = centerX;
          if (item.cells.length >= 2) {
              const cell = item.cells[item.cells.length - 2];
              fromY = env.offsetY + unitSize * (cell.y / 2);
              fromX = env.offsetX + unitSize * (cell.x / 2);
          }
          const d = Math.hypot(prevY - fromY, prevX - fromX);
          const dy = d > 0 ? (prevY - fromY) / d : 0;
          const dx = d > 0 ? (prevX - fromX) / d : 0;
          const scale = 0.4 * Math.sqrt(0.5);
          elements.push(el("line", {
              x1: prevX, y1: prevY,
              x2: prevX - dx * unitSize * scale + dy * unitSize * scale,
              y2: prevY - dy * unitSize * scale - dx * unitSize * scale,
              stroke: color, strokeWidth: 3, strokeLinecap: "round",
          }));
          elements.push(el("line", {
              x1: prevX, y1: prevY,
              x2: prevX - dx * unitSize * scale - dy * unitSize * scale,
              y2: prevY - dy * unitSize * scale + dx * unitSize * scale,
              stroke: color, strokeWidth: 3, strokeLinecap: "round",
          }));
      }
      return el("g", null, elements);
  }
  function renderRegionBorderItem(env, unitSize, color, item) {
      const elements = [];
      const neighbors = [{ y: -2, x: 0 }, { y: 2, x: 0 }, { y: 0, x: -2 }, { y: 0, x: 2 }];
      for (const cell of item.cells) {
          for (const neighbor of neighbors) {
              if (item.cells.some(c => c.y === cell.y + neighbor.y && c.x === cell.x + neighbor.x)) continue;
              const centerY = env.offsetY + unitSize * (cell.y / 2);
              const centerX = env.offsetX + unitSize * (cell.x / 2);
              const midY = centerY + (neighbor.y / 2) * unitSize * 0.4;
              const midX = centerX + (neighbor.x / 2) * unitSize * 0.4;
              elements.push(el("line", {
                  x1: midX + (neighbor.y / 2) * 0.4 * unitSize,
                  y1: midY + (neighbor.x / 2) * 0.4 * unitSize,
                  x2: midX - (neighbor.y / 2) * 0.4 * unitSize,
                  y2: midY - (neighbor.x / 2) * 0.4 * unitSize,
                  stroke: color, strokeWidth: 1,
                  strokeDasharray: `${unitSize * 0.8 / 6},${unitSize * 0.8 / 9}`,
              }));
          }
      }
      return el("g", null, elements);
  }
  function aboloPoints(centerY, centerX, unitSize, skip) {
      let ret = [];
      if (skip !== 0) {
          ret.push(`${centerX - unitSize / 2},${centerY - unitSize / 2}`);
      }
      if (skip !== 1) {
          ret.push(`${centerX - unitSize / 2},${centerY + unitSize / 2}`);
      }
      if (skip !== 2) {
          ret.push(`${centerX + unitSize / 2},${centerY + unitSize / 2}`);
      }
      if (skip !== 3) {
          ret.push(`${centerX + unitSize / 2},${centerY - unitSize / 2}`);
      }
      return ret.join(" ");
  }
  function pencilPoints(centerY, centerX, unitSize, start) {
      let ret = [`${centerX},${centerY}`];
      if (start === 3 || start === 0) {
          ret.push(`${centerX - unitSize / 2},${centerY - unitSize / 2}`);
      }
      if (start === 0 || start === 1) {
          ret.push(`${centerX + unitSize / 2},${centerY - unitSize / 2}`);
      }
      if (start === 1 || start === 2) {
          ret.push(`${centerX + unitSize / 2},${centerY + unitSize / 2}`);
      }
      if (start === 2 || start === 3) {
          ret.push(`${centerX - unitSize / 2},${centerY + unitSize / 2}`);
      }
      return ret.join(" ");
  }
  function pencilElement(centerY, centerX, unitSize, start, color) {
      return el("g", null,
          el("polygon", { points: pencilPoints(centerY, centerX, unitSize, start), stroke: color, fill: "none" }),
          el("polygon", { points: pencilPoints(centerY, centerX, unitSize * 0.5, start), stroke: "none", fill: color }));
  }
  function renderBoard(boards) {
      const margin = 30;
      const unitSize = 30;
      const env = {
          offsetY: margin,
          offsetX: margin,
          unitSize,
      };
      const components = [];
      let heightMax = 0;
      let widthMax = 0;
      for (const board of boards) {
          for (let i = 0; i < board.data.length; ++i) {
              const elem = board.data[i];
              components.push(renderItem(env, elem.y, elem.x, elem.color, elem.item));
          }
          const height = board.height;
          const width = board.width;
          heightMax = Math.max(heightMax, height);
          widthMax = Math.max(widthMax, width);
          if (board.defaultStyle === "outer_grid") {
              components.push(el("line", { x1: margin, x2: margin + width * unitSize, y1: margin, y2: margin, strokeWidth: 2, stroke: "black" }));
              components.push(el("line", { x1: margin, x2: margin + width * unitSize, y1: margin + height * unitSize, y2: margin + height * unitSize, strokeWidth: 2, stroke: "black" }));
              components.push(el("line", { x1: margin, x2: margin, y1: margin, y2: margin + height * unitSize, strokeWidth: 2, stroke: "black" }));
              components.push(el("line", { x1: margin + width * unitSize, x2: margin + width * unitSize, y1: margin, y2: margin + height * unitSize, strokeWidth: 2, stroke: "black" }));
          }
          else if (board.defaultStyle === "grid") {
              for (let y = 0; y <= height; ++y) {
                  const lineWidth = (y === 0 || y === height) ? 2 : 1;
                  components.push(el("line", { x1: margin, x2: margin + width * unitSize, y1: margin + y * unitSize, y2: margin + y * unitSize, strokeWidth: lineWidth, stroke: "black" }));
              }
              for (let x = 0; x <= width; ++x) {
                  const lineWidth = (x === 0 || x === width) ? 2 : 1;
                  components.push(el("line", { x1: margin + x * unitSize, x2: margin + x * unitSize, y1: margin, y2: margin + height * unitSize, strokeWidth: lineWidth, stroke: "black" }));
              }
          }
          else if (board.defaultStyle === "dots") {
              const dotSizeHalf = unitSize / 10;
              for (let y = 0; y <= height; ++y) {
                  for (let x = 0; x <= width; ++x) {
                      const centerY = env.offsetY + unitSize * y;
                      const centerX = env.offsetX + unitSize * x;
                      components.push(el("rect", { x: centerX - dotSizeHalf, y: centerY - dotSizeHalf, height: dotSizeHalf * 2, width: dotSizeHalf * 2, fill: "black" }));
                  }
              }
          }
      }
      const svgHeight = heightMax * unitSize + margin * 2;
      const svgWidth = widthMax * unitSize + margin * 2;
      return el("svg", { height: svgHeight, width: svgWidth, viewBox: `0 0 ${svgWidth} ${svgHeight}`, role: "img", "aria-label": board.hasAnswer === false ? labels.problem ?? "Problem" : labels.answer ?? "Answer", fontFamily: "sans-serif", fontSize: 16, fontWeight: 400, fill: "black", stroke: "none" },
          el("rect", { x: 0, y: 0, width: svgWidth, height: svgHeight, fill: "#fff" }),
          el("g", null, components));
  }

  // Enumerated answers contain only differences; common clues must be layered on top.
  return renderBoard(example ? [example, board] : [board]);
}
