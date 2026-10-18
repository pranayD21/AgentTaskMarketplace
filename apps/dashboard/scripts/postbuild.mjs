// The daemon serves /task.html for the per-task viewer. It is the same bundle;
// the app picks the view from location.pathname. Stale pre-React files go away.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ui = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../agent-daemon/ui");
fs.copyFileSync(path.join(ui, "seller.html"), path.join(ui, "task.html"));
for (const stale of ["task.js", "task-cards.js"]) fs.rmSync(path.join(ui, stale), { force: true });
console.log(`dashboard built into ${ui}: ${fs.readdirSync(ui).filter(f => !f.endsWith(".md")).join(", ")}`);
