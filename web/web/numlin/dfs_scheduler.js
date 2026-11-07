export const dfsDefaults = {direction: 'race', cut: 0, diag_shortcut: false, memo_bits: 24};

export function directionQueue(direction, recommended) {
  if (!Number.isInteger(recommended) || recommended < 0 || recommended > 7) throw Error('Invalid recommended direction');
  if (direction === 'all' || direction === 'race') return [recommended, ...Array.from({length:8}, (_,d) => d).filter(d => d !== recommended)];
  if (direction === 'recommended' || direction === '-1' || direction === -1) return [recommended];
  const d = Number(direction);
  if (!/^[0-7]$/.test(String(direction))) throw Error('Direction must be race, recommended, all, or 0..7');
  return [d];
}

export function pickRaceDirection(reports, recommended) {
  return [...reports].sort((a, b) => {
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    const av = a.finished ? a.steps : a.est_total ?? Infinity;
    const bv = b.finished ? b.steps : b.est_total ?? Infinity;
    if (av !== bv) return av < bv ? -1 : 1;
    return Number(b.direction === recommended) - Number(a.direction === recommended) || a.direction - b.direction;
  })[0];
}

export class DFSScheduler {
  constructor({url, options, workerFactory, now = () => performance.now(), onChange = () => {}, onLog = () => {}}) {
    this.url = url; this.o = {threads:1, ...dfsDefaults, ...options}; this.engine = 'dfs';
    this.workerFactory = workerFactory; this.now = now; this.onChange = onChange; this.onLog = onLog;
    this.phase = 'idle'; this.slots = []; this.logs = []; this.recent = []; this.queue = [];
    this.serial = 0; this.done = 0; this.startedDirections = 0; this.cpu = 0; this.result = null;
    this.isRace = this.o.direction === 'race'; this.raceStage = this.isRace ? 'race' : null;
    this.race = this.isRace ? {budget:null, picks:[], directions:[]} : null;
  }
  active() { return this.phase === 'generating' || this.phase === 'solving'; }
  elapsed() { return this.now()-this.started; }
  progress() { return this.continuation?.report?.progress ?? null; }
  estTotal() { return this.continuation?.report?.est_total ?? null; }
  log(line) { this.logs.push(line); this.onLog(line); }
  start() {
    if (this.phase !== 'idle') throw Error('scheduler already started');
    this.started = this.now(); this.phase = 'generating';
    directionQueue(this.o.direction, 0); // Validate before allocating workers.
    if (!Number.isInteger(this.o.threads) || this.o.threads < 1 || this.o.threads > 64) throw Error('Workers must be 1..64');
    if (!Number.isInteger(this.o.memo_bits) || this.o.memo_bits < 0 || this.o.memo_bits > 27) throw Error('Memo bits must be 0..27');
    this.limit = this.isRace || this.o.direction === 'all' ? Math.min(this.o.threads, 8) : 1;
    this.log(`start ${new Date().toISOString()} ${this.url} clean-room row-scan DFS (rowscan_dfs, MIT) --direction ${this.o.direction}` +
      (this.o.cut ? ` --cut ${this.o.cut}` : '') + (this.o.diag_shortcut ? ' --diag-shortcut' : '') +
      ` workers ${this.limit} --memo-bits ${this.o.memo_bits}`);
    for (let id=0; id<this.limit; id++) this.createSlot();
    this.onChange(this);
  }
  createSlot(raceDirection) {
    const slot = {id:this.slots.length, ready:false, job:null, peak:0, computeMs:0, raceDirection}; this.slots.push(slot);
    const worker = this.workerFactory(slot.id); slot.worker = worker;
    worker.onmessage = ({data}) => {
      if (!this.active() || slot.terminated) return;
      try { this.message(slot, data); } catch (e) { this.finish('error', String(e.message || e)); }
    };
    worker.onerror = e => { e.preventDefault?.(); if (this.active() && !slot.terminated) this.finish('error', e.message || 'clean-room row-scan DFS (rowscan_dfs, MIT) worker failed'); };
  }
  send(slot, type, direction, budget) {
    const token = ++this.serial;
    slot.job = {type, token, direction, started:this.now()};
    const options = {direction:direction ?? -1, cut:this.o.cut, diag_shortcut:this.o.diag_shortcut, memo_bits:this.o.memo_bits};
    if (this.isRace && type === 'dfs') options.race_budget = 1;
    slot.worker.postMessage({type, token, url:this.url, options, ...(budget === undefined ? {} : {budget})});
    if (type === 'dfs') this.startedDirections++;
  }
  message(slot, data) {
    slot.peak = Math.max(slot.peak, data.memory_bytes || 0);
    if (data.type === 'log') { this.log(data.line); return; }
    if (data.type === 'error') { this.finish('error', data.error); return; }
    if (data.type === 'ready') {
      if (slot.ready) return;
      slot.ready = true;
      if (slot.id === 0 && this.phase === 'generating') this.send(slot, 'prepare');
      else this.pump();
      this.onChange(this); return;
    }
    const job = slot.job;
    if (!job || data.token !== job.token || data.type !== job.type) return;
    slot.job = null;
    if (data.error) { this.finish('error', data.error); return; }
    if (job.type === 'prepare') {
      this.recommended = data.recommended;
      this.queue = directionQueue(this.o.direction, this.recommended);
      this.log(`recommended direction: ${this.recommended}`);
      if (this.isRace) {
        this.raceStarted = this.now();
        for (const candidate of this.slots) candidate.raceDirection = this.queue.shift();
      }
      this.phase = 'solving'; this.pump(); this.onChange(this);
    } else {
      // Resume reports cumulative compute time, including its earlier race run.
      this.cpu += data.elapsed_ms - slot.computeMs; slot.computeMs = data.elapsed_ms;
      if (this.isRace && job.type === 'dfs') {
        const {type, token, memory_bytes, ...report} = data;
        slot.raceReport = report; this.done++;
        this.race.budget = report.race_budget;
        this.race.directions.push(report); this.race.directions.sort((a,b) => a.direction-b.direction);
        this.log(`[race] direction ${report.direction}: steps ${report.steps} progress ${report.progress} est ${report.est_total ?? 'inf'}` +
          (report.direction === this.recommended ? ' (recommended)' : ''));
        if (this.done === 8) this.selectRace();
        else this.pump();
        this.onChange(this);
      } else {
        if (!this.isRace) this.done++;
        if (this.continuation) {
          const c = this.continuation;
          c.report = data;
          c.elapsed_ms = data.elapsed_ms - slot.raceReport.elapsed_ms;
          c.slices++;
          const wall = this.now()-job.started;
          if (wall < 250) c.budget = Math.min(50000000, c.budget*2);
          else if (wall > 1000) c.budget = Math.max(100000, Math.floor(c.budget/2));
          if (!data.finished) {
            if (this.now()-c.lastLog >= 10000) {
              this.log(`[dfs] direction ${data.direction}: steps ${data.steps} progress ${data.progress} est ${data.est_total ?? 'inf'} elapsed ${(data.elapsed_ms/1000).toFixed(6)} s`);
              c.lastLog = this.now();
            }
            this.onChange(this);
            if (this.active()) this.send(slot, 'resume', c.direction, c.budget);
            return;
          }
        }
        this.complete(data);
      }
    }
  }
  selectRace() {
    const winner = pickRaceDirection(this.race.directions, this.recommended);
    const slot = this.slots.find(s => s.raceDirection === winner.direction);
    this.race.elapsed_ms = this.now()-this.raceStarted;
    this.race.picks = [winner.direction];
    this.answer = winner.answer; this.answerSolutions = winner.solutions;
    this.log(`[race] budget ${this.race.budget} x 8 directions in ${(this.race.elapsed_ms/1000).toFixed(6)} s -> pick direction ${winner.direction} (est ${winner.est_total ?? 'inf'}, recommended ${this.recommended})`);
    for (const other of this.slots) if (other !== slot) this.terminate(other);
    if (winner.finished) { this.complete(winner); return; }
    this.raceStage = 'continuation';
    const budget = Number.isInteger(this.o.slice_steps) && this.o.slice_steps > 0
      ? this.o.slice_steps : Math.max(this.race.budget, 200000);
    this.continuation = {worker:slot.id, direction:winner.direction, started:this.now(),
      lastLog:this.now(), slices:0, budget};
    this.send(slot, 'resume', winner.direction, budget);
  }
  complete(data) {
    this.recent.unshift({id:`dir ${data.direction}`, answers:data.solutions, elapsed_ms:data.elapsed_ms});
    this.log(`[dfs] direction ${data.direction}: steps ${data.steps} solutions ${data.solutions} elapsed ${(data.elapsed_ms/1000).toFixed(6)} s`);
    this.answer = data.answer; this.answerSolutions = data.solutions;
    this.winner = data; this.finish('complete');
  }
  pump() {
    if (this.phase !== 'solving') return;
    if (this.isRace) {
      if (this.raceStage !== 'race') return;
      for (const slot of this.slots) {
        if (slot.ready && !slot.job && !slot.raceReport) this.send(slot, 'dfs', slot.raceDirection);
      }
      // Paused workers must retain their own wasm instance until selection.
      while (this.queue.length && this.slots.filter(s => !s.raceReport).length < this.limit) this.createSlot(this.queue.shift());
    } else {
      for (const slot of this.slots) {
        if (slot.ready && !slot.job && this.queue.length) this.send(slot, 'dfs', this.queue.shift());
      }
    }
  }
  tick() { if (this.active()) this.onChange(this); }
  stop() { if (this.active()) this.finish('stopped'); }
  terminate(slot) { slot.worker?.terminate(); slot.job = null; slot.ready = false; slot.terminated = true; }
  finish(status, error = '') {
    if (!this.active()) return;
    const wall = this.elapsed();
    for (const slot of this.slots) {
      if (['dfs', 'resume'].includes(slot.job?.type)) this.cpu += this.now()-slot.job.started;
      this.terminate(slot);
    }
    if (this.continuation && this.continuation.elapsed_ms === undefined) this.continuation.elapsed_ms = this.now()-this.continuation.started;
    this.phase = status;
    const {type, token, memory_bytes, ...winner} = this.winner || {};
    this.result = {...winner, answer:winner.answer ?? this.answer ?? null, engine:'dfs', status, error, answers:winner.solutions ?? 0,
      wall_ms:wall, cpu_ms:this.cpu, solved:this.done, started_directions:this.startedDirections,
      worker_memory_bytes:this.slots.map(s => s.peak), options:this.o, url:this.url,
      ...(this.isRace ? {race:this.race} : {})};
    if (status === 'complete') {
      this.log(`direction: ${winner.direction}`); this.log(`steps: ${winner.steps}`);
      this.log(`solutions: ${winner.solutions}`);
      this.log(`first solution has empty cells: ${winner.first_has_empty === null ? 'n/a' : winner.first_has_empty ? 'yes' : 'no'}`);
      this.log(`elapsed: ${((this.isRace ? wall : winner.elapsed_ms)/1000).toFixed(6)} s`);
      this.log('rc=0');
    } else this.log(`[${status}] ${error || 'Stopped by user'}; elapsed ${(wall/1000).toFixed(3)} s`);
    this.onChange(this);
  }
}
