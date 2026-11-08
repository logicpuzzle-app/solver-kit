// Node 22+, a running `npm start`, and a fresh headless Chrome with real module workers.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const root = fileURLToPath(new URL("../", import.meta.url));
const base = process.env.BASE || "http://localhost:8964/";
const profile = await mkdtemp(root + ".numlin-chrome-");
const chrome = spawn(process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new", "--disable-gpu", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
  "--no-first-run", "--no-default-browser-check", "--disable-background-networking",
  "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });
let stderr = "", launchError, ws;
chrome.stderr.on("data", b => { stderr = (stderr + b).slice(-4000); });
chrome.on("error", e => { launchError = e; });
const pending = new Map(), exceptions = [];
let serial = 0;
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++serial;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
};
async function until(expression, timeout = 180000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const result = await evaluate(expression);
    if (result) return result;
    await delay(100);
  }
  throw Error(`Timed out: ${expression}`);
}
const state = `({label:document.querySelector('#verdict .label')?.textContent,
  sub:document.querySelector('#verdict .sub')?.textContent,
  detail:document.querySelector('#detail').textContent,
  stars:document.querySelectorAll('#verdict .stars,#verdict .rating-bar').length,
  svg:!!document.querySelector('#board svg'), paths:document.querySelectorAll('#board polyline').length,
  error:document.querySelector('#error').hidden ? '' : document.querySelector('#error').textContent,
  busy:document.querySelector('#solve').disabled, hidden:document.querySelector('#output').hidden})`;
