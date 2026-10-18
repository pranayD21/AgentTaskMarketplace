#!/usr/bin/env node
// Frees the Inkbox free-tier slots (3 identities) before a demo run.
//   node --env-file=.env demo/inkbox-reset.mjs          # list identities
//   node --env-file=.env demo/inkbox-reset.mjs --yes    # delete atm-buyer-* / atm-seller-* / atm-judge-* (keeps atm-marketplace)
// Agents registered afterwards (buyer, seller) get fresh identities and A2A threads.
const { Inkbox } = await import(new URL("../apps/marketplace-mcp/node_modules/@inkbox/sdk/dist/index.js", import.meta.url));
if (!process.env.INKBOX_API_KEY) { console.error("INKBOX_API_KEY not set"); process.exit(1); }
const ib = new Inkbox({ apiKey: process.env.INKBOX_API_KEY });
const handles = (await ib.listIdentities()).map((i) => i.agentHandle);
console.log(`identities: ${handles.join(", ") || "(none)"}`);
const doomed = handles.filter((h) => /^atm-(buyer|seller|judge)-/.test(h));
if (!process.argv.includes("--yes")) {
  console.log(doomed.length ? `would delete: ${doomed.join(", ")} (re-run with --yes)` : "nothing to delete");
  process.exit(0);
}
for (const h of doomed) { await ib.identities.delete(h); console.log(`deleted ${h}`); }
