// Race smaller boards immediately; preserve cube-only throughput on hard boards.
export const PLAIN_RACE_MAX_CELLS = 400;
export const PORTFOLIO = {layout: 'auto', plain_start: 'immediate'};
export const LAYOUTS = {A: {reserve: 0, plain: false}, B: {reserve: 1, plain: true}, C: {reserve: 0, plain: true}};
export const defaults = {
  layout: PORTFOLIO.layout, plain_start: PORTFOLIO.plain_start, measure_cube: false,
  threads: Math.min(globalThis.navigator?.hardwareConcurrency || 8, 8), max: 2,
  cubes: 64, balance: 4, balance_verify: 10, verify_min: 2, verify_floor: 1e6,
  score_k: 0, score_factor: 30, score_min_total: 1e8, score_rounds: 1, // score split rejected 2026-11-04: off by default
  probes: 100, cube_rules: 'strong', rules: 'wedge', full_cover: false,
  short_only: false, transform: 0, steal: true, steal_min: 20, parent_cutoff: 1, log_encoding: false,
};
export function header(url, o, name = 'numlin') {
  return `start ${name} SAT cube -j ${o.threads} --max ${o.max} --cubes ${o.cubes}` +
    ` --balance ${o.balance} --balance-verify ${o.balance_verify} --verify-min ${o.verify_min}` +
    ` --verify-floor ${o.verify_floor} --score ${o.score_k} --score-factor ${o.score_factor}` +
    ` --score-min-total ${o.score_min_total} --score-rounds ${o.score_rounds} --probes ${o.probes}` +
    ` --cube-rules ${o.cube_rules} --rules ${o.rules.replace('+', ',')} --transform ${o.transform}` +
    (o.full_cover ? ' --full-cover' : '') + (o.short_only ? ' --short-only' : '') +
    (o.log_encoding ? ' --log-encoding' : '') + ` --layout ${o.layout} --plain-start ${o.plain_start}` +
    (o.steal ? ` --steal-min ${o.steal_min} --parent-cutoff ${o.parent_cutoff}` : ' --no-steal') + ` ${url}`;
}
export function fingerprint(edges) {
  let hash = 0xcbf29ce484222325n;
  for (const [y, x, v] of edges) for (const n of [y, x, Number(v)]) {
    hash = BigInt.asUintN(64, (hash ^ (BigInt(n) + 1n)) * 0x1000000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}
const exp = n => Number(n || 0).toExponential(2);

export class Scheduler {
  constructor({url, options, name, workerFactory, now = () => performance.now(), onChange = () => {}, onLog = () => {}}) {
    this.url = url; this.o = {...defaults, ...options};
    this.o.layout = options?.portfolio ?? this.o.layout;
    if (this.o.layout === 'auto') {
      // Inspect dimensions only; malformed puzzles still follow the worker error path.
      const dimensions = url.match(/(?:^|\/)p\?numlin\/(\d+)\/(\d+)\//);
      const cells = dimensions ? Number(dimensions[1]) * Number(dimensions[2]) : 0;
      this.o.layout = cells > 0 && cells <= PLAIN_RACE_MAX_CELLS ? 'C' : 'A';
    }
    if (!LAYOUTS[this.o.layout]) throw Error('layout must be A, B or C');
    if (!['immediate', 'after_generation'].includes(this.o.plain_start)) throw Error('invalid plain_start');
    if (this.o.short_only) this.o.max = 1;
    this.name = name; this.workerFactory = workerFactory; this.now = now;
    this.onChange = onChange; this.onLog = onLog;
    this.slots = []; this.nodes = []; this.queue = []; this.logs = []; this.recent = [];
    this.phase = 'idle'; this.serial = 0; this.base = 0; this.found = 0;
    this.done = 0; this.steals = 0; this.cpu = 0; this.completedCPU = 0; this.wasted = 0;
    this.totalEst = 0; this.initialCubes = 0; this.genMs = 0; this.result = null; this.answer = null;
  }
  log(s) { this.logs.push(s); this.onLog(s); }
  elapsed() { return this.now() - this.started; }
  seconds() { return (this.elapsed()/1000).toFixed(0); }
  start() {
    if (this.phase !== 'idle') throw Error('scheduler already started');
    this.started = this.now(); this.phase = 'generating';
    this.log(header(this.url, this.o, this.name));
    const layout = LAYOUTS[this.o.layout];
    this.cubeThreads = Math.max(0, this.o.threads - layout.reserve);
    this.cubeFailed = this.cubeThreads === 0;
    if (!this.cubeThreads) this.phase = 'solving';
    if (layout.plain && (this.o.plain_start === 'immediate' || !this.cubeThreads)) this.startPlain();
    for (let i = 0; i < this.cubeThreads && this.active() && !this.cubeFailed; i++) {
      this.slots.push({id: i, epoch: 0, peak: 0, ready: false, job: null}); this.spawn(this.slots[i]);
    }
    this.onChange(this);
  }
  spawn(slot) {
    let worker;
    try { worker = this.workerFactory(slot.id); }
    catch (e) { this.sideError(slot, String(e.message || e)); return; }
    slot.worker = worker; slot.ready = false;
    const epoch = ++slot.epoch;
    worker.onmessage = ({data}) => {
      if (slot.epoch !== epoch || !this.active()) return;
      try { slot.plain ? this.plainMessage(slot, data) : this.message(slot, data); } catch (e) { this.sideError(slot, String(e.message || e)); }
    };
    worker.onerror = event => {
      event.preventDefault?.();
      if (slot.epoch === epoch && this.active()) this.sideError(slot, event.message || 'worker failed');
    };
  }
  startPlain() {
    if (this.plainSlot || !LAYOUTS[this.o.layout].plain || !this.active()) return;
    this.plainSlot = {id: 'plain', plain: true, epoch: 0, peak: 0, ready: false, job: null};
    this.log('[plain] started');
    this.spawn(this.plainSlot);
  }
  plainMessage(slot, data) {
    slot.peak = Math.max(slot.peak, data.memory_bytes || 0);
    if (data.type === 'log') { this.log(data.line); return; }
    if (data.type === 'error') { this.sideError(slot, data.error); return; }
    if (data.type === 'ready') {
      slot.ready = true;
      this.send(slot, 'solve', {cube: {edges: [], next: 0, est: 0}});
      this.onChange(this); return;
    }
    if (!slot.job || data.token !== slot.job.token) return;
    if (data.error) { this.sideError(slot, data.error); return; }
    if (!Number.isInteger(data.answers) || data.answers < 0 || data.answers > this.o.max) throw Error('invalid plain answer count');
    slot.job = null; slot.finished = true;
    this.plainMs = this.elapsed();
    this.log(`[plain] finished in ${(this.plainMs/1000).toFixed(1)} s (${data.answers} sol)`);
    this.cancel(slot, 'complete', false);
    this.verdict ??= {winner: 'plain', answers: data.answers, answer: data.answer ?? null, answerCube: 'plain', wall: this.plainMs};
    if (!this.o.measure_cube || this.cubeFailed) this.finish('complete', '', 'plain');
    else this.onChange(this);
  }
  sideError(slot, error) {
    if (!this.active()) return;
    if (slot.plain) {
      this.plainError = error; slot.failed = true;
      this.log(`[plain] error: ${error}; continuing cubes`);
      this.cancel(slot, 'error', false);
    } else {
      this.cubeError = error; this.cubeFailed = true; this.phase = 'solving';
      this.log(`[cubes] error: ${error}; continuing plain`);
      for (const s of this.slots) this.cancel(s, 'error', false);
      this.startPlain();
    }
    if (this.verdict) this.finish('complete', '', this.verdict.winner);
    else if (this.cubeFailed && (!this.plainSlot || this.plainSlot.failed)) this.finish('error', [this.cubeError, this.plainError].filter(Boolean).join('; '));
    else this.onChange(this);
  }
  active() { return this.phase === 'generating' || this.phase === 'solving'; }
  send(slot, type, node = null) {
    const token = ++this.serial;
    slot.job = {type, id: node?.id, token, started: this.now()};
    slot.worker.postMessage({type, token, url: this.url, options: this.o, cube: node?.cube, max: this.o.max, min_tasks: 2});
  }
  message(slot, data) {
    slot.peak = Math.max(slot.peak, data.memory_bytes || 0);
    if (data.type === 'log') { this.log(data.line); return; }
    if (data.type === 'error') { this.sideError(slot, data.error); return; }
    if (data.type === 'ready') {
      slot.ready = true;
      if (this.phase === 'generating' && slot.id === 0 && !slot.job) this.send(slot, 'cubes');
      else this.pump();
      this.onChange(this); return;
    }
    const job = slot.job;
    if (!job || data.token !== job.token) return;
    slot.job = null;
    if (data.error) { this.sideError(slot, data.error); return; }
    if (!this.answer && data.answer) {
      this.answer = data.answer; this.answerCube = job.id ?? 'generation';
      this.log(`[answer] first answer from ${job.id === undefined ? 'cube generation' : `cube ${job.id}`}`);
    }
    if (job.type === 'cubes') {
      this.genMs = data.gen_ms; this.base = data.extra_solutions || 0;
      this.totalEst = data.total_est; this.initialCubes = data.cubes.length;
      for (const cube of data.cubes) this.queue.push(this.addNode(cube));
      this.queue.sort((a,b) => this.nodes[b].cube.est - this.nodes[a].cube.est);
      this.log(`cubes: ${this.initialCubes} (generated in ${(this.genMs/1000).toFixed(3)}s)`);
      if (this.base) this.log(`solutions completed while splitting: ${this.base}`);
      const largest = this.nodes[0]?.cube.est || 0;
      this.log(`total est ${exp(this.totalEst)}, largest cube ${exp(largest)} (${(100*largest/(this.totalEst || 1)).toFixed(1)}%)`);
      this.phase = 'solving';
      if (this.o.plain_start === 'after_generation') this.startPlain();
    } else if (job.type === 'solve') {
      const node = this.nodes[job.id];
      node.spentMs = (node.spentMs || 0) + data.elapsed_ms;
      this.cpu += data.elapsed_ms; this.completedCPU += data.elapsed_ms; this.done++;
      this.recent.unshift({id: node.id, answers: data.answers, elapsed_ms: data.elapsed_ms});
      this.recent.length = Math.min(20, this.recent.length);
      if (this.live(node.id)) {
        this.log(`[progress] cube ${node.id} (depth ${node.depth}, est ${exp(node.cube.est)}, parent ${node.parent ?? '-'}) done in ${(data.elapsed_ms/1000).toFixed(1)}s (${data.answers} sol) -> ${this.done}/${this.nodes.length} cubes, elapsed ${this.seconds()}s`);
        this.complete(node.id, data.answers);
      }
    } else if (job.type === 'split') {
      const node = this.nodes[job.id];
      if (this.live(node.id)) {
        this.steals++;
        this.log(`[steal] worker ${slot.id} split running cube ${node.id} (depth ${node.depth}, est ${exp(node.cube.est)}, running ${((this.now()-node.started)/1000).toFixed(1)}s) -> ${data.cubes.length} parts, queue ${this.queue.length + data.cubes.length}, elapsed ${this.seconds()}s`);
        if (data.unsplittable) {
          // The original remains authoritative; do not solve an identical copy.
        } else {
          node.remaining = data.cubes.length;
          const ids = data.cubes.map(c => this.addNode(c, node.id));
          node.children.push(...ids);
          this.queue.unshift(...ids.sort((a,b) => this.nodes[b].cube.est - this.nodes[a].cube.est));
          if (data.extra_solutions) {
            const id = this.addNode({edges: [], next: 0, est: 0}, node.id, true);
            Object.assign(this.nodes[id], {resolved: true, answers: data.extra_solutions});
            node.children.push(id);
          }
          if (!node.remaining) this.complete(node.id, data.extra_solutions || 0);
        }
      }
    }
    this.recount(); this.pump(); this.onChange(this);
  }
  addNode(cube, parent = null, synthetic = false) {
    const id = this.nodes.length;
    this.nodes.push({id, cube, parent, synthetic, depth: parent === null ? 0 : this.nodes[parent].depth+1,
      children: [], remaining: 0, split: false, resolved: false, answers: 0, started: null});
    return id;
  }
  ancestorResolved(id) {
    for (let p = this.nodes[id].parent; p !== null; p = this.nodes[p].parent) if (this.nodes[p].resolved) return true;
    return false;
  }
  live(id) { return !this.nodes[id].resolved && !this.ancestorResolved(id); }
  below(id, ancestor) {
    for (let p = id; p !== null; p = this.nodes[p].parent) if (p === ancestor) return true;
    return false;
  }
  cancel(slot, reason, respawn = true) {
    const job = slot.job;
    if (slot.plain && !slot.finished && !slot.failed && !slot.cancelled) {
      this.log('[plain] cancelled'); slot.cancelled = true;
    }
    if (!slot.plain && job?.type === 'solve') {
      const ms = this.now()-job.started;
      this.cpu += ms; this.wasted += ms;
      const n = this.nodes[job.id];
      n.spentMs = (n.spentMs || 0) + ms;
      this.log(`[progress] cube ${n.id} (depth ${n.depth}) interrupted after ${(ms/1000).toFixed(1)}s (${reason}), elapsed ${this.seconds()}s`);
    }
    slot.worker?.terminate(); slot.epoch++; slot.job = null; slot.ready = false;
    if (respawn && this.active()) this.spawn(slot);
  }
  complete(id, answers) {
    if (!this.live(id)) return;
    const node = this.nodes[id]; node.resolved = true; node.answers = answers;
    for (const slot of this.slots) if (slot.job && slot.job.id !== undefined && this.below(slot.job.id, id)) {
      this.cancel(slot, slot.job.id === id ? 'settled by its parts' : 'settled by its ancestor');
    }
    if (node.parent !== null) {
      const parent = this.nodes[node.parent];
      if (!parent.resolved && --parent.remaining === 0) this.complete(parent.id, parent.children.reduce((n,c) => n+this.nodes[c].answers, 0));
    }
  }
  recount() {
    this.found = this.base;
    for (const node of this.nodes) if (node.resolved && !this.ancestorResolved(node.id)) this.found += node.answers;
  }
  pump() {
    if (this.phase !== 'solving' || this.cubeFailed) return;
    this.recount();
    if (this.found >= this.o.max) { this.finish('complete'); return; }
    this.queue = this.queue.filter(id => this.live(id));
    for (const slot of this.slots) {
      if (!slot.ready || slot.job) continue;
      const id = this.queue.shift();
      if (id !== undefined) {
        const n = this.nodes[id]; n.started = this.now();
        this.log(`[start] worker ${slot.id} cube ${id} (depth ${n.depth}, est ${exp(n.cube.est)}, parent ${n.parent ?? '-'}, fp ${fingerprint(n.cube.edges)}, fixed ${n.cube.edges.length}), elapsed ${this.seconds()}s`);
        this.send(slot, 'solve', n);
      } else if (this.o.steal) {
        const running = this.slots.filter(s => s.job?.type === 'solve').map(s => this.nodes[s.job.id]);
        const victim = running.filter(n => this.live(n.id) && !n.split && (this.now()-n.started)/1000 >= this.o.steal_min)
          .sort((a,b) => a.started-b.started || b.cube.est-a.cube.est)[0];
        if (victim) { victim.split = true; this.send(slot, 'split', victim); }
      }
    }
    if (!this.queue.length && !this.slots.some(s => s.job) && this.nodes.every(n => !this.live(n.id))) this.finish('complete');
  }
  // Parent cutoff (same rule as the native driver): a stolen parent is interrupted once its
  // children's busy time (finished + running) exceeds parent_cutoff x the parent's own running time.
  parentCutoff() {
    if (this.cubeFailed) return;
    const f = Number(this.o.parent_cutoff) || 0;
    if (!(f > 0)) return;
    for (const slot of this.slots) {
      const job = slot.job;
      if (!job || job.type !== 'solve') continue;
      const node = this.nodes[job.id];
      if (!node || !node.split || !node.children.length || !this.live(node.id)) continue;
      const own = this.now() - job.started;
      let kids = 0;
      for (const c of node.children) {
        const child = this.nodes[c];
        const running = this.slots.find(x => x.job && x.job.type === 'solve' && x.job.id === c);
        kids += running ? this.now() - running.job.started : (child.spentMs || 0);
      }
      if (kids > f * own) {
        this.cutoffs = (this.cutoffs || 0) + 1;
        this.log(`[cutoff] cube ${node.id} (depth ${node.depth}) running ${(own/1000).toFixed(0)}s, its ${node.children.length} children busy ${(kids/1000).toFixed(0)}s > ${f}x -> parent interrupted, elapsed ${this.seconds()}s`);
        this.cancel(slot, 'parent cutoff: children busier');
      }
    }
  }
  tick() { if (this.active()) { this.parentCutoff(); this.pump(); this.onChange(this); } }
  stop() { if (this.active()) this.finish('stopped'); }
  finish(status, error = '', side = 'cubes') {
    if (!this.active()) return;
    this.recount();
    if (status === 'complete' && side === 'cubes') {
      this.cubeMs = this.elapsed();
      this.verdict ??= {winner: 'cubes', answers: Math.min(this.found, this.o.max), answer: this.answer, answerCube: this.answerCube, wall: this.cubeMs};
    }
    const wall = status === 'complete' ? this.verdict.wall : this.elapsed();
    for (const slot of this.slots) this.cancel(slot, status === 'complete' ? 'answer limit reached' : status, false);
    if (this.plainSlot) this.cancel(this.plainSlot, status, false);
    this.phase = status;
    const answers = status === 'complete' ? this.verdict.answers : Math.min(this.found, this.o.max);
    if (status === 'complete') { this.answer = this.verdict.answer; this.answerCube = this.verdict.answerCube; }
    this.result = {status, error, answers, winner: status === 'complete' ? this.verdict.winner : null,
      cube_workers: this.cubeThreads ?? this.slots.length, worker_count: this.slots.length + (this.plainSlot ? 1 : 0),
      plain_ms: this.plainMs ?? null, cube_ms: this.cubeMs ?? null, measurement_ms: this.elapsed(),
      plain_error: this.plainError ?? null, cube_error: this.cubeError ?? null, answer:this.answer, answer_cube:this.answerCube ?? null, max_answers: this.o.max, wall_ms: wall, cpu_ms: this.cpu,
      completed_cpu_ms: this.completedCPU, interrupted_ms: this.wasted,
      gen_ms: this.genMs, cubes: this.initialCubes, total_nodes: this.nodes.length,
      solved: this.done, steals: this.steals, cutoffs: this.cutoffs || 0, total_est: this.totalEst,
      worker_memory_bytes: [...this.slots, ...(this.plainSlot ? [this.plainSlot] : [])].map(s => s.peak), options: this.o, url: this.url};
    if (status === 'complete') {
      this.log(`solutions (up to ${this.o.max}): ${answers}`);
      this.log(`cubes solved: ${this.done} (steals: ${this.steals}, overrun splits: 0, budget re-splits: 0, total nodes: ${this.nodes.length}, discarded cpu: ${(this.wasted/1000).toFixed(3)}s)`);
      this.log(`total cpu (sum of cube times): ${(this.cpu/1000).toFixed(3)}s`);
      this.log(`elapsed: ${(wall/1000).toFixed(3)}s`); this.log(`threads: ${this.o.threads}`);
      this.log(`rc=${answers > 0 ? 0 : 1} ${new Date().toISOString()}`);
    } else this.log(`[${status}] ${error || 'Stopped by user'}; elapsed ${(wall/1000).toFixed(3)}s`);
    this.onChange(this);
  }
  // Weight of a node in the live total: a split node is represented by its children (their
  // fresh estimates replace the parent's), a leaf by its own estimate.
  weight(id) {
    const n = this.nodes[id];
    if (n.split && n.children.length) return n.children.reduce((s,c) => s+this.weight(c), 0);
    return n.cube.est;
  }
  // Live total: the initial total with every split parent replaced by its children's sum.
  liveTotal() {
    return this.nodes.filter(n => n.parent === null).reduce((s,n) => s+this.weight(n.id), 0);
  }
  workDone() {
    return this.nodes.filter(n => n.resolved && !this.ancestorResolved(n.id)).reduce((s,n) => s+this.weight(n.id), 0);
  }
}
