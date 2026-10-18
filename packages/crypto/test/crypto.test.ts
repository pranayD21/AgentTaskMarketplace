import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  commitment,
  generateKeypair,
  keyDescriptor,
  keyIdFor,
  keypairFromSecretB64,
  open,
  openJson,
  publicKeyFromB64,
  seal,
  sealJson,
  toB64,
  utf8,
} from "../src/index.ts";

describe("envelope", () => {
  it("round-trips plaintext to the intended recipient", () => {
    const seller = generateKeypair();
    const env = sealJson(keyDescriptor("seller-1", seller.publicKey), { prompt: "hi", context: "x" });
    expect(env.alg).toBe("x25519-hkdf-xchacha20poly1305-v1");
    expect(env.recipient_key_id).toBe("seller-1");
    expect(openJson(seller, env)).toEqual({ prompt: "hi", context: "x" });
  });

  it("fails for the wrong recipient key", () => {
    const seller = generateKeypair();
    const other = generateKeypair();
    const env = seal(keyDescriptor("seller-1", seller.publicKey), utf8("secret"));
    expect(() => open(other, env)).toThrow();
  });

  it("fails on tampered ciphertext", () => {
    const seller = generateKeypair();
    const env = seal(keyDescriptor("seller-1", seller.publicKey), utf8("secret"));
    const ct = Buffer.from(env.ct_b64, "base64");
    ct[0] = ct[0]! ^ 0xff;
    expect(() => open(seller, { ...env, ct_b64: ct.toString("base64") })).toThrow();
  });

  it("restores a keypair from its secret", () => {
    const kp = generateKeypair();
    const again = keypairFromSecretB64(toB64(kp.secretKey));
    expect(toB64(again.publicKey)).toBe(toB64(kp.publicKey));
    expect(keyIdFor(kp.publicKey)).toHaveLength(16);
  });
});

describe("commitment", () => {
  it("is independent of key order and undefined fields", () => {
    const a = commitment({ answer: "42", task_id: "t", claim_id: "c", salt_b64: "s", model_id: "m" });
    const b = commitment({ salt_b64: "s", model_id: "m", claim_id: "c", task_id: "t", answer: "42", extra: undefined });
    expect(a.sha256_hex).toBe(b.sha256_hex);
    expect(a.sha256_hex).toMatch(/^[0-9a-f]{64}$/);
  });

  it("canonicalises nested objects", () => {
    expect(canonicalJson({ b: [{ z: 1, a: 2 }], a: null })).toBe('{"a":null,"b":[{"a":2,"z":1}]}');
  });
});

describe("publicKeyFromB64", () => {
  it("accepts a 32-byte X25519 key and rejects anything else", () => {
    const kp = generateKeypair();
    expect(publicKeyFromB64(toB64(kp.publicKey))).toEqual(kp.publicKey);
    expect(() => publicKeyFromB64(toB64(new Uint8Array(31)))).toThrow(/32 bytes/);
    expect(() => publicKeyFromB64("not base64 at all!!")).toThrow(/base64/);
  });
});
