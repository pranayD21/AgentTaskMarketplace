#!/usr/bin/env node
// Operator action: lift a seller's suspension on the shared database.
// Sets status ACTIVE, strikes 0 and reinstated_at now, so rejections before
// this moment no longer count as strikes (contract §9). Run from
// apps/marketplace-mcp so @insforge/sdk resolves:
//   node scripts/reinstate-seller.mjs seller_<id>            # dry run
//   node scripts/reinstate-seller.mjs seller_<id> --apply    # write
// Reads INSFORGE_* from the repository .env. Never prints keys.
import { createAdminClient } from "@insforge/sdk";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = { ...parseEnv(readFileSync(path.join(root, ".env"), "utf8")), ...process.env };
const sellerId = process.argv.find((a) => /^seller_[A-Za-z0-9_-]+$/.test(a));
const apply = process.argv.includes("--apply");
if (!sellerId) { console.error("Usage: node scripts/reinstate-seller.mjs seller_<id> [--apply]"); process.exit(2); }
const db = createAdminClient({ baseUrl: env.INSFORGE_BASE_URL, apiKey: env.INSFORGE_API_KEY }).database;

const { data, error } = await db.from("sellers").select("agent_id,status,approvals,rejections,strikes,reinstated_at,last_seen").eq("agent_id", sellerId).limit(1);
if (error || !data?.[0]) { console.error("Seller not found:", error?.message ?? sellerId); process.exit(1); }
const row = data[0];
console.log(`${row.agent_id}: ${row.status}, approvals ${row.approvals}, rejections ${row.rejections}, strikes ${row.strikes}, reinstated ${row.reinstated_at ?? "never"}, last seen ${row.last_seen}`);
if (row.status === "ACTIVE" && row.strikes === 0) { console.log("Already active with no strikes; nothing to do."); process.exit(0); }
if (!apply) { console.log("Dry run: would set status ACTIVE, strikes 0, reinstated_at now. Re-run with --apply."); process.exit(0); }
const reinstated_at = new Date().toISOString();
const { data: won, error: writeError } = await db.from("sellers").update({ status: "ACTIVE", strikes: 0, reinstated_at }).eq("agent_id", sellerId).eq("strikes", row.strikes).select();
if (writeError || !won?.length) { console.error("Write failed (row changed underneath?):", writeError?.message ?? "no rows"); process.exit(1); }
console.log(`Reinstated at ${reinstated_at}. Earlier rejections stay in the lifetime count; the next verdict will not re-suspend unless it is a new rejection.`);
