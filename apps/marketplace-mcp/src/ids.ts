import { bytesToHex, randomBytes } from "@noble/hashes/utils.js";

export function newId(prefix: string): string {
  return `${prefix}_${bytesToHex(randomBytes(8))}`;
}

/** API keys look like atm_sk_<43 base64url chars>; only their sha256 is stored. */
export function newApiKey(): string {
  return `atm_sk_${Buffer.from(randomBytes(32)).toString("base64url")}`;
}
