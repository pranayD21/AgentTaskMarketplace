#!/usr/bin/env node
// L1/F1 evidence from the PUBLIC dashboard only (no keys, no task content).
//   node demo/evidence.mjs <task_id> [<task_id> ...]
//
// For each task it reconstructs the claim attempt that produced the submitted
// result: task.claimed(claim) → task.running(same claim) → result.submitted by
// the same seller, with no release/reopen in between. Execution = running →
// submitted of that one attempt. A task whose history is incomplete or
// ambiguous (missing events, several submissions, seller mismatch, a submit
// with no running claim) is reported as REJECTED-EVIDENCE and excluded.
// Overlap is then computed on execution windows of distinct sellers; the
// reservation window (claimed → submitted) is reported separately.
const base = (process.env.MARKETPLACE_URL ?? "https://warm-cloud-4hh5i.run.mcp-use.com/mcp").replace(/\/mcp\/?$/, "");
const ids = process.argv.slice(2);
if (!ids.length) { console.error("usage: node demo/evidence.mjs <task_id> [<task_id> ...]"); process.exit(1); }

// ATM_DASHBOARD_FILE: read a saved /api/dashboard JSON instead (offline checks, archived evidence).
let d;
if (process.env.ATM_DASHBOARD_FILE) {
  d = JSON.parse((await import("node:fs")).readFileSync(process.env.ATM_DASHBOARD_FILE, "utf8"));
} else {
  const res = await fetch(`${base}/api/dashboard`);
  if (!res.ok) { console.error(`dashboard HTTP ${res.status}`); process.exit(1); }
  d = await res.json();
}

/** Returns {attempt} for exactly one clean claim→running→submitted attempt, else {problem}. */
function attemptFor(taskId) {
  const evs = d.events.filter((e) => e.task_id === taskId).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  let current = null;
  const submitted = [];
  for (const e of evs) {
    const claim = e.meta?.claim_id ?? null;
    if (e.type === "task.claimed") {
      if (!claim) return { problem: "task.claimed without claim_id" };
      current = { claim_id: claim, seller_id: e.agent_id, claimed: e.created_at, running: null, price_cents: e.meta?.price_cents ?? null };
    } else if (e.type === "task.running") {
      if (!current || claim !== current.claim_id) return { problem: `task.running for ${claim ?? "?"} without its claim event` };
      if (e.agent_id !== current.seller_id) return { problem: "task.running by a different seller than the claim" };
      current.running = e.created_at;
    } else if (e.type === "task.released" || e.type === "task.reopened" || e.type === "lease.expired") {
      const which = claim ?? e.meta?.previous_claim_id ?? null;
      if (current && (which === null || which === current.claim_id)) current = null;
    } else if (e.type === "result.submitted") {
      if (!current) return { problem: "result.submitted with no live claim" };
      if (!current.running) return { problem: `result.submitted for ${current.claim_id} without task.running` };
      if (e.agent_id !== current.seller_id) return { problem: "result.submitted by a different seller than the running claim" };
      submitted.push({ ...current, submitted: e.created_at, result_id: e.meta?.result_id ?? null });
      current = null;
    }
  }
  if (!evs.length) return { problem: "no events in the dashboard window" };
  if (submitted.length === 0) return { problem: "no submitted attempt" };
  if (submitted.length > 1) return { problem: `${submitted.length} submitted attempts` };
  return { attempt: submitted[0] };
}

const rows = ids.map((id) => {
  const t = d.tasks.find((x) => x.task_id === id);
  if (!t) return { task_id: id, evidence: "REJECTED-EVIDENCE", problem: "task not in the dashboard's recent window" };
  const v = d.verdicts.find((x) => x.task_id === id);
  const s = d.settlements.find((x) => x.task_id === id);
  const { attempt, problem } = attemptFor(id);
  const seller = attempt && d.sellers.find((x) => x.seller_id === attempt.seller_id);
  const mismatch = attempt && t.seller_id && t.seller_id !== attempt.seller_id ? "task seller differs from the submitting attempt" : null;
  return {
    task_id: id, status: t.status, evidence: problem || mismatch ? "REJECTED-EVIDENCE" : "OK", problem: problem ?? mismatch ?? null,
    claim_id: attempt?.claim_id ?? null, seller_id: attempt?.seller_id ?? null, seller_name: seller?.display_name ?? null, runtime: seller?.runner?.runtime ?? null,
    model_id: t.model_id, price_cents: t.price_cents, claimed: attempt?.claimed ?? null, running: attempt?.running ?? null, submitted: attempt?.submitted ?? null,
    execution_s: attempt ? (Date.parse(attempt.submitted) - Date.parse(attempt.running)) / 1000 : null,
    verdict: v ? `${v.verdict} ${v.reason_code}` : null, verdict_at: v?.created_at ?? null,
    settlement: s ? { kind: s.kind, state: s.state, payout: s.seller_payout_cents, refund: s.buyer_refund_cents, capture: s.stripe_capture_id, transfer: s.stripe_transfer_id } : null,
  };
});
console.log(JSON.stringify({ marketplace: base, generated_at: d.generated_at, tasks: rows }, null, 2));

const ok = rows.filter((r) => r.evidence === "OK");
const pairs = (from, to, label) => {
  const out = [];
  for (let i = 0; i < ok.length; i++) for (let j = i + 1; j < ok.length; j++) {
    const x = ok[i], y = ok[j];
    if (x.seller_id === y.seller_id) continue;
    const a1 = Date.parse(x[from]), b1 = Date.parse(x[to]), a2 = Date.parse(y[from]), b2 = Date.parse(y[to]);
    if (a1 < b2 && a2 < b1) out.push(`${x.task_id} (${x.seller_id}) ∩ ${y.task_id} (${y.seller_id}): ${((Math.min(b1, b2) - Math.max(a1, a2)) / 1000).toFixed(1)}s`);
  }
  console.log(out.length ? `${label} OVERLAP on distinct sellers:\n  ${out.join("\n  ")}` : `${label}: no overlap on distinct sellers`);
  return out.length;
};
const rejected = rows.filter((r) => r.evidence !== "OK");
if (rejected.length) console.log(`excluded (REJECTED-EVIDENCE): ${rejected.map((r) => `${r.task_id}: ${r.problem}`).join("; ")}`);
const exec = pairs("running", "submitted", "EXECUTION (task.running → result.submitted, same claim)");
pairs("claimed", "submitted", "reservation (task.claimed → result.submitted; not execution)");
console.log("Seller IDs map to machines only through the team's recorded mapping (C: seller_07a57bbbd50fd91e, D: seller_0213ff3d1ffc3278); this script does not identify computers.");
process.exitCode = exec ? 0 : 2;
