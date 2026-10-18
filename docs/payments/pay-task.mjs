#!/usr/bin/env node
// Autonomous TEST-MODE payer for a marketplace payment link — no wallet, no phone.
//   node docs/payments/pay-task.mjs <payment_link>
// Mints a Shared Payment Token with Stripe's test helper (sk_test_ key only, pm_card_visa)
// and pays the HTTP 402 challenge with the mppx client. This is Stripe test money by
// construction: the helper endpoint does not exist in live mode and the key is checked.
// Use the Link agent wallet (link-cli mpp pay … --test) when a human should approve.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const link = process.argv[2];
if (!link?.includes("/api/pay/")) { console.error("usage: node docs/payments/pay-task.mjs <payment_link>"); process.exit(2); }

const key = process.env.STRIPE_SECRET_KEY ?? fs.readFileSync(path.join(ROOT, ".env"), "utf8").split("\n").find((l) => l.startsWith("STRIPE_SECRET_KEY="))?.split("=")[1]?.trim();
if (!key?.startsWith("sk_test_")) { console.error("refusing: STRIPE_SECRET_KEY must be a test-mode key (sk_test_…)"); process.exit(2); }

const rawFetch = globalThis.fetch;
const probe = await rawFetch(link, { method: "POST" });
if (probe.status === 200) { console.log(`already paid: ${await probe.text()}`); process.exit(0); }
if (probe.status !== 402) { console.error(`unexpected HTTP ${probe.status}: ${await probe.text()}`); process.exit(1); }
console.log(`402 ${probe.headers.get("www-authenticate")?.slice(0, 100)}…`);

const { Mppx, stripe } = await import(path.join(ROOT, "apps/marketplace-mcp/node_modules/mppx/dist/client/index.js"));
async function createToken({ amount, currency, expiresAt, paymentMethod }) {
  const body = new URLSearchParams({ payment_method: paymentMethod, "usage_limits[currency]": currency, "usage_limits[max_amount]": String(amount), "usage_limits[expires_at]": String(expiresAt) });
  const res = await rawFetch("https://api.stripe.com/v1/test_helpers/shared_payment/granted_tokens", {
    method: "POST", headers: { authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" }, body,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`granted_tokens: ${json.error?.message ?? res.status}`);
  if (json.livemode) throw new Error("refusing: token is live mode");
  console.log(`test SPT ${json.id} (max ${json.usage_limits?.max_amount}c)`);
  return json.id;
}
Mppx.create({ methods: [stripe({ createToken, paymentMethod: "pm_card_visa" })] });
const paid = await fetch(link, { method: "POST" });
const receipt = paid.headers.get("payment-receipt");
console.log(`HTTP ${paid.status}${receipt ? ` receipt ${Buffer.from(receipt, "base64url").toString("utf8")}` : ""}`);
console.log(await paid.text());
process.exit(paid.status === 200 ? 0 : 1);
