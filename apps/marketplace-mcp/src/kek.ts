import { fromB64, fromUtf8, openSymmetric, sealSymmetric, utf8 } from "@atm/crypto";
import { env } from "./env.js";

let kekBytes: Uint8Array | undefined;
function kek(): Uint8Array {
  if (!kekBytes) {
    kekBytes = fromB64(env().SERVER_KEK_B64);
    if (kekBytes.length !== 32) throw new Error("SERVER_KEK_B64 must decode to 32 bytes");
  }
  return kekBytes;
}

/** Encrypt a JSON value at rest under the server KEK. */
export function kekSeal(value: unknown): string {
  return sealSymmetric(kek(), utf8(JSON.stringify(value)));
}

export function kekOpen<T>(blob: string): T {
  return JSON.parse(fromUtf8(openSymmetric(kek(), blob))) as T;
}
