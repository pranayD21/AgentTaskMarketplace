#!/usr/bin/env node
// L1/F1 evidence from the PUBLIC dashboard only (no keys, no task content).
//   node demo/evidence.mjs <task_id> [<task_id> ...]
// Prints, per task: seller, model, price, claim/run/submit/verdict timestamps,
// verdict code, settlement and Stripe ids; then whether any two tasks were
// running on different sellers at the same time.
const base = (process.env.MARKETPLACE_URL ?? "https://warm-cloud-4hh5i.run.mcp-use.com/mcp").replace(/\/mcp\/?$/, "");
const ids = process.argv.slice(2);
if (!ids.length) { console.error("usage: node demo/evidence.mjs <task_id> [<task_id> ...]"); process.exit(1); }

const res = await fetch(`${base}/api/dashboard`);
if (!res.ok) { console.error(`dashboard HTTP ${res.status}`); process.exit(1); }
const d = await res.json();
const at = (taskId, type) => d.events.filter((e) => e.task_id === taskId && e.type === type).map((e) => e.created_at).sort()[0] ?? null;

const rows = ids.map((id) => {
  const t = d.tasks.find((x) => x.task_id === id);
  if (!t) return { task_id: id, missing: "not in the dashboard's recent window" };
  const v = d.verdicts.find((x) => x.task_id === id);
  const s = d.settlements.find((x) => x.task_id === id);
  const seller = d.sellers.find((x) => x.seller_id === t.seller_id);
  return {
    task_id: id, status: t.status, seller_id: t.seller_id, seller_name: seller?.display_name ?? null, runtime: seller?.runner?.runtime ?? null,
    model_id: t.model_id, price_cents: t.price_cents, max_price_cents: t.max_price_cents,
    claimed: at(id, "task.claimed"), running: at(id, "task.running"), submitted: at(id, "result.submitted"), verdict_at: v?.created_at ?? null,
    verdict: v ? `${v.verdict} ${v.reason_code}` : null,
    settlement: s ? { kind: s.kind, state: s.state, payout: s.seller_payout_cents, refund: s.buyer_refund_cents, capture: s.stripe_capture_id, transfer: s.stripe_transfer_id } : null,
  };
});
console.log(JSON.stringify({ marketplace: base, generated_at: d.generated_at, tasks: rows }, null, 2));

// Overlap: [claimed, submitted] windows on distinct sellers.
const win = rows.filter((r) => r.claimed && r.submitted).map((r) => ({ ...r, a: Date.parse(r.claimed), b: Date.parse(r.submitted) }));
const overlaps = [];
for (let i = 0; i < win.length; i++) for (let j = i + 1; j < win.length; j++) {
  const x = win[i], y = win[j];
  if (x.seller_id !== y.seller_id && x.a < y.b && y.a < x.b) overlaps.push(`${x.task_id} (${x.seller_id}) ∩ ${y.task_id} (${y.seller_id}): ${Math.round((Math.min(x.b, y.b) - Math.max(x.a, y.a)) / 1000)}s`);
}
console.log(overlaps.length ? `OVERLAP on distinct sellers:\n  ${overlaps.join("\n  ")}` : "no overlapping execution on distinct sellers among these tasks");
console.log("Seller IDs map to machines only through the team's recorded mapping (C/D messages); this script does not identify computers.");
