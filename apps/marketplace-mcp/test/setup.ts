// Runs before each test file: an in-memory database, mock payments, no Inkbox,
// and a throwaway judge keypair. Nothing here reaches the network.
import { generateKeypair, keyIdFor, toB64 } from "@atm/crypto";

const judge = generateKeypair();
Object.assign(process.env, {
  DB_MODE: "memory",
  PAYMENT_MODE: "mock",
  INKBOX_API_KEY: "",
  SERVER_KEK_B64: toB64(crypto.getRandomValues(new Uint8Array(32))),
  JUDGE_PUBLIC_KEY_B64: toB64(judge.publicKey),
  JUDGE_PRIVATE_KEY_B64: toB64(judge.secretKey),
  JUDGE_KEY_ID: `judge-${keyIdFor(judge.publicKey)}`,
  JUDGE_REGISTRATION_SECRET: "test-judge-secret",
  SUSPEND_AFTER_STRIKES: "1",
});
delete process.env.INSFORGE_BASE_URL;
delete process.env.INSFORGE_API_KEY;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.BASE_URL;
