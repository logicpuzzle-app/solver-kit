import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const root = fileURLToPath(new URL("../", import.meta.url));
const { boards: boardBaseline } = JSON.parse(await readFile(new URL("./fixtures/board-layout.json", import.meta.url), "utf8"));
const cspuzFixtures = JSON.parse(await readFile(new URL("./fixtures/cspuz-puzzles.json", import.meta.url), "utf8"));
const candidates = process.env.CHROME ? [process.env.CHROME] : [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser",
];
const chromePath = await (async () => {
  for (const path of candidates) {
    try { await access(path, constants.X_OK); return path; } catch {}
  }
})();
if (!chromePath || typeof WebSocket !== "function") {
  console.error(`SKIP: ${!chromePath ? "headless Chrome が見つかりません。CHROME で実行ファイルを指定してください。" : "WebSocket を持つ Node 22 以降が必要です。"}`);
  process.exit(2);
}

async function availablePort(preferred) {
  const server = createServer();
  try {
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(preferred, resolve); });
  } catch (error) {
    if (error.code !== "EADDRINUSE") throw error;
    return availablePort(0);
  }
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
const solverPort = await availablePort(Number(process.env.SOLVER_PORT || 8964));
const hostPort = await availablePort(Number(process.env.SDK_HOST_PORT || 8965));
const base = `http://localhost:${solverPort}/`, host = `http://localhost:${hostPort}/`;
console.log(`SDK check: solver=${base} host=${host}`);

const children = [], pending = new Map(), exceptions = [], requests = [];
let ws, serial = 0, profile;
function launch(script, port) {
  const child = spawn(process.execPath, [script], {
    cwd: root, env: { ...process.env, PORT: String(port), SOLVER_CORS_ORIGINS: "https://sdk-extra.example" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.log = "";
  child.stderr.on("data", b => { child.log = (child.log + b).slice(-4000); });
  child.on("error", e => { child.failure = e; });
  children.push(child);
  return child;
}
async function serve(script, port) {
  const child = launch(script, port);
  for (let i = 0; i < 100; i++) {
    if (child.failure || child.exitCode !== null) throw Error(`${script}: ${child.failure || child.log}`);
    try {
      const response = await fetch(`http://localhost:${port}/`);
      if (response.ok) {
        await delay(100);
        if (child.exitCode !== null) throw Error(child.log);
        return;
      }
    } catch {}
    await delay(100);
  }
  throw Error(`Server startup timed out: ${script}: ${child.log}`);
}
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++serial;
  const timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 180000);
  pending.set(id, { resolve, reject, timer });
  ws.send(JSON.stringify({ id, method, params }));
});
async function evaluate(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
}
async function until(expression, timeout = 180000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const value = await evaluate(expression);
    if (value) return value;
    await delay(100);
  }
  throw Error(`Timed out: ${expression}`);
}
async function mainBoardReady() {
  await until("!document.querySelector('#solve').disabled && (!document.querySelector('#output').hidden || !document.querySelector('#error').hidden)");
  assert.equal(await evaluate("document.querySelector('#error').hidden"), true,
    await evaluate("document.querySelector('#error').textContent"));
}
function contract(r, kind) {
  assert.equal(r.kind, kind);
  assert.equal(r.status, "ok", JSON.stringify(r));
  assert.ok(["0", "1", "2+", "?"].includes(r.solutions));
  assert.ok(Number.isFinite(r.elapsedMs) && r.elapsedMs >= 0);
  assert.ok(r.raw && typeof r.raw === "object");
  assert.ok(["kit", "numlin", "cspuz", "cspuz-fallback"].includes(r.engine));
  assert.ok(["full", "example", "common", null].includes(r.answerKind));
  assert.ok(r.displayName === null || (typeof r.displayName.ja === "string" && typeof r.displayName.en === "string"));
  const cspuz = r.engine.startsWith("cspuz");
  if (cspuz || kind === "numlin" || r.solutions !== "1") {
    assert.equal(r.rating, null); assert.equal(r.stars, null);
  } else {
    assert.equal(r.rating, r.raw.rating_hundredths / 100);
    assert.ok(Number.isFinite(r.rating));
    assert.equal(r.stars, Math.min(5, Math.max(1, Math.round(r.rating))));
  }
  if (cspuz || kind === "numlin") assert.equal(r.difficultyVersion, null);
  else assert.equal(r.difficultyVersion, r.raw.difficulty_version);
}

