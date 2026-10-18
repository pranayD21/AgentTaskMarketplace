#!/usr/bin/env node
// Lists the org's Inkbox identities (free tier: 3). Read-only by default.
//   node --env-file=.env demo/inkbox-reset.mjs          # list identities
// The identities are SHARED by the whole team: deleting them is not a demo
// step. Only with recorded team agreement (coordination messages):
//   ATM_INKBOX_RESET_AGREED=1 node --env-file=.env demo/inkbox-reset.mjs --yes
const { Inkbox } = await import(new URL("../apps/marketplace-mcp/node_modules/@inkbox/sdk/dist/index.js", import.meta.url));
if (!process.env.INKBOX_API_KEY) { console.error("INKBOX_API_KEY not set"); process.exit(1); }
const ib = new Inkbox({ apiKey: process.env.INKBOX_API_KEY });
const handles = (await ib.listIdentities()).map((i) => i.agentHandle);
console.log(`identities: ${handles.join(", ") || "(none)"}`);
const doomed = handles.filter((h) => /^atm-(buyer|seller|judge)-/.test(h));
if (!process.argv.includes("--yes") || process.env.ATM_INKBOX_RESET_AGREED !== "1") {
  console.log(doomed.length ? `would delete: ${doomed.join(", ")} (shared identities: needs team agreement, see header)` : "nothing to delete");
  process.exit(0);
}
for (const h of doomed) { await ib.identities.delete(h); console.log(`deleted ${h}`); }
