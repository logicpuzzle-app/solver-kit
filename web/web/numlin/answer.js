// Shared original-orientation representation for both engines.
export function decodePuzzle(url) {
  const encoded = url.startsWith('p?numlin/') ? url.slice(9) : url.split('/p?numlin/')[1];
  if (!encoded) throw Error('expected a puzz.link numlin URL or p?numlin/... path');
  const fields = encoded.split('/');
  if (fields.length !== 3) throw Error('expected width/height/hints');
  const [w, h, hints] = fields;
  const width = Number(w), height = Number(h);
  if (!/^\d+$/.test(w) || !/^\d+$/.test(h) || width < 1 || height < 1 || width > 256 || height > 256) throw Error('dimensions must be 1..256');
  const clues = [];
  for (let i = 0; i < hints.length; i++) {
    const c = hints[i];
    if (c >= 'g' && c <= 'z') clues.push(...Array(c.charCodeAt(0)-102).fill(0));
    else if (c === '-' || c === '+') {
      const n = c === '-' ? 2 : 3, digits = hints.slice(i+1, i+1+n);
      if (digits.length !== n || !/^[0-9a-f]+$/i.test(digits) || parseInt(digits,16) < 16) throw Error('malformed extended clue');
      clues.push(parseInt(digits,16)); i += n;
    } else {
      if (!/^[1-9a-f]$/.test(c)) throw Error('invalid hint character');
      clues.push(parseInt(c,16));
    }
    if (clues.length > width*height) throw Error('hints exceed board');
  }
  if (clues.length !== width*height) throw Error('hints do not fill board');
  const counts = new Map();
  for (const n of clues) if (n) counts.set(n, (counts.get(n) || 0)+1);
  if (!counts.size || [...counts.values()].some(n => n !== 2)) throw Error('each clue must occur exactly twice');
  return {width, height, clues};
}

export function answerText(answer, clues) {
  const glyphs = [' ', '│', '─', '└', '│', '│', '┌', '├', '─', '┘', '─', '┴', '┐', '┤', '┬', '┼'];
  const size = String(Math.max(...clues)).length;
  return Array.from({length:answer.height}, (_, y) => Array.from({length:answer.width}, (_, x) => {
    const c = y*answer.width+x;
    return String(clues[c] || glyphs[answer.links[c]]).padStart(size);
  }).join(' ')).join('\n');
}

const palette = ['#3b82c4', '#c1642b', '#269076', '#ac60b4', '#be526d', '#7c79cd', '#a37c22', '#2895a1', '#93823c', '#a3678f', '#67934b', '#778caa'];
const directions = [[1,0,-1], [2,1,0], [4,0,1], [8,-1,0]];
export function answerSVG(answer, clues, label = 'Answer', { doc = document } = {}) {
  const {width:w, height:h, links} = answer;
  const svg = (tag, attrs) => {
    const node = doc.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key,value] of Object.entries(attrs)) node.setAttribute(key,value);
    return node;
  };
  const root = svg('svg', {viewBox:`0 0 ${w*24+2} ${h*24+2}`, width:w*24+2, height:h*24+2, role:'img', 'aria-label':label,
    'font-family':'-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", sans-serif', 'font-size':16, 'font-weight':400, fill:'#000', stroke:'none'});
  root.append(svg('rect', {x:0, y:0, width:w*24+2, height:h*24+2, fill:'#fff'}));
  let grid = '';
  for (let x=1; x<w; x++) grid += `M${x*24+1} 1V${h*24+1}`;
  for (let y=1; y<h; y++) grid += `M1 ${y*24+1}H${w*24+1}`;
  root.append(svg('path', {d:grid, class:'answer-grid', fill:'none', stroke:'#aaa', 'stroke-width':.6}));
  const values = [...new Set(clues.filter(Boolean))].sort((a,b)=>a-b);
  const visited = new Set();
  for (let c=0; c<clues.length; c++) {
    if (!clues[c] || visited.has(c)) continue;
    const points = []; let prev = -1, at = c;
    while (true) {
      visited.add(at); points.push(`${at%w*24+13},${Math.floor(at/w)*24+13}`);
      const next = directions.filter(([bit]) => links[at]&bit).map(([,dx,dy]) => at+dy*w+dx).find(n => n !== prev);
      if (next === undefined || visited.has(next)) break;
      prev = at; at = next;
    }
    root.append(svg('polyline', {points:points.join(' '), stroke:palette[values.indexOf(clues[c])%palette.length], class:'answer-path',
      fill:'none', 'stroke-width':4, 'stroke-linecap':'round', 'stroke-linejoin':'round'}));
  }
  for (let c=0; c<clues.length; c++) {
    if (!clues[c]) continue;
    const x = c%w*24+13, y = Math.floor(c/w)*24+13;
    root.append(svg('circle', {cx:x, cy:y, r:9.5, class:'answer-clue-bg', fill:'#fff'}));
    const text = svg('text', {x, y, class:'answer-clue', 'font-size':String(clues[c]).length > 2 ? 9 : 12,
      fill:'#111', 'text-anchor':'middle', 'dominant-baseline':'central', 'font-weight':600});
    text.textContent = clues[c]; root.append(text);
  }
  root.append(svg('rect', {x:1, y:1, width:w*24, height:h*24, class:'answer-border', fill:'none', stroke:'#aaa', 'stroke-width':1.5}));
  return root;
}