try {
  await serve("server.js", solverPort);
  await serve("scripts/sdk-host.mjs", hostPort);
  for (const origin of ["https://puzsq.logicpuzzle.app", "https://puzsq-v3.logicpuzzle.app",
    "https://puzsq-dev-lhbvc.logicpuzzle.app", "https://puzsq-v3-dev-q32zfgk.logicpuzzle.app",
    "http://localhost:8965", "http://127.0.0.1:12345", "https://sdk-extra.example"]) {
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      const response = await fetch(base + "sdk/v1/index.js", { method, headers: { Origin: origin } });
      assert.equal(response.headers.get("access-control-allow-origin"), origin);
      assert.match(response.headers.get("vary"), /\bOrigin\b/);
      if (method === "OPTIONS") assert.equal(response.status, 204);
      else assert.equal(response.headers.get("cache-control"), "no-cache");
    }
  }
  for (const origin of ["https://example.com", "https://puzsq.logicpuzzle.app.evil.test", "http://localhost.evil.test:8965", "null"]) {
    for (const method of ["GET", "OPTIONS"]) {
      const response = await fetch(base + "sdk/v1/index.js", { method, headers: { Origin: origin } });
      assert.equal(response.headers.get("access-control-allow-origin"), null);
    }
  }
  for (const path of ["pkg/solver_wasm_bg.wasm", "numlin/dfs_solver.wasm", "numlin/cspuz_solver_backend.wasm"]) {
    const r = await fetch(base + path, { headers: { Origin: new URL(host).origin } });
    assert.equal(r.status, 200); assert.match(r.headers.get("content-type"), /^application\/wasm\b/);
    assert.equal(r.headers.get("cache-control"), "no-cache");
    assert.equal(r.headers.get("access-control-allow-origin"), new URL(host).origin);
  }
  console.log("PASS HTTP CORS allowlist, extra origins, GET/HEAD/OPTIONS, wasm MIME and cache");

  profile = await mkdtemp(join(tmpdir(), "solver-sdk-chrome-"));
  const chrome = spawn(chromePath, ["--headless=new", "--disable-gpu", "--remote-debugging-port=0",
    `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-background-networking",
    "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "about:blank"],
  { stdio: ["ignore", "ignore", "pipe"] });
  children.push(chrome);
  let stderr = "", launchError, port;
  chrome.stderr.on("data", b => { stderr = (stderr + b).slice(-4000); });
  chrome.on("error", e => { launchError = e; });
  for (let i = 0; i < 150; i++) {
    if (launchError || chrome.exitCode !== null || chrome.signalCode) break;
    try { port = Number((await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]); break; } catch {}
    await delay(100);
  }
  if (!port) {
    console.error(`SKIP: headless Chrome を起動できません: ${launchError || stderr}`);
    process.exitCode = 2;
  } else {
    const debug = `http://127.0.0.1:${port}`;
    const version = await (await fetch(debug + "/json/version")).json();
    const target = await (await fetch(debug + "/json/new?about:blank", { method: "PUT" })).json();
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.addEventListener("open", resolve, { once: true }); ws.addEventListener("error", reject, { once: true }); });
    ws.addEventListener("message", ({ data }) => {
      const m = JSON.parse(data);
      if (m.id) {
        const p = pending.get(m.id); if (!p) return;
        pending.delete(m.id); clearTimeout(p.timer);
        if (m.error) p.reject(Error(JSON.stringify(m.error))); else p.resolve(m.result);
      } else if (m.method === "Runtime.exceptionThrown") exceptions.push(m.params);
      else if (m.method === "Network.requestWillBeSent") requests.push(m.params.request.url);
    });
    await send("Runtime.enable"); await send("Page.enable"); await send("Network.enable");
    await send("Page.addScriptToEvaluateOnNewDocument", { source: `
      window.testWorkers=[];window.blobs=new Set();window.revoked=[];
      const NativeWorker=window.Worker, create=URL.createObjectURL.bind(URL), revoke=URL.revokeObjectURL.bind(URL);
      URL.createObjectURL=b=>{const u=create(b);window.blobs.add(u);return u};
      URL.revokeObjectURL=u=>{window.blobs.delete(u);window.revoked.push(u);revoke(u)};
      window.Worker=class extends NativeWorker {
        constructor(url,options){super(url,options);this.testUrl=String(url);this.testTerminated=false;window.testWorkers.push(this)}
        terminate(){this.testTerminated=true;return super.terminate()}
      };
      window.boardSnapshot=svg=>({
        viewBox:svg.getAttribute('viewBox'),width:svg.getAttribute('width'),elements:svg.querySelectorAll('*').length,
        tags:[...svg.children].reduce((counts,n)=>(counts[n.localName]=(counts[n.localName]||0)+1,counts),{}),
      });
      window.boardAppearance=svg=>[svg,...svg.querySelectorAll('*')].map(n=>{
        const s=getComputedStyle(n);
        return [n.localName,n.textContent,s.fill,s.stroke,s.strokeWidth,s.strokeLinecap,s.strokeLinejoin,
          s.fontFamily,s.fontSize,s.fontWeight,s.textAnchor,s.dominantBaseline];
      });
    ` });
    await send("Page.navigate", { url: host + "?sdk=" + encodeURIComponent(base + "sdk/v1/index.js") });
    await until("window.sdk");
    assert.equal(await evaluate("sdk.VERSION"), "1.3.0");
    assert.deepEqual(await evaluate("Object.keys(sdk).sort()"), ["VERSION", "renderAnswer", "solve", "supportedKind"]);
    await evaluate("window.renderResults={};document.body.style.cssText='background:#171717;color:#fff;font-family:serif;font-weight:900'");
    const html = await (await fetch(base)).text();
    const urls = [...html.matchAll(/data-url="([^"]+)"/g)].map(m => m[1]);
    const samples = {};
    for (const url of urls) {
      const kind = await evaluate(`sdk.supportedKind(${JSON.stringify(url)})`);
      if (kind && !samples[kind]) samples[kind] = url;
    }
    assert.equal(Object.keys(samples).length, 7);
    const sdkBoards = {}, sdkAppearance = {};
    for (const [kind, url] of Object.entries(samples)) {
      const result = await evaluate(`(async()=>{
        const r=await sdk.solve(${JSON.stringify(url)});renderResults[${JSON.stringify(kind)}]=r;return r;
      })()`);
      contract(result, kind); assert.equal(result.solutions, "1");
      const rendered = await evaluate(`(()=>{
        const r=renderResults[${JSON.stringify(kind)}];
        const svg=sdk.renderAnswer(r,{labels:{answer:'解答',problem:'問題'}});
        document.querySelector('#board').replaceChildren(svg);
        const background=svg?.firstElementChild;
        const otherDoc=document.implementation.createHTMLDocument('');
        const foreign=sdk.renderAnswer(r,{doc:otherDoc});
        return {isSVG:svg instanceof SVGSVGElement,label:svg.getAttribute('aria-label'),
          background:background?.localName==='rect'&&background.getAttribute('fill')==='#fff'&&
            Number(background.getAttribute('width'))>0&&Number(background.getAttribute('height'))>0,
          snapshot:boardSnapshot(svg),appearance:boardAppearance(svg),
          defaultLabel:sdk.renderAnswer(r).getAttribute('aria-label'),
          document:foreign.ownerDocument===otherDoc&&[...foreign.querySelectorAll('*')].every(n=>n.ownerDocument===otherDoc),
          paths:[...svg.querySelectorAll('polyline')].map(n=>({stroke:n.getAttribute('stroke'),fill:n.getAttribute('fill'),
            width:n.getAttribute('stroke-width'),cap:n.getAttribute('stroke-linecap'),join:n.getAttribute('stroke-linejoin')}))};
      })()`);
      assert.equal(rendered.isSVG, true, kind); assert.equal(rendered.background, true, kind);
      assert.equal(rendered.label, "解答"); assert.equal(rendered.defaultLabel, "Answer");
      assert.equal(rendered.document, true, kind);
      assert.match(rendered.snapshot.viewBox, /^-?\d+ -?\d+ \d+ \d+$/);
      assert.ok(rendered.snapshot.elements > 0); assert.ok(Number(rendered.snapshot.width) > 0);
      sdkBoards[kind] = rendered.snapshot; sdkAppearance[kind] = rendered.appearance;
      if (kind === "numlin") {
        assert.ok(rendered.paths.length > 0);
        for (const path of rendered.paths) {
          assert.match(path.stroke, /^#[0-9a-f]{6}$/i);
          assert.deepEqual({ ...path, stroke: null }, { stroke: null, fill: "none", width: "4", cap: "round", join: "round" });
        }
      }
      console.log(JSON.stringify({ test: "cross-origin example", kind, status: result.status, solutions: result.solutions,
        rating: result.rating, elapsedMs: Math.round(result.elapsedMs) }));
    }
    const sat = await evaluate("sdk.solve('p?numlin/2/2/1h1',{engine:'sat',threads:2,onProgress:()=>{throw Error('consumer callback')}})");
    contract(sat, "numlin"); assert.equal(sat.raw.engine, "sat");
    assert.equal(await evaluate(`sdk.renderAnswer(${JSON.stringify(sat)}).querySelectorAll('polyline').length>0`), true);
    // Canonically unique but a path can be rerouted through free cells: not unique (cspuz-solver2 agrees).
    for (const engine of ["dfs", "sat"]) {
      const detour = await evaluate(`sdk.solve('https://puzz.link/p?numlin/5/5/l1q1l',{engine:'${engine}',threads:2}).then(r=>({r,
        dashed:sdk.renderAnswer(r).querySelectorAll('polyline.answer-detour').length}))`);
      contract(detour.r, "numlin");
      assert.equal(detour.r.solutions, "2+", engine); assert.equal(detour.r.answerKind, "example", engine);
      assert.equal(detour.r.raw.canonical_answers, 1, engine); assert.ok(detour.r.raw.detour.length >= 2, engine);
      assert.equal(detour.dashed, 1, engine);
    }
    assert.equal(await evaluate("document.querySelectorAll('link[rel=stylesheet]').length"), 0);
    assert.ok(!requests.some(url => new URL(url).pathname.endsWith("/style.css")), "Host loaded solver CSS");
    assert.equal(await evaluate(`(()=>{
      for(const r of Object.values(renderResults)) {
        const raw=structuredClone(r.raw);raw.solutions='0';raw.answer=null;
        if(raw.kind==='sudoku')raw.solution=raw.problem.slice();
        const svg=sdk.renderAnswer({...r,raw},{labels:{problem:'問題'}});
        if(!(svg instanceof SVGSVGElement)||svg.getAttribute('aria-label')!=='問題')return false;
        if(svg.querySelector('polyline,[stroke="#2456d6"]'))return false;
        if(sdk.renderAnswer({...r,raw}).getAttribute('aria-label')!=='Problem')return false;
      }
      return [undefined,null,{}, {status:'ok'}, {status:'ok',raw:{}},
        {status:'ok',raw:{kind:'unknown'}}, {status:'ok',raw:{kind:'numlin',width:0,height:0,clues:[]}}]
        .every(r=>sdk.renderAnswer(r)===null)&&['unsupported','invalid','aborted','error']
        .every(status=>sdk.renderAnswer({status,raw:renderResults.sudoku.raw})===null);
    })()`), true);
    console.log("PASS renderAnswer: 7 SVG boards, white backgrounds, labels, custom Document, CSS-free SAT/DFS paths and problem fallback");
    assert.ok(!requests.some(url => url.includes("i18n.js")), "SDK imported i18n.js");
    assert.ok(await evaluate("testWorkers.length>0 && testWorkers.every(w=>w.testUrl.startsWith('blob:'))"));
    assert.equal(await evaluate("blobs.size"), 0);
    console.log("PASS cross-origin SAT/DFS workers, callback isolation, no i18n import, blob URLs released after loading");

    for (const [url, status] of [["https://puzz.link/p?__unsupported__/2/2/0", "unsupported"],
      ["broken URL", "invalid"], ["https://puzz.link/p?sudoku/broken", "invalid"], ["p?numlin/2/2/1", "invalid"]]) {
      const result = await evaluate(`sdk.solve(${JSON.stringify(url)})`);
      assert.equal(result.status, status); assert.equal(result.rating, null); assert.equal(result.solutions, null);
      assert.equal(await evaluate(`sdk.renderAnswer(${JSON.stringify(result)})`), null);
    }
    assert.equal(await evaluate("sdk.supportedKind('https://puzz.link/p?__unsupported__/2/2/0')"), null);
    for (const options of [{ engine: "invalid" }, { threads: 0 }]) {
      assert.equal((await evaluate(`sdk.solve('p?numlin/2/2/1h1',${JSON.stringify(options)})`)).status, "invalid");
    }
    for (const url of ["p?numlin/2/2/1221", "p?numlin/5/5/3i23l21o1g", "p?sudoku/4/4/1u", "p?slither/1/1/0"]) {
      const result = await evaluate(`sdk.solve(${JSON.stringify(url)})`);
      contract(result, result.kind); assert.notEqual(result.solutions, "1"); assert.equal(result.rating, null);
      assert.equal(await evaluate(`sdk.renderAnswer(${JSON.stringify(result)}) instanceof SVGSVGElement`), true);
    }
    console.log("PASS unsupported/invalid inputs and null ratings for non-unique solutions");

    for (const url of [samples.sudoku, samples.numlin]) {
      const result = await evaluate(`(async()=>{
        const c=new AbortController();const p=sdk.solve(${JSON.stringify(url)},{signal:c.signal});c.abort();return p;
      })()`);
      assert.equal(result.status, "aborted");
      assert.equal(await evaluate(`sdk.renderAnswer(${JSON.stringify(result)})`), null);
      contract(await evaluate(`sdk.solve(${JSON.stringify(url)})`), result.kind);
      const replaced = await evaluate(`(async()=>{
        const first=sdk.solve(${JSON.stringify(url)});const second=sdk.solve(${JSON.stringify(samples.akari)});
        return {first:await first,second:await second};
      })()`);
      assert.equal(replaced.first.status, "aborted"); contract(replaced.second, "akari");
    }
    assert.equal(await evaluate(`(async()=>{const c=new AbortController();c.abort();const n=testWorkers.length;
      const r=await sdk.solve(${JSON.stringify(samples.sudoku)},{signal:c.signal});return r.status==='aborted'&&testWorkers.length===n})()`), true);
    assert.equal(await evaluate("blobs.size"), 0);
    console.log("PASS abort, superseding solve, fresh worker restart, pre-abort and blob cleanup");

    // Discard the cached worker, then force an actual module import failure without changing server files.
    await evaluate(`(async()=>{const c=new AbortController();const p=sdk.solve(${JSON.stringify(samples.sudoku)},{signal:c.signal});c.abort();await p})()`);
    const loadFailure = await evaluate(`(async()=>{
      const create=URL.createObjectURL;
      URL.createObjectURL=()=>create(new Blob([${JSON.stringify(`import ${JSON.stringify(base + "missing-worker.js")};`)}],{type:'text/javascript'}));
      try{return await sdk.solve(${JSON.stringify(samples.sudoku)})}finally{URL.createObjectURL=create}
    })()`);
    // A kit worker failure is rescued by cspuz when the cspuz worker is still alive.
    if (loadFailure.status === "ok") {
      assert.equal(loadFailure.engine, "cspuz-fallback"); assert.equal(loadFailure.solutions, "1");
      assert.equal(loadFailure.rating, null);
    } else {
      assert.equal(loadFailure.status, "error");
      assert.equal(await evaluate(`sdk.renderAnswer(${JSON.stringify(loadFailure)})`), null);
    }
    contract(await evaluate(`sdk.solve(${JSON.stringify(samples.sudoku)})`), "sudoku");
    assert.equal(await evaluate("blobs.size"), 0);
    console.log("PASS worker load failure returns error, releases blob, and recovers");

    for (const [kind, url] of Object.entries(cspuzFixtures.unique)) {
      const r = await evaluate(`sdk.solve(${JSON.stringify(url)})`);
      contract(r, kind);
      assert.equal(r.engine, "cspuz"); assert.equal(r.solutions, "1"); assert.equal(r.answerKind, "full");
      const rendered = await evaluate(`(()=>{
        const r=${JSON.stringify(r)},svg=sdk.renderAnswer(r);document.querySelector('#board').replaceChildren(svg);
        const doc=document.implementation.createHTMLDocument('');
        const other=sdk.renderAnswer(r,{doc,labels:{answer:'解答'}});
        return {svg:svg instanceof SVGSVGElement,viewBox:svg.getAttribute('viewBox'),
          background:svg.firstElementChild.getAttribute('fill'),label:other.getAttribute('aria-label'),
          doc:other.ownerDocument===doc&&[...other.querySelectorAll('*')].every(n=>n.ownerDocument===doc),
          text:[...svg.querySelectorAll('text')].every(n=>n.hasAttribute('font-size')&&!n.hasAttribute('style'))};
      })()`);
      assert.equal(rendered.svg, true); assert.equal(rendered.background, "#fff");
      assert.match(rendered.viewBox, /^0 0 \d+ \d+$/);
      assert.equal(rendered.label, "解答"); assert.equal(rendered.doc, true); assert.equal(rendered.text, true);
      console.log(`PASS cspuz cross-origin ${kind}: unique, full, SVG`);
    }
    for (const [key, url] of Object.entries(cspuzFixtures.multiple)) {
      const r = await evaluate(`sdk.solve(${JSON.stringify(url)})`);
      contract(r, r.kind); assert.equal(r.solutions, "2+");
      assert.equal(r.answerKind, key === "enumerable" ? "example" : "common");
      assert.equal(!!r.raw.example, key === "enumerable");
      if (key === "enumerable") {
        assert.equal(await evaluate(`(()=>{
          const r=${JSON.stringify(r)},svg=sdk.renderAnswer(r);
          const clues=r.raw.board.data.filter(d=>d.item.kind==='text');
          return clues.length>0&&clues.every(d=>[...svg.querySelectorAll('text')].some(n=>n.textContent===d.item.data))&&
            svg.querySelector('g').children.length>r.raw.example.data.length;
        })()`),true,"Enumerated answer must include common clues and grid");
      }
      assert.equal(await evaluate(`sdk.renderAnswer(${JSON.stringify(r)}) instanceof SVGSVGElement`), true);
    }
    const noAnswer = await evaluate(`sdk.solve(${JSON.stringify(cspuzFixtures.unsatisfiable)})`);
    contract(noAnswer, "heyawake"); assert.equal(noAnswer.solutions, "0"); assert.equal(noAnswer.answerKind, null);
    assert.equal(await evaluate(`sdk.renderAnswer(${JSON.stringify(noAnswer)}).getAttribute('aria-label')`), "Problem");
    assert.equal((await evaluate("sdk.solve('p?heyawake/broken')")).status, "invalid");
    for (const [alias, url, kind] of [
      ["slitherlink", samples.slitherlink.replace('slither/', 'slitherlink/'), "slitherlink"],
      ["yajirin", samples.yajilin.replace('yajilin/', 'yajirin/'), "yajilin"],
    ]) {
      const r=await evaluate(`sdk.solve(${JSON.stringify(url)})`);
      contract(r, kind); assert.equal(r.engine, "cspuz"); assert.equal(r.solutions, "1", alias);
    }
    const rendererCoverage = await evaluate(`(async()=>{
      const {cspuzBoardSVG}=await import(${JSON.stringify(base + "cspuz-board.js")});
      const textItems=[undefined,'upperLeft','upperRight','lowerLeft','lowerRight','center'].flatMap(pos=>
        [undefined,0,0.75,1.5].map(size=>({kind:'text',data:'<&>',pos,size})));
      const cells=['dot','block','square','triangle','fill','circle','filledCircle','smallCircle','smallFilledCircle','middleFilledCircle',
        ...['sideArrow','arrow','pencil','firefly'].flatMap(p=>['Up','Down','Left','Right'].map(d=>p+d)),
        ...['UpperLeft','UpperRight','LowerLeft','LowerRight'].map(d=>'abolo'+d),
        'slash','backslash','dottedSlash','dottedBackslash','plus','dottedHorizontalWall','dottedVerticalWall',
        ...['Unknown','Ul','Ur','Dl','Dr','UlDr','UrDl'].map(d=>'firewalkCell'+d),
        ...textItems,
        {kind:'compass',up:1,down:2,left:3,right:4},
        ...[[1],[1,2],[1,2,3],[-2,2,3,4]].map(value=>({kind:'tapaClue',value})),
        {kind:'sudokuCandidateSet',size:3,values:[1,5,9]},
        {kind:'sudokuForbiddenCandidateMarker',size:3,values:[1,5,9]},
        ...['up','down','left','right'].map(dot=>({kind:'firefly',dot,value:2})),
        ...['thermo','arrow','regionBorder'].map(kind=>({kind,cells:[{y:1,x:3},{y:3,x:3}]})),
        {kind:'lineTo',destY:2,destX:2}];
      const edges=['line','dottedLine','doubleLine','wall','boldWall','dottedWall','bar','cross',
        'smallCircle','smallFilledCircle','middleFilledCircle','circle','filledCircle',...textItems,
        {kind:'lineTo',destY:2,destX:2}];
      const board=(data=[],defaultStyle='empty')=>({kind:'grid',height:2,width:3,defaultStyle,data});
      const render=(item,y=1,x=1)=>cspuzBoardSVG(board([{y,x,color:'#123456',item}]));
      const check=(condition,message)=>{if(!condition)throw Error(message)};
      const attrs=(node,expected)=>{
        for(const [name,value] of Object.entries(expected)) {
          check(node?.getAttribute(name)===String(value),'Wrong '+name+': '+node?.outerHTML);
        }
      };
      const checkItem=(item,y,x)=>{
        const svg=render(item,y,x);
        check(svg instanceof SVGSVGElement&&!!svg.querySelector('g')?.querySelector('rect,circle,line,polygon,text'),
          'Missing item '+JSON.stringify({item,y,x}));
        for(const text of svg.querySelectorAll('text')) {
          check(text.children.length===0&&text.hasAttribute('font-size')&&!text.hasAttribute('style'),'Unsafe or CSS-dependent text');
        }
        if(item.kind==='text') {
          const unit=(y&1)===(x&1)&&(y&1)===0?21:30;
          const offsets={upperLeft:[-0.25,-0.25],upperRight:[-0.25,0.25],lowerLeft:[0.25,-0.25],lowerRight:[0.25,0.25]};
          const [dy,dx]=offsets[item.pos]??[0,0];
          attrs(svg.querySelector('text'),{x:30+15*x+unit*dx,y:30+15*y+unit*dy,
            'font-size':unit*(item.pos?0.5:0.8)*(item.size??1),fill:'#123456'});
          check(svg.querySelector('text').textContent==='<&>','Unsafe text');
        }
      };
      let count=0;
      for(const item of cells) for(const [y,x] of [[1,1],[0,0],[-1,-1],[-2,-2]]) {
        checkItem(item,y,x);
        count++;
      }
      for(const item of edges) for(const [y,x] of [[1,2],[2,1]]) {
        checkItem(item,y,x);count++;
      }
      attrs(render('block').querySelector('g rect'),{x:33,y:33,width:24,height:24});
      attrs(render('middleFilledCircle',0,0).querySelector('circle'),{cx:30,cy:30,r:6,fill:'#123456'});
      attrs(render('bar',2,1).querySelector('g rect'),{x:36,y:57,width:18,height:6,stroke:'black','stroke-width':1});
      attrs(render('bar',1,2).querySelector('g rect'),{x:57,y:36,width:6,height:18,stroke:'black','stroke-width':1});
      const firewalk=render('firewalkCellUnknown').querySelector('g');
      check(firewalk.querySelectorAll('polygon').length===1&&firewalk.querySelectorAll('line').length===0,'Unknown firewalk');
      attrs(firewalk.querySelector('polygon'),{points:'37.5,45 45,37.5 52.5,45 45,52.5',fill:'#ffe0e0'});
      const forbidden=render({kind:'sudokuForbiddenCandidateMarker',size:3,values:[1,5,9]});
      check(forbidden.querySelectorAll('text').length===3&&forbidden.querySelectorAll('line').length===6,'Forbidden candidates');
      attrs(forbidden.querySelector('text'),{x:35,y:35,'font-size':9,fill:'#123456'});
      attrs(forbidden.querySelector('line'),{x1:32,y1:32,x2:38,y2:38,stroke:'red','stroke-width':1});
      for(const [y,x,unit] of [[1,1,30],[0,0,21]]) {
        const thermo=render({kind:'thermo',cells:[{y:1,x:3},{y:3,x:3}]},y,x);
        attrs(thermo.querySelector('circle'),{cx:30+15*x,cy:30+15*y,r:unit*0.38,'stroke-width':3,fill:'#123456'});
        const lines=thermo.querySelectorAll('line');
        check(lines.length===2,'Thermo path');
        attrs(lines[1],{x1:30+unit*1.5,y1:30+unit/2,x2:30+unit*1.5,y2:30+unit*1.5,
          'stroke-width':unit*0.25,'stroke-linecap':'round'});
      }
      for(const cells of [[],[{y:1,x:3}],[{y:1,x:3},{y:3,x:3}],[{y:1,x:1}]]) {
        const arrow=render({kind:'arrow',cells});
        attrs(arrow.querySelector('circle'),{cx:45,cy:45,r:12,fill:'none','stroke-width':3});
        check(arrow.querySelectorAll('line').length===cells.length+(cells.length?2:0),'Arrow path/head');
        check(!/NaN|Infinity/.test(arrow.outerHTML),'Degenerate arrow');
        if(cells.length&&cells[0].x===3)attrs(arrow.querySelector('line'),{x1:57,y1:45,x2:75,y2:45,'stroke-width':3,'stroke-linecap':'round'});
        if(cells.length===2) {
          const head=arrow.querySelectorAll('line')[2],scale=30*0.4*Math.sqrt(0.5);
          check(Math.abs(Number(head.getAttribute('x2'))-(75+scale))<1e-10&&
            Math.abs(Number(head.getAttribute('y2'))-(75-scale))<1e-10,'Arrow head geometry');
        }
      }
      const region=render({kind:'regionBorder',cells:[{y:1,x:1},{y:1,x:3}]});
      check(region.querySelectorAll('line').length===6,'Region must omit shared borders');
      attrs(region.querySelector('line'),{x1:33,y1:33,x2:57,y2:33,stroke:'#123456','stroke-width':1,'stroke-dasharray':'4,2.6666666666666665'});
      for(const item of ['futureItem','firewalkCellFuture',{kind:'futureItem'},null,42]) {
        for(const [y,x] of [[1,1],[0,0],[1,2]]) {
          const svg=cspuzBoardSVG(board([{y,x,color:'black',item},{y:1,x:1,color:'black',item:'dot'}],'outer_grid'));
          check(svg.querySelector('g').children.length===5,'Unknown item must be ignored');
        }
      }
      const valid=board();
      for(const invalid of [null,{}, {...valid,kind:'other'},{...valid,height:0},{...valid,width:1.5},
        {...valid,data:null},{...valid,data:[null]},{...valid,data:[{y:NaN,x:1,item:'dot'}]}]) {
        check(cspuzBoardSVG(invalid)===null,'Invalid board');
      }
      check(cspuzBoardSVG(valid,{example:{...valid,width:4}})===null,'Mismatched example');
      const doc=document.implementation.createHTMLDocument('');
      const common=board([{y:1,x:1,color:'black',item:{kind:'text',data:'clue'}}],'outer_grid');
      const example=board([{y:1,x:1,color:'green',item:'fill'}]);
      const layered=cspuzBoardSVG(common,{doc,labels:{answer:'解答'},example});
      attrs(layered,{viewBox:'0 0 150 120',width:150,height:120,'aria-label':'解答'});
      attrs(layered.firstElementChild,{fill:'#fff',width:150,height:120});
      check(layered.ownerDocument===doc&&[...layered.querySelectorAll('*')].every(n=>n.ownerDocument===doc),'Custom document');
      check(layered.querySelector('g').children[0].tagName==='rect'&&layered.querySelector('g').children[1].textContent==='clue','Example/common layer order');
      attrs(cspuzBoardSVG({...valid,hasAnswer:false},{labels:{problem:'問題'}}),{'aria-label':'問題'});
      const styles={};
      for(const defaultStyle of ['outer_grid','grid','dots','empty']){
        const svg=cspuzBoardSVG({kind:'grid',height:2,width:3,defaultStyle,data:[]});
        styles[defaultStyle]=svg.querySelector('g').children.length;
      }
      return {count,styles};
    })()`);
    assert.ok(rendererCoverage.count > 100);
    assert.deepEqual(rendererCoverage.styles, {outer_grid:4,grid:7,dots:12,empty:0});
    console.log('PASS cspuz renderer coverage: '+rendererCoverage.count+' item/position variants, geometry, unknown items and wrapper contract');
    assert.equal(await evaluate(`(async()=>{
      const {shouldFallback,fallbackReason,mergeFallback,cspuzSolutions}=await import(${JSON.stringify(base + "sdk/solver.js")});
      const kit={status:'ok',engine:'kit',raw:{kind:'akari',solutions:'1',unknown:3,rating_hundredths:250}};
      const cs={status:'ok',engine:'cspuz',solutions:'1',answerKind:'full',raw:{engine:'cspuz',board:{kind:'grid'}}};
      const merged=mergeFallback(kit,cs,'incomplete');
      return ['0','2+'].every(s=>!shouldFallback({status:'ok',raw:{solutions:s}}))&&
        !shouldFallback({status:'ok',raw:{kind:'akari',solutions:'1',unknown:0}})&&
        fallbackReason({status:'ok',raw:{solutions:'?'}})==='undetermined'&&
        fallbackReason({status:'invalid',raw:{}})==='failed'&&fallbackReason({status:'error',raw:{}})==='failed'&&
        fallbackReason({status:'aborted',raw:{}})===null&&
        fallbackReason(kit)==='incomplete'&&fallbackReason({status:'ok',raw:{kind:'slitherlink',solutions:'1',status:'STOPPED'}})==='incomplete'&&
        fallbackReason({status:'ok',raw:{kind:'sudoku',solutions:'1',unsolved:4,solution:[1,2]}})===null&&
        merged.engine==='kit'&&merged.raw.rating_hundredths===250&&merged.raw.fallback.board.kind==='grid'&&
        mergeFallback(kit,{...cs,solutions:'2+'},'incomplete')===kit&&
        mergeFallback(kit,{status:'invalid',raw:{}},'incomplete')===kit&&
        mergeFallback({status:'invalid',raw:{}},cs,'failed').engine==='cspuz-fallback'&&
        mergeFallback({status:'invalid',error:'kit',raw:{}},{status:'invalid',raw:{}},'failed').error==='kit'&&
        cspuzSolutions({isUnique:true,hasAnswer:true})==='1'&&cspuzSolutions({isUnique:false,hasAnswer:true})==='2+'&&
        cspuzSolutions({hasAnswer:false})==='0'&&cspuzSolutions({hasAnswer:true})==='?';
    })()`), true);
    console.log("PASS cspuz multiple examples/common cells, no answer, invalid URL, aliases, all renderer items/styles and fallback predicates");

    const cspuzUrl=cspuzFixtures.unique.heyawake;
    for (const url of [cspuzUrl]) {
      const r=await evaluate(`(async()=>{const c=new AbortController();const p=sdk.solve(${JSON.stringify(url)},{signal:c.signal});c.abort();return p})()`);
      assert.equal(r.status,"aborted");
      const replaced=await evaluate(`(async()=>{const first=sdk.solve(${JSON.stringify(url)});const second=sdk.solve(${JSON.stringify(samples.akari)});return [await first,await second]})()`);
      assert.equal(replaced[0].status,"aborted");contract(replaced[1],"akari");
    }
    const cspuzLoadFailure=await evaluate(`(async()=>{
      const create=URL.createObjectURL;
      URL.createObjectURL=()=>create(new Blob([${JSON.stringify(`import ${JSON.stringify(base + "missing-cspuz-worker.js")};`)}],{type:'text/javascript'}));
      try{return await sdk.solve(${JSON.stringify(cspuzUrl)})}finally{URL.createObjectURL=create}
    })()`);
    assert.equal(cspuzLoadFailure.status,"error");
    contract(await evaluate(`sdk.solve(${JSON.stringify(cspuzUrl)})`),"heyawake");
    assert.equal(await evaluate("blobs.size"),0);
    console.log("PASS cspuz abort, replacement, worker load failure/recovery and blob cleanup");
    const fallbackResult=await evaluate(`(async()=>{
      const c=new AbortController();const pending=sdk.solve(${JSON.stringify(samples.akari)},{signal:c.signal});c.abort();await pending;
      const NativeWorker=window.Worker;
      let mockCreated=false;
      window.Worker=class extends EventTarget {
        constructor(url,options){super();if(mockCreated)return new NativeWorker(url,options);mockCreated=true}
        postMessage({id}){queueMicrotask(()=>{
          const data={id,ok:true,json:JSON.stringify({kind:'akari',solutions:'?',rating_hundredths:250,difficulty_version:1})};
          this.dispatchEvent(new MessageEvent('message',{data}));this.onmessage?.({data});
        })}
        terminate(){}
      };
      try{return await sdk.solve(${JSON.stringify(samples.akari)})}finally{window.Worker=NativeWorker}
    })()`);
    contract(fallbackResult,"akari");
    assert.equal(fallbackResult.engine,"cspuz-fallback");assert.equal(fallbackResult.solutions,"1");
    assert.equal(fallbackResult.rating,null);assert.equal(fallbackResult.raw.rating_hundredths,null);
    assert.equal(fallbackResult.difficultyVersion,null);assert.equal(fallbackResult.answerKind,"full");
    assert.equal(await evaluate(`sdk.renderAnswer(${JSON.stringify(fallbackResult)}) instanceof SVGSVGElement`),true);
    assert.equal(await evaluate("blobs.size"),0);
    // A mocked kit worker must not remain cached for subsequent real solves.
    await evaluate(`(async()=>{const c=new AbortController();const p=sdk.solve(${JSON.stringify(samples.akari)},{signal:c.signal});c.abort();await p})()`);
    console.log("PASS kit search-limit result rechecked by real cspuz worker, null rating and full fallback SVG");
    for (const [kind,url] of Object.entries(cspuzFixtures.kitIncomplete)) {
      const r=await evaluate(`sdk.solve(${JSON.stringify(url)})`);
      contract(r,kind);
      assert.equal(r.engine,"kit");assert.equal(r.solutions,"1");assert.ok(r.rating>0);
      assert.equal(r.raw.status,"STOPPED");assert.equal(r.raw.fallback.engine,"cspuz");assert.equal(r.answerKind,"full");
      assert.equal(await evaluate(`sdk.renderAnswer(${JSON.stringify(r)}) instanceof SVGSVGElement`),true);
    }
    console.log("PASS kit techniques stopped: rating kept and answer board completed by cspuz");

    await evaluate("document.querySelector('#form').requestSubmit()");
    await until("document.querySelector('#result').textContent.includes('elapsedMs')");
    contract(await evaluate("JSON.parse(document.querySelector('#result').textContent)"), "numlin");
    assert.ok(await evaluate("document.querySelector('#board svg') instanceof SVGSVGElement"));
    await send("Page.navigate", { url: base + "?lang=ja&engine=dfs&threads=4&url=" + encodeURIComponent(samples.sudoku) });
    await until("document.readyState==='complete' && document.querySelector('#form')?.elements.engine.value==='dfs'");
    await evaluate("import('./main.js')");
    assert.equal(await evaluate("document.querySelector('#url').value"), samples.sudoku);
    assert.equal(await evaluate("document.querySelector('#form').elements.threads.value"), "4");
    await evaluate("document.querySelector('.example[data-url*=sudoku]').click()");
    await mainBoardReady();
    assert.ok(await evaluate("!!document.querySelector('#board svg') && !!document.querySelector('#verdict .rating-bar') && document.querySelector('#error').hidden"));
    assert.ok(await evaluate("testWorkers.every(w=>!w.testUrl.startsWith('blob:'))"));
    for (const [kind, url] of Object.entries(samples)) {
      await evaluate(`document.querySelector('#url').value=${JSON.stringify(url)};document.querySelector('#form').requestSubmit()`);
      await mainBoardReady();
      const snapshot = await evaluate("boardSnapshot(document.querySelector('#board svg'))");
      const expected = structuredClone(boardBaseline[kind]);
      // Numberlink now carries its white background inside the SVG for external hosts.
      if (kind === "numlin") { expected.elements++; expected.tags.rect++; }
      assert.deepEqual(snapshot, expected, `Main board changed: ${kind}`);
      assert.deepEqual(snapshot, sdkBoards[kind], `Main/SDK board mismatch: ${kind}`);
      assert.deepEqual(await evaluate("boardAppearance(document.querySelector('#board svg'))"), sdkAppearance[kind], `Main/SDK appearance mismatch: ${kind}`);
      assert.ok(await evaluate("document.querySelector('#error').hidden"));
    }
    console.log("PASS main page: all 7 boards match pre-extraction element counts/viewBox/width and CSS-free SDK appearance");
    assert.equal(await evaluate("document.querySelector('#supported-puzzles') instanceof HTMLDetailsElement && document.querySelector('#supported-kinds').children.length===141"), true);
    for (const [url, heading] of [
      [cspuzFixtures.unique.heyawake, null],
      [cspuzFixtures.multiple.enumerable, "解の一例"],
      [cspuzFixtures.multiple.common, "確定しているマスのみ"],
    ]) {
      await evaluate(`document.querySelector('#url').value=${JSON.stringify(url)};document.querySelector('#form').requestSubmit()`);
      await mainBoardReady();
      assert.equal(await evaluate("!!document.querySelector('#board svg')"),true);
      assert.equal(await evaluate("document.querySelector('#board-heading').hidden"),heading===null);
      if(heading)assert.equal(await evaluate("document.querySelector('#board-heading').textContent"),heading);
      if(process.env.SDK_CHECK_SCREENSHOTS) {
        const clip=await evaluate("({x:0,y:0,width:document.documentElement.clientWidth,height:Math.ceil(document.querySelector('#detail-box').getBoundingClientRect().bottom+scrollY+20),scale:1})");
        const {data}=await send("Page.captureScreenshot",{format:"png",captureBeyondViewport:true,clip});
        await writeFile(join(process.env.SDK_CHECK_SCREENSHOTS, heading ? heading.includes("確定") ? "cspuz-common.png" : "cspuz-example.png" : "cspuz-unique.png"),Buffer.from(data,"base64"));
      }
      assert.equal(await evaluate("document.querySelector('#verdict .rating-bar')"),null);
      assert.match(await evaluate("document.querySelector('#detail').textContent"),/cspuz_core（MIT）/);
    }
    await evaluate("document.querySelector('[name=language][value=en]').click()");
    assert.equal(await evaluate("document.querySelector('#board-heading').textContent"),"Cells determined in all solutions");
    assert.match(await evaluate("document.querySelector('#detail').textContent"),/Hitori/);
    await evaluate("document.querySelector('[name=language][value=ja]').click()");
    console.log("PASS main page cspuz SVG, verdict, details, bilingual headings and supported-puzzle disclosure");
    await evaluate("document.querySelector('#url').value='broken URL';document.querySelector('#form').requestSubmit()");
    await until("!document.querySelector('#solve').disabled && !document.querySelector('#error').hidden");
    assert.match(await evaluate("document.querySelector('#error').textContent"), /^対応していないパズルです/);
    console.log("PASS host form and existing solver DOM result, query parameters and same-origin worker");
    assert.deepEqual(exceptions, []);
    console.log(JSON.stringify({ browser: version.Browser, node: process.version, status: "PASS" }));
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  ws?.close();
  for (const p of pending.values()) clearTimeout(p.timer);
  for (const child of children.reverse()) {
    if (!child.pid || child.exitCode !== null || child.signalCode) continue;
    const exited = new Promise(resolve => child.once("exit", resolve));
    child.kill("SIGTERM");
    await Promise.race([exited, delay(5000)]);
    if (child.exitCode === null && !child.signalCode) { child.kill("SIGKILL"); await exited; }
  }
  if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
