/**
 * Sealed envelopes for the marketplace.
 *
 * ECIES-style: ephemeral X25519 -> HKDF-SHA256 -> XChaCha20-Poly1305.
 * Pure JS (noble) so the identical code runs in Node and inside the
 * componentize-js Wasm runner, where SubtleCrypto lacks X25519/AEAD.
 *
 * Only `globalThis.crypto.getRandomValues`, `btoa`/`atob` and TextEncoder
 * are required from the host.
 */
import { x25519 } from "@noble/curves/ed25519.js";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, randomBytes } from "@noble/hashes/utils.js";
import { ENVELOPE_ALG, type Envelope, type KeyDescriptor } from "@atm/shared";

const HKDF_INFO = new TextEncoder().encode("atm-envelope-v1");
const NONCE_BYTES = 24;

// ---------------------------------------------------------------------------
// base64 helpers that work in Node and StarlingMonkey
// ---------------------------------------------------------------------------

export function toB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

export function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export function fromUtf8(b: Uint8Array): string {
  return new TextDecoder().decode(b);
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

export interface Keypair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

export function generateKeypair(): Keypair {
  const secretKey = x25519.utils.randomSecretKey();
  const publicKey = x25519.getPublicKey(secretKey);
  return { publicKey, secretKey };
}

export function keypairFromSecretB64(secretB64: string): Keypair {
  const secretKey = fromB64(secretB64);
  if (secretKey.length !== 32) throw new Error("secret key must be 32 bytes");
  return { secretKey, publicKey: x25519.getPublicKey(secretKey) };
}

export function keyDescriptor(keyId: string, publicKey: Uint8Array): KeyDescriptor {
  return { key_id: keyId, public_key_b64: toB64(publicKey) };
}

/** Stable id for a public key: first 16 hex chars of sha256(pubkey). */
export function keyIdFor(publicKey: Uint8Array): string {
  return bytesToHex(sha256(publicKey)).slice(0, 16);
}

// ---------------------------------------------------------------------------
// Envelopes
// ---------------------------------------------------------------------------

function deriveKey(shared: Uint8Array, epk: Uint8Array, recipientPub: Uint8Array): Uint8Array {
  const salt = new Uint8Array(epk.length + recipientPub.length);
  salt.set(epk, 0);
  salt.set(recipientPub, epk.length);
  return hkdf(sha256, shared, salt, HKDF_INFO, 32);
}

export function seal(recipient: KeyDescriptor, plaintext: Uint8Array): Envelope {
  const recipientPub = fromB64(recipient.public_key_b64);
  if (recipientPub.length !== 32) throw new Error("recipient public key must be 32 bytes");
  const eph = generateKeypair();
  const shared = x25519.getSharedSecret(eph.secretKey, recipientPub);
  const key = deriveKey(shared, eph.publicKey, recipientPub);
  const nonce = randomBytes(NONCE_BYTES);
  const ct = xchacha20poly1305(key, nonce).encrypt(plaintext);
  return {
    alg: ENVELOPE_ALG,
    recipient_key_id: recipient.key_id,
    epk_b64: toB64(eph.publicKey),
    nonce_b64: toB64(nonce),
    ct_b64: toB64(ct),
  };
}

export function sealJson(recipient: KeyDescriptor, value: unknown): Envelope {
  return seal(recipient, utf8(JSON.stringify(value)));
}

/** Throws on wrong key, tampering, or unsupported algorithm. */
export function open(recipient: Keypair, env: Envelope): Uint8Array {
  if (env.alg !== ENVELOPE_ALG) throw new Error(`unsupported envelope alg: ${env.alg}`);
  const epk = fromB64(env.epk_b64);
  const nonce = fromB64(env.nonce_b64);
  const ct = fromB64(env.ct_b64);
  const shared = x25519.getSharedSecret(recipient.secretKey, epk);
  const key = deriveKey(shared, epk, recipient.publicKey);
  return xchacha20poly1305(key, nonce).decrypt(ct);
}

export function openJson<T = unknown>(recipient: Keypair, env: Envelope): T {
  return JSON.parse(fromUtf8(open(recipient, env))) as T;
}

// ---------------------------------------------------------------------------
// Canonical JSON (RFC 8785 subset: sorted keys, no whitespace) and commitments
// ---------------------------------------------------------------------------

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[k];
      if (v !== undefined) out[k] = sortKeys(v);
    }
    return out;
  }
  return value;
}

export function sha256Hex(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes));
}

/** Commitment over the canonical result bytes; buyer and judge both recompute it. */
export function commitment(result: unknown): { bytes: Uint8Array; sha256_hex: string } {
  const bytes = utf8(canonicalJson(result));
  return { bytes, sha256_hex: sha256Hex(bytes) };
}

export function randomB64(n = 32): string {
  return toB64(randomBytes(n));
}
