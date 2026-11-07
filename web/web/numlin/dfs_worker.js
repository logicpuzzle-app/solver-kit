import createSolver from './dfs_solver.js';
const encoder = new TextEncoder();
const decoder = new TextDecoder();
let module;
function readReply(ptr) {
  // A call may grow memory: acquire the current heap after it returns.
  const heap = module.HEAPU8;
  const length = new DataView(heap.buffer).getUint32(ptr, true);
  const result = JSON.parse(decoder.decode(heap.subarray(ptr+4, ptr+4+length)));
  if (result.error) throw Error(result.error);
  return result;
}
function call(name, url, payload, budget) {
  if (name === 'dfs_resume') return readReply(Number.isInteger(budget) && budget > 0
    ? module._dfs_resume_budget(budget) : module._dfs_resume());
  const inputs = [encoder.encode(url), encoder.encode(JSON.stringify(payload))];
  const ptrs = [];
  try {
    for (const bytes of inputs) {
      const ptr = module._malloc(Math.max(1, bytes.length));
      if (!ptr) throw Error('wasm allocation failed');
      ptrs.push(ptr); module.HEAPU8.set(bytes, ptr);
    }
    return readReply(module[`_${name}`](ptrs[0], inputs[0].length, ptrs[1], inputs[1].length));
  } finally { for (const ptr of ptrs) module._free(ptr); }
}
try {
  module = await createSolver({
    locateFile: path => new URL(path, import.meta.url).href,
    print: line => postMessage({type: 'log', line}),
    printErr: line => postMessage({type: 'log', line}),
  });
  postMessage({type: 'ready', memory_bytes: module.HEAPU8.byteLength});
} catch (error) { postMessage({type: 'error', error: `Cannot load solver: ${error.message || error}`}); throw error; }
self.onmessage = ({data: m}) => {
  try {
    if (!['dfs', 'prepare', 'resume'].includes(m.type)) throw Error(`Unknown task: ${m.type}`);
    const result = call({dfs:'dfs_solve', prepare:'dfs_prepare', resume:'dfs_resume'}[m.type], m.url, m.options, m.budget);
    postMessage({type: m.type, token: m.token, ...result, memory_bytes: module.HEAPU8.byteLength});
  } catch (error) { postMessage({type: m.type, token: m.token, error: String(error.message || error), memory_bytes: module.HEAPU8.byteLength}); }
};
