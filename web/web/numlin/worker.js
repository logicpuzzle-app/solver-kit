import createSolver from './cspuz_solver_backend.js';
const encoder = new TextEncoder();
const decoder = new TextDecoder();
let module;
function call(name, url, payload, ...numbers) {
  const inputs = [encoder.encode(url), encoder.encode(JSON.stringify(payload))];
  const ptrs = [];
  try {
    for (const bytes of inputs) {
      const ptr = module._malloc(Math.max(1, bytes.length));
      if (!ptr) throw Error('wasm allocation failed');
      ptrs.push(ptr); module.HEAPU8.set(bytes, ptr);
    }
    const ptr = module[`_${name}`](ptrs[0], inputs[0].length, ptrs[1], inputs[1].length, ...numbers);
    // A call may grow memory: acquire the current heap after it returns.
    const heap = module.HEAPU8;
    const length = new DataView(heap.buffer).getUint32(ptr, true);
    const result = JSON.parse(decoder.decode(heap.subarray(ptr+4, ptr+4+length)));
    if (result.error) throw Error(result.error);
    return result;
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
    const cube = {...m.cube, options: m.options};
    let result;
    switch (m.type) {
      case 'cubes': result = call('numlin_cubes', m.url, m.options); break;
      // An empty edges array with next=0 is the unrestricted root, with these same options.
      case 'solve': result = call('numlin_solve_cube', m.url, cube, m.max); break;
      case 'split': result = call('numlin_split_cube', m.url, cube, m.min_tasks); break;
      case 'estimate': result = call('numlin_estimate_cube', m.url, cube, m.probes, m.seed); break;
      default: throw Error(`Unknown task: ${m.type}`);
    }
    postMessage({type: m.type, token: m.token, ...result, memory_bytes: module.HEAPU8.byteLength});
  } catch (error) { postMessage({type: m.type, token: m.token, error: String(error.message || error), memory_bytes: module.HEAPU8.byteLength}); }
};
