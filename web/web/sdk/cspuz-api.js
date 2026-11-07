const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function callCspuz(module, name, url, max = 2) {
  const bytes = encoder.encode(url);
  const input = module._malloc(Math.max(1, bytes.length));
  if (!input) throw Error("wasm allocation failed");
  try {
    module.HEAPU8.set(bytes, input);
    const output = module[name](input, bytes.length, max);
    // The backend owns the shared output buffer; memory may grow during the call.
    const heap = module.HEAPU8;
    const length = new DataView(heap.buffer).getUint32(output, true);
    return JSON.parse(decoder.decode(heap.subarray(output + 4, output + 4 + length)));
  } finally {
    module._free(input);
  }
}
