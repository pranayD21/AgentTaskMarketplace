#!/usr/bin/env node
// Operator reconciliation for the shared provider allowance ledger.
// Settles reserved entries whose task is terminal (or missing), freeing the
// allowance they hold. Run from apps/marketplace-mcp so @insforge/sdk resolves:
//   node scripts/reconcile-provider-budget.mjs            # dry run
//   node scripts/reconcile-provider-budget.mjs --apply    # write
// Reads INSFORGE_* from the repository .env. Never prints keys.
import { createAdminClient } from "@insforge/sdk";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const env = { ...parseEnv(readFileSync(path.join(root, ".env"), "utf8")), ...process.env };
const apply = process.argv.includes("--apply");
const db = createAdminClient({ baseUrl: env.INSFORGE_BASE_URL, apiKey: env.INSFORGE_API_KEY }).database;
const TERMINAL = new Set(["APPROVED", "REJECTED", "CANCELLED", "EXPIRED"]);

const { data, error } = await db.from("provider_budget").select("*").eq("id", "shared-judge").limit(1);
if (error || !data?.[0]) { console.error("Could not read the ledger:", error?.message ?? "no row"); process.exit(1); }
const row = data[0];
const entries = structuredClone(row.entries);
let changed = 0;
for (const [key, entry] of Object.entries(entries)) {
  if (entry.state !== "reserved") continue;
  const { data: tasks } = await db.from("tasks").select("id,status,created_at").eq("buyer_id", entry.buyer_id).eq("client_request_id", entry.request_id).limit(1);
  const task = tasks?.[0];
  const settle = !task || TERMINAL.has(task.status);
  console.log(`${settle ? "settle" : "keep  "} ${key.slice(-12)} ${entry.booked_microusd} µ$ task=${task ? `${task.id.slice(-8)} ${task.status}` : "not found"}`);
  if (settle) { entry.state = "settled"; entry.booked_microusd = 0; changed++; }
}
const booked = (e) => Object.values(e).reduce((n, x) => n + x.booked_microusd, 0);
console.log(`remaining before: ${row.cap_microusd - booked(row.entries)} µ$; after: ${row.cap_microusd - booked(entries)} µ$ of ${row.cap_microusd}`);
if (!changed) { console.log("Nothing to settle."); process.exit(0); }
if (!apply) { console.log(`Dry run: ${changed} entr${changed === 1 ? "y" : "ies"} would be settled. Re-run with --apply.`); process.exit(0); }
const { data: won, error: writeError } = await db.from("provider_budget").update({ entries, revision: row.revision + 1 }).eq("id", row.id).eq("revision", row.revision).select();
if (writeError || !won?.length) { console.error("Write failed (ledger changed underneath?):", writeError?.message ?? "no rows"); process.exit(1); }
console.log(`Settled ${changed}; ledger revision ${won[0].revision}.`);
