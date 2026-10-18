/**
 * componentize-js pre-evaluates module top-level under Wizer, where WASI
 * random is not callable. Two libraries touch randomness at import time:
 * zod (Math.random for cosmetic ids) and noble-curves (a getRandomValues
 * self-test). Both get a deterministic stand-in during the build snapshot;
 * `restoreRandom()` swaps the real sources back before any key material is
 * generated, on the first real export call.
 */
const realRandom = Math.random;
const cr = globalThis.crypto;
const realGetRandomValues = cr.getRandomValues.bind(cr);
let seed = 12345;
const next = () => (seed = (seed * 48271) % 2147483647);

Math.random = () => next() / 2147483647;
cr.getRandomValues = <T extends ArrayBufferView | null>(arr: T): T => {
  if (arr) {
    const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    for (let i = 0; i < bytes.length; i++) bytes[i] = next() & 0xff;
  }
  return arr;
};

let restored = false;
export function restoreRandom(): void {
  if (restored) return;
  restored = true;
  Math.random = realRandom;
  cr.getRandomValues = realGetRandomValues;
}
