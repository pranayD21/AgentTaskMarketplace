// Prints a fresh X25519 keypair as two env lines. Used by scripts/setup-env.sh.
import { generateKeypair, keyIdFor, toB64 } from "@atm/crypto";

const kp = generateKeypair();
process.stdout.write(
  [
    `JUDGE_PUBLIC_KEY_B64=${toB64(kp.publicKey)}`,
    `JUDGE_PRIVATE_KEY_B64=${toB64(kp.secretKey)}`,
    `JUDGE_KEY_ID=judge-${keyIdFor(kp.publicKey)}`,
    "",
  ].join("\n"),
);
