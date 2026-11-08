// Port of find_another_answer in cspuz_solver_backend (puzzle/numlin.rs, MIT, Copyright (c) semiexp).
// The engines count canonical solutions (trivial detours are forbidden in the model), so a unique
// canonical answer may still allow another answer that reroutes one path through free cells.
const directions = [[1,0,-1], [2,1,0], [4,0,1], [8,-1,0]];

// Returns the cells of an alternative route [from, ..., to] for one path, or null.
export function findDetour({ width:w, height:h, links }) {
  const n = w*h, pathId = new Int32Array(n).fill(-1);
  let next = 0;
  for (let c = 0; c < n; c++) {
    if (pathId[c] !== -1 || !links[c]) continue;
    const stack = [c]; pathId[c] = next;
    while (stack.length) {
      const at = stack.pop();
      for (const [bit,dx,dy] of directions) {
        if (!(links[at]&bit)) continue;
        const to = at+dy*w+dx;
        if (pathId[to] === -1) { pathId[to] = next; stack.push(to); }
      }
    }
    next++;
  }
  const pre = new Int32Array(n);
  const seen = new Uint8Array(n);
  for (let start = 0; start < n; start++) {
    const id = pathId[start];
    if (id === -1) continue;
    seen.fill(0); seen[start] = 1;
    const queue = [start];
    for (let q = 0; q < queue.length; q++) {
      const at = queue[q], x = at%w, y = (at-x)/w;
      for (const [bit,dx,dy] of directions) {
        const nx = x+dx, ny = y+dy;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        const to = ny*w+nx;
        if (seen[to] || (pathId[to] !== -1 && pathId[to] !== id) || (links[at]&bit)) continue;
        seen[to] = 1; pre[to] = at; queue.push(to);
        if (pathId[to] === id) {
          const route = [to];
          for (let c = to; c !== start; c = pre[c]) route.push(pre[c]);
          return route.reverse();
        }
      }
    }
  }
  return null;
}

// Sanity check used by tests: the route connects two cells of one path through free cells only.
export function isValidDetour({ width:w, links }, route) {
  if (!route || route.length < 2) return false;
  for (let i = 1; i < route.length; i++) {
    const d = route[i]-route[i-1];
    const bit = d === -w ? 1 : d === 1 ? 2 : d === w ? 4 : d === -1 ? 8 : 0;
    if (!bit || (links[route[i-1]]&bit) || (bit === 2 || bit === 8) && Math.floor(route[i]/w) !== Math.floor(route[i-1]/w)) return false;
    if (i < route.length-1 && links[route[i]]) return false;
  }
  return !!links[route[0]] && !!links[route.at(-1)];
}