async function submit(url) {
  await evaluate(`document.querySelector('#url').value=${JSON.stringify(url)}; document.querySelector('#url').dispatchEvent(new Event('input')); document.querySelector('#form').requestSubmit()`);
  await until("!document.querySelector('#solve').disabled");
  return evaluate(state);
}
try {
  for (const [path, type] of [["numlin/cspuz_solver_backend.wasm", "application/wasm"], ["numlin/worker.js", "application/javascript"], ["numlin/dfs_solver.wasm", "application/wasm"], ["numlin/dfs_worker.js", "application/javascript"]]) {
    const response = await fetch(new URL(path, base));
    assert.equal(response.status, 200);
    assert.ok(response.headers.get("content-type").startsWith(type));
    assert.equal(response.headers.get("cache-control"), "no-cache");
  }
  let port;
  for (let i = 0; i < 150; i++) {
    if (launchError || chrome.exitCode !== null || chrome.signalCode) throw Error(`Chrome failed: ${launchError || stderr}`);
    try { port = Number((await readFile(profile + "/DevToolsActivePort", "utf8")).split("\n")[0]); break; } catch {}
    await delay(100);
  }
  assert.ok(port, stderr);
  const debug = `http://127.0.0.1:${port}`;
  const version = await (await fetch(debug + "/json/version")).json();
  const target = await (await fetch(debug + "/json/new?about:blank", { method: "PUT" })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener("open", resolve, { once: true }); ws.addEventListener("error", reject, { once: true }); });
  ws.addEventListener("message", ({ data }) => {
    const m = JSON.parse(data);
    if (m.id) {
      const p = pending.get(m.id); pending.delete(m.id);
      if (m.error) p.reject(Error(JSON.stringify(m.error))); else p.resolve(m.result);
    } else if (m.method === "Runtime.exceptionThrown") exceptions.push(m.params);
  });
  await send("Runtime.enable"); await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 900, height: 1100, deviceScaleFactor: 1, mobile: false });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `
    window.testWorkers=[]; window.testMessages=[]; const NativeWorker=window.Worker;
    window.Worker=class extends NativeWorker {
      constructor(url,options) { super(url,options); this.testUrl=String(url); this.testTerminated=false; window.testWorkers.push(this); }
      terminate() { this.testTerminated=true; return super.terminate(); }
      postMessage(data,...args) { window.testMessages.push({url:this.testUrl,data,created:window.testWorkers.length}); return super.postMessage(data,...args); }
    };
  ` });
  await send("Page.navigate", { url: base + "index.html?lang=ja" });
  await until("document.readyState === 'complete' && document.querySelectorAll('.example[data-url*=numlin]').length === 2");
  await evaluate(`window.progress=[];new MutationObserver(()=>window.progress.push(document.querySelector('#solve-progress').textContent)).observe(document.querySelector('#solve-progress'),{childList:true})`);
  const samples = await evaluate("[...document.querySelectorAll('.example[data-url*=numlin]')].map(a=>a.dataset.url)");
  // Engine and workers default to "auto" (engine by board size, <= 400 cells: DFS); the SAT cases below pick SAT explicitly.
  await evaluate("document.querySelector('[name=engine][value=sat]').click()");
  for (let i = 0; i < samples.length; i++) {
    if (i === 1 && process.env.SKIP_LARGE) continue;
    await evaluate(`document.querySelectorAll('.example[data-url*=numlin]')[${i}].click()`);
    await until("!document.querySelector('#solve').disabled");
    const result = await evaluate(state);
    assert.equal(result.label, "唯一解"); assert.equal(result.stars, 0);
    assert.equal(result.sub, "難易度判定は未対応(解の有無と唯一性のみ)");
    assert.ok(result.paths > 0); assert.equal(result.error, "");
    assert.match(result.detail, /先着(?:単体 SAT|cube 分割)/);
    assert.ok(await evaluate("window.testWorkers.filter(w=>w.testUrl.includes('/numlin/')).every(w=>w.testTerminated)"));
    console.log(JSON.stringify({ test: i === 0 ? "15x15" : "20x20", ...result }));
    if (i === 0 && process.env.SCREENSHOT) {
      const { data } = await send("Page.captureScreenshot", { format: "png" });
      await writeFile(root + "NUMLIN-INTEGRATION.png", Buffer.from(data, "base64"));
    }
  }
  assert.ok((await evaluate("window.progress")).some(p => /\d+\/\d+( · 推定 [\d.]+%)? · \d+ ワーカー · [\d.]+ s/.test(p)));
  for (const [url, label] of [["p?numlin/2/2/1221", "解がありません"], ["p?numlin/5/5/3i23l21o1g", "解が複数あります"]]) {
    const result = await submit(url); assert.equal(result.label, label); assert.equal(result.stars, 0);
    assert.ok(result.svg); console.log(JSON.stringify({ test: url, ...result }));
  }
  const detour = await submit("p?numlin/5/5/l1q1l");
  assert.equal(detour.label, "解が複数あります"); assert.match(detour.sub, /迂回/);
  assert.match(detour.detail, /解の数\(上限 2\)2 以上/);
  assert.equal(await evaluate("document.querySelectorAll('polyline.answer-detour').length"), 1);
  console.log(JSON.stringify({ test: "detour", ...detour }));
  // Exercise both optional portfolio layouts through the actual adapter and details UI.
  const originalPortfolio = await evaluate("import('./numlin/scheduler.js').then(m=>({layout:m.defaults.layout,plain_start:m.defaults.plain_start}))");
  for (const layout of ["B", "C"]) {
    await evaluate(`import('./numlin/scheduler.js').then(m=>{m.defaults.layout='${layout}';m.defaults.plain_start='immediate'})`);
    const r = await submit("p?numlin/2/1/11");
    assert.equal(r.label, "唯一解"); assert.match(r.detail, /先着(?:単体 SAT|cube 分割)/);
    assert.ok(await evaluate("window.testWorkers.filter(w=>w.testUrl.includes('/numlin/')).every(w=>w.testTerminated)"));
    console.log(JSON.stringify({test: `portfolio ${layout}`, ...r}));
  }
  await evaluate(`import('./numlin/scheduler.js').then(m=>{Object.assign(m.defaults,${JSON.stringify(originalPortfolio)})})`);
  // Boards over 400 cells run DFS and SAT side by side under the auto engine (solver-kit#15).
  // 21x20 board with each row's pair at its two ends: unique, solved instantly by either engine.
  await evaluate("document.querySelector('[name=engine][value=auto]').click()");
  {
    const r = await submit("p?numlin/21/20/1y12y23y34y45y56y67y78y89y9ayabybcycdydeyefyf-10y-10-11y-11-12y-12-13y-13-14y-14");
    assert.equal(r.label, "唯一解"); assert.ok(r.paths > 0); assert.equal(r.error, "");
    assert.ok(await evaluate("window.testWorkers.filter(w=>w.testUrl.includes('/numlin/')).every(w=>w.testTerminated)"));
    console.log(JSON.stringify({test: "auto portfolio 21x20", ...r}));
  }
  await evaluate("document.querySelector('[name=engine][value=sat]').click()");
  const invalid = await submit("p?numlin/2/2/1");
  assert.equal(invalid.label, "中断・エラー"); assert.ok(invalid.error); assert.equal(invalid.stars, 0);
  console.log("PASS invalid URL");
  // Abort during startup and restart in the same turn: stale completions must not replace the new board.
  await evaluate(`document.querySelectorAll('.example[data-url*=numlin]')[1].click();document.querySelector('#cancel').click()`);
  await until("document.querySelector('#verdict .label')?.textContent === '中断・エラー'");
  assert.ok(await evaluate("window.testWorkers.filter(w=>w.testUrl.includes('/numlin/')).every(w=>w.testTerminated)"));
  console.log("PASS cancel during worker loading");
  await evaluate(`document.querySelectorAll('.example[data-url*=numlin]')[1].click()`);
  await until("window.testWorkers.some(w=>!w.testTerminated && w.testUrl.includes('/numlin/'))");
  await delay(1000);
  await evaluate("document.querySelector('#cancel').click()");
  await until("!document.querySelector('#solve').disabled");
  assert.equal((await evaluate(state)).label, "中断・エラー");
  assert.ok(await evaluate("window.testWorkers.filter(w=>w.testUrl.includes('/numlin/')).every(w=>w.testTerminated)"));
  console.log("PASS cancel after startup");
  await evaluate(`document.querySelectorAll('.example[data-url*=numlin]')[1].click(); document.querySelector('.example[data-url*=yajilin]').click()`);
  await until("!document.querySelector('#solve').disabled");
  const yajilin = await evaluate(state);
  assert.ok(yajilin.detail.includes("yajilin-kit")); assert.equal(yajilin.error, ""); assert.ok(yajilin.svg);
  assert.ok(yajilin.stars > 0); assert.ok(!yajilin.hidden);
  console.log(JSON.stringify({ test: "switch to yajilin", ...yajilin }));
  await evaluate(`document.querySelector('.example[data-url*=yajilin]').click();document.querySelectorAll('.example[data-url*=numlin]')[0].click()`);
  await until("!document.querySelector('#solve').disabled");
  assert.equal((await evaluate(state)).label, "唯一解");
  console.log("PASS switch back to Numberlink");
  // API result contract, pre-abort, and worker-constructor failures.
  const api = await evaluate(`(async()=>{
    const {solveNumlin,isNumlinUrl}=await import('./numlin.js');
    const {defaults}=await import('./numlin/scheduler.js');
    const controller=new AbortController();controller.abort();const before=testWorkers.length;
    const stopped=await solveNumlin('p?numlin/3/3/1m1',{signal:controller.signal});
    const noWorkers=testWorkers.length===before;
    const r=await solveNumlin('prefix p?numlin/5/5/3i23l21o1g');
    const saved=window.Worker;let created=0;window.Worker=class extends saved {constructor(...args){if(created++===2)throw Error('test startup failure');super(...args)}};
    let failed;try{failed=await solveNumlin('p?numlin/3/3/1m1')}finally{window.Worker=saved}
    return {layout:defaults.layout,matches:isNumlinUrl('prefix p?numlin/3/3/1m1'),stopped,noWorkers,result:r,failed};
  })()`);
  assert.ok(api.matches && api.noWorkers); assert.equal(api.stopped.status, "stopped");
  assert.equal(api.result.kind, "numlin"); assert.equal(api.result.answers, 2);
  assert.equal(api.result.clues.length, 25); assert.ok(api.result.answer);
  for (const key of ["width", "height", "wall_ms", "cpu_ms", "threads", "cubes"]) assert.equal(typeof api.result[key], "number");
  if (api.layout === "A") {assert.equal(api.failed.status, "error"); assert.equal(api.failed.error, "test startup failure");}
  else {assert.equal(api.failed.status, "complete"); assert.equal(api.failed.winner, "plain");}
  assert.ok(["plain", "cubes"].includes(api.result.winner));
  for (const key of ["plain_ms", "cube_ms"]) assert.ok(api.result[key] === null || typeof api.result[key] === "number");
  assert.ok(await evaluate("window.testWorkers.filter(w=>w.testUrl.includes('/numlin/')).every(w=>w.testTerminated)"));
  console.log("PASS API, pre-abort, worker startup failure");

  const chooseEngine = async engine => evaluate(`document.querySelector('[name=engine][value=${engine}]').click()`);
  const chooseThreads = async n => evaluate(`document.querySelector('[name=threads][value="${n}"]').click()`);
  const detailsMap = `Object.fromEntries([...document.querySelectorAll('#detail dt')].map(dt=>[dt.textContent,dt.nextElementSibling.textContent]))`;
  const allStopped = "window.testWorkers.filter(w=>w.testUrl.includes('/numlin/')).every(w=>w.testTerminated)";
  await evaluate(`document.querySelector('#url').value=document.querySelector('.example[data-url*=sudoku]').dataset.url;document.querySelector('#url').dispatchEvent(new Event('input'))`);
  assert.equal(await evaluate("document.querySelector('#numlin-settings').hidden"), true);
  assert.equal(await evaluate("document.querySelector('#numlin-options').hidden"), true);
  await evaluate(`document.querySelector('#url').value=${JSON.stringify(samples[0])};document.querySelector('#url').dispatchEvent(new Event('input'))`);
  assert.equal(await evaluate("document.querySelector('#numlin-settings').hidden"), false);
  assert.equal(await evaluate("document.querySelector('#numlin-options').hidden"), true);
  await evaluate("document.querySelector('#numlin-settings').click()");
  assert.equal(await evaluate("document.querySelector('#numlin-options').hidden"), false);
  console.log("PASS settings gear visibility on input and sample links, panel opens on click");

  await chooseEngine("dfs"); await chooseThreads(2);
  await evaluate("window.testWorkers=[];window.testMessages=[];window.progress=[]");
  const dfs = await submit(samples[0]);
  assert.equal(dfs.label, "唯一解"); assert.equal(dfs.stars, 0); assert.ok(dfs.paths > 0); assert.equal(dfs.error, "");
  const dfsDetails = await evaluate(detailsMap);
  assert.equal(dfsDetails["エンジン"], "rowscan_dfs · Row-scan DFS (MIT)");
  assert.equal(dfsDetails["ワーカー数"], "8"); assert.ok(!("先着" in dfsDetails) && !("キューブ数" in dfsDetails));
  assert.match(dfsDetails["方向"], /^[0-7]$/); assert.ok(Number(dfsDetails["ステップ数"]) > 0);
  // The race retains all eight wasm states; threads controls how many directions start together.
  assert.equal(await evaluate("testMessages.find(m=>m.data.type==='prepare').created"), 2);
  assert.ok(await evaluate("testMessages.filter(m=>m.data.type==='dfs').every(m=>m.data.options.cut===25 && m.data.options.memo_bits===24 && m.data.options.diag_shortcut===false)"));
  assert.ok((await evaluate("window.progress")).some(p => /方向レース \d\/8 · \d+ ワーカー · [\d.]+ s/.test(p)));
  assert.ok(await evaluate(allStopped));
  console.log(JSON.stringify({test:"DFS 15x15, radio, 2 parallel / 8 created", ...dfs}));
  const workersBeforeLanguageSwitch = await evaluate("testWorkers.length");
  await evaluate("document.querySelector('[name=language][value=en]').click()");
  assert.equal(await evaluate("document.querySelector('#solve').textContent"), "Solve");
  assert.deepEqual(await evaluate("[...document.querySelectorAll('[name=engine]')].map(i=>i.nextElementSibling.textContent)"), ["Auto", "Parallel SAT", "Row-scan DFS"]);
  const englishDfs = await evaluate(state);
  assert.equal(englishDfs.label, "Unique solution"); assert.ok(englishDfs.detail.includes("Engine"));
  assert.equal(await evaluate("document.documentElement.lang"), "en");
  assert.ok(await evaluate("document.title.includes('puzzle types') && document.querySelector('#url').placeholder.includes(' or ')"));
  assert.equal(await evaluate("document.querySelector('#board svg').getAttribute('aria-label')"), "Answer");
  assert.ok(await evaluate("document.querySelector('footer').textContent.includes('Calibration') && document.querySelector('#changelog').textContent.includes('Added Numberlink support.')"));
  await evaluate("document.querySelector('[name=language][value=ja]').click()");
  assert.equal((await evaluate(state)).label, "唯一解");
  assert.equal(await evaluate("testWorkers.length"), workersBeforeLanguageSwitch);
  console.log("PASS English toggle and Japanese result re-render without new workers");
  if (process.env.DFS_SCREENSHOT) {
    await evaluate("document.querySelector('#detail-box').open=true");
    const { data } = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(root + "NUMLIN-DFS.png", Buffer.from(data, "base64"));
    await evaluate("document.querySelector('#detail-box').open=false");
  }

  // Poll the visible continuation estimate, including when SKIP_LARGE omits the SAT run.
  await evaluate(`window.dfs20Progress=[];window.testMessages=[];document.querySelectorAll('.example[data-url*=numlin]')[1].click()`);
  await until(`(()=>{
    window.dfs20Progress.push(document.querySelector('#solve-progress').textContent);
    return !document.querySelector('#solve').disabled;
  })()`);
  const dfs20 = await evaluate(state);
  assert.equal(dfs20.label, "唯一解"); assert.equal(dfs20.error, ""); assert.ok(dfs20.paths > 0);
  const progress20 = await evaluate("window.dfs20Progress");
  const estimates20 = progress20.filter(p => /方向 [0-7] を探索中 · 推定 [\d.]+% · [\d.]+ s/.test(p));
  if (estimates20.length) {
    assert.ok(progress20.some(p => p.includes("推定")));
    assert.ok(await evaluate("testMessages.some(m=>m.data.type==='resume' && m.data.budget>0)"));
    console.log(`PASS DFS 20x20 continuation estimate: ${estimates20[0]} (${estimates20.length} polls)`);
  } else {
    assert.ok(progress20.some(p => /方向レース \d\/8 · \d+ ワーカー/.test(p)), "No DFS progress observed");
    assert.equal(await evaluate("testMessages.filter(m=>m.data.type==='resume').length"), 0,
      "Continuation ran but its estimate was never visible");
    console.log("PASS DFS 20x20 finished during the race; race-only progress observed");
  }
  assert.ok(await evaluate(allStopped));

  for (const [url, label] of [["p?numlin/2/2/1221", "解がありません"], ["p?numlin/5/5/3i23l21o1g", "解が複数あります"]]) {
    const r = await submit(url); assert.equal(r.label, label); assert.equal(r.error, ""); assert.ok(r.svg);
    if (label === "解が複数あります") assert.equal((await evaluate(detailsMap))["解の数(上限 2)"], "2 以上");
  }
  console.log("PASS DFS no solution and multiple solutions");
  const dfsApi = await evaluate(`(async()=>{
    const {solveNumlin}=await import('./numlin.js');const stoppedController=new AbortController();stoppedController.abort();
    const before=testWorkers.length;const stopped=await solveNumlin('p?numlin/3/3/1m1',{engine:'dfs',threads:4,signal:stoppedController.signal});
    const noWorkers=before===testWorkers.length;
    const result=await solveNumlin('p?numlin/5/5/3i23l21o1g',{engine:'dfs',threads:16});
    const saved=window.Worker;let created=0;window.Worker=class extends saved {constructor(...args){if(created++===2)throw Error('test DFS startup failure');super(...args)}};
    let failed;try{failed=await solveNumlin('p?numlin/3/3/1m1',{engine:'dfs',threads:4})}finally{window.Worker=saved}
    const invalid=await solveNumlin('p?numlin/2/2/1',{engine:'dfs'});
    const invalidThreads=await solveNumlin('p?numlin/3/3/1m1',{engine:'dfs',threads:0});
    return {stopped,noWorkers,result,failed,invalid,invalidThreads};
  })()`);
  assert.equal(dfsApi.stopped.status, "stopped"); assert.ok(dfsApi.noWorkers);
  assert.equal(dfsApi.result.engine, "dfs"); assert.equal(dfsApi.result.status, "complete");
  assert.ok(dfsApi.result.answers >= 2); assert.ok(dfsApi.result.answer.links.length === 25); assert.equal(dfsApi.result.threads, 8);
  for (const key of ["width", "height", "wall_ms", "cpu_ms", "threads", "direction", "steps"]) assert.equal(typeof dfsApi.result[key], "number");
  assert.equal(dfsApi.failed.status, "error"); assert.equal(dfsApi.failed.error, "test DFS startup failure"); assert.equal(dfsApi.failed.threads, 2);
  assert.equal(dfsApi.invalid.status, "error"); assert.ok(dfsApi.invalid.error);
  assert.equal(dfsApi.invalidThreads.status, "error"); assert.ok(await evaluate(allStopped));
  console.log("PASS DFS API, worker clamp, pre-abort, invalid input, startup failure");

  for (const loaded of [false, true]) {
    await evaluate(`window.testMessages=[];document.querySelectorAll('.example[data-url*=numlin]')[1].click();${loaded ? "" : "document.querySelector('#cancel').click()"}`);
    if (loaded) {
      await until("testWorkers.some(w=>!w.testTerminated && w.testUrl.includes('/dfs_worker.js'))");
      await until("testMessages.some(m=>m.data.type==='dfs' && m.url.includes('/dfs_worker.js'))");
      const liveLanguage = await evaluate(`(()=>{
        const before=testWorkers.length;
        document.querySelector('[name=language][value=en]').click();
        return {before,after:testWorkers.length,progress:document.querySelector('#solve-progress').textContent,
          button:document.querySelector('#solve').textContent,busy:document.querySelector('#solve').disabled};
      })()`);
      assert.equal(liveLanguage.before, liveLanguage.after); assert.ok(liveLanguage.busy);
      assert.equal(liveLanguage.button, "Solving…");
      assert.match(liveLanguage.progress, /Racing directions \d\/8 · \d+ workers/);
      await evaluate("document.querySelector('[name=language][value=ja]').click()");
      await evaluate("document.querySelector('#cancel').click()");
    }
    await until("!document.querySelector('#solve').disabled && document.querySelector('#solving').hidden");
    assert.equal((await evaluate(state)).label, "中断・エラー"); assert.ok(await evaluate(allStopped));
  }
  console.log("PASS DFS abort during loading and direction race returns to idle");

  await chooseEngine("sat"); await chooseThreads(4);
  const satSwitch = await submit("p?numlin/2/1/11");
  assert.equal(satSwitch.label, "唯一解"); assert.match(satSwitch.detail, /cspuz_core fork/);
  assert.equal((await evaluate(detailsMap))["ワーカー数"], "5");
  console.log("PASS radio switch back to SAT, 4 cube / 5 created workers");

  async function navigate(search, lang = "ja") {
    const url = new URL("index.html" + search, base);
    if (lang !== null) url.searchParams.set("lang", lang);
    await send("Page.navigate", {url:url.href});
    await until("document.readyState==='complete' && document.querySelector('[name=threads]') && document.querySelector('#url')?.value!==undefined");
    await evaluate("import('./main.js')");
  }
  await navigate("?engine=dfs&threads=4&url=" + encodeURIComponent(samples[0]));
  assert.equal(await evaluate("document.querySelector('#form').elements.engine.value"), "dfs");
  assert.equal(await evaluate("document.querySelector('#form').elements.threads.value"), "4");
  assert.equal(await evaluate("document.querySelector('#numlin-options').hidden"), false);
  const queryDfs = await submit(samples[0]);
  assert.equal(queryDfs.label, "唯一解"); assert.ok(queryDfs.paths > 0); assert.match(queryDfs.detail, /rowscan_dfs/);
  assert.equal((await evaluate(detailsMap))["ワーカー数"], "8");
  assert.equal(await evaluate("testMessages.find(m=>m.data.type==='prepare').created"), 4);
  assert.ok(await evaluate(allStopped));
  await navigate("");
  assert.equal(await evaluate("document.querySelector('#form').elements.engine.value"), "dfs");
  assert.equal(await evaluate("document.querySelector('#form').elements.threads.value"), "4");
  assert.equal(await evaluate("document.querySelector('#numlin-options').hidden"), true);
  console.log("PASS query engine=dfs&threads=4, actual worker details and saved selection");

  const toggleValues = "[...document.querySelectorAll('[name=threads]')].map(i=>i.value).filter(v=>v!=='auto').map(Number)";
  await navigate("?engine=sat&threads=16");
  assert.deepEqual(await evaluate(toggleValues), [1,2,4,8]);
  assert.equal(await evaluate("document.querySelector('#form').elements.threads.value"), "8");
  await navigate("?engine=sat&threads=3");
  assert.equal(await evaluate("document.querySelector('#form').elements.threads.value"), "2");
  await navigate("?engine=sat&threads=0");
  assert.ok(["4","8"].includes(await evaluate("document.querySelector('#form').elements.threads.value")));
  assert.equal(await evaluate("document.querySelectorAll('#numlin-options .toggle-group input:checked').length"), 2);
  await navigate("?engine=sat&threads=4");
  console.log("PASS thread toggles 1/2/4/8 and snapping of out-of-range requests");

  await chooseEngine("dfs");
  await evaluate(`document.querySelectorAll('.example[data-url*=numlin]')[1].click();document.querySelector('.example[data-url*=yajilin]').click()`);
  await until("!document.querySelector('#solve').disabled");
  assert.ok((await evaluate(state)).detail.includes("yajilin-kit")); assert.ok(await evaluate(allStopped));
  assert.equal(await evaluate("document.querySelector('#numlin-options').hidden"), true);
  await evaluate(`document.querySelectorAll('.example[data-url*=numlin]')[0].click()`);
  await until("!document.querySelector('#solve').disabled");
  assert.equal((await evaluate(state)).label, "唯一解");
  console.log("PASS switch between DFS and other puzzles");
  await send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
  assert.ok(await evaluate("document.documentElement.scrollWidth <= innerWidth"));
  assert.ok(await evaluate("document.querySelector('#board svg').getBoundingClientRect().width <= document.querySelector('#board').clientWidth"));
  await evaluate("document.querySelector('[name=language][value=en]').click()");
  assert.ok(await evaluate("document.documentElement.scrollWidth <= innerWidth"));
  await evaluate("document.querySelector('[name=language][value=ja]').click()");
  await evaluate(`document.querySelectorAll('.example[data-url*=numlin]')[1].click();window.dispatchEvent(new Event('pagehide'))`);
  await until("!document.querySelector('#solve').disabled");
  assert.ok(await evaluate("window.testWorkers.filter(w=>w.testUrl.includes('/numlin/')).every(w=>w.testTerminated)"));
  console.log("PASS mobile layout and pagehide cleanup");

  await evaluate("document.querySelector('[name=language][value=en]').click()");
  assert.equal(await evaluate("localStorage.getItem('solver-lang')"), "en");
  await navigate("?lang=ja");
  assert.equal(await evaluate("document.documentElement.lang"), "ja");
  await navigate("", null);
  assert.equal(await evaluate("document.documentElement.lang"), "en");
  await navigate("?lang=invalid", null);
  assert.equal(await evaluate("document.documentElement.lang"), "en");
  for (const locale of ["ja-JP", "en-US"]) {
    const {identifier} = await send("Page.addScriptToEvaluateOnNewDocument", {source:`
      Object.defineProperty(navigator,'language',{value:${JSON.stringify(locale)}});
      Storage.prototype.getItem=function(){throw Error('Storage unavailable')};
      Storage.prototype.setItem=function(){throw Error('Storage unavailable')};
    `});
    await navigate("", null);
    assert.equal(await evaluate("document.documentElement.lang"), locale.slice(0,2));
    await evaluate(`document.querySelector('[name=language][value=${locale === "ja-JP" ? "en" : "ja"}]').click()`);
    assert.equal(await evaluate("document.documentElement.lang"), locale === "ja-JP" ? "en" : "ja");
    await send("Page.removeScriptToEvaluateOnNewDocument", {identifier});
  }
  console.log("PASS language precedence, persistence, navigator fallback and unavailable storage");

  // Auto engine by board size (<= 400 cells -> DFS, larger -> DFS and SAT in parallel), auto workers, settings panel behind the gear.
  await evaluate("localStorage.removeItem('numlin-engine'); localStorage.removeItem('numlin-threads')");
  await navigate("");
  const typeUrl = url => evaluate(`document.querySelector('#url').value=${JSON.stringify(url)}; document.querySelector('#url').dispatchEvent(new Event('input')); document.querySelector('#form').dataset.autoEngine`);
  assert.equal(await evaluate("document.querySelector('#form').elements.engine.value"), "auto");
  assert.equal(await evaluate("document.querySelector('#form').elements.threads.value"), "auto");
  assert.equal(await typeUrl("https://puzz.link/p?numlin/20/20/zz"), "dfs");
  assert.equal(await evaluate("document.querySelector('#numlin-settings').hidden"), false);
  assert.equal(await evaluate("document.querySelector('#numlin-options').hidden"), true);
  await evaluate("document.querySelector('#numlin-settings').click()");
  assert.equal(await evaluate("document.querySelector('#numlin-options').hidden"), false);
  assert.ok(["4","8"].includes(await evaluate("document.querySelector('#form').dataset.autoThreads")));
  assert.equal(await typeUrl("https://puzz.link/p?numlin/25/25/zz"), "portfolio");
  assert.equal(await typeUrl("https://puzz.link/p?numlin/15/15/zz"), "dfs");
  await chooseEngine("sat");
  assert.equal(await typeUrl("https://puzz.link/p?numlin/10/10/zz"), "sat");
  await evaluate("document.querySelector('#numlin-settings').click()");
  assert.equal(await evaluate("document.querySelector('#numlin-options').hidden"), true);
  await navigate("?engine=dfs");
  assert.equal(await typeUrl("https://puzz.link/p?numlin/36/20/zz"), "dfs");
  assert.equal(await evaluate("document.querySelector('#numlin-options').hidden"), false);
  await navigate("");
  assert.equal(await evaluate("document.querySelector('#form').elements.engine.value"), "dfs");
  console.log("PASS auto engine by board size, auto workers, gear toggles the settings panel, query override wins");
  assert.deepEqual(exceptions, []);
  console.log(JSON.stringify({ browser: version.Browser, node: process.version, status: "PASS" }));
} finally {
  ws?.close();
  if (chrome.exitCode === null && !chrome.signalCode) {
    const done = new Promise(resolve => chrome.once("exit", resolve));
    chrome.kill("SIGTERM"); await Promise.race([done, delay(5000)]);
    if (chrome.exitCode === null && !chrome.signalCode) chrome.kill("SIGKILL");
  }
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
