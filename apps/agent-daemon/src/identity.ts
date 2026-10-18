import fs from "node:fs";
import path from "node:path";

export interface AgentState { agent_id: string; api_key: string; display_name: string }
export function readAgentState(file: string): AgentState | null {
  if (!fs.existsSync(file)) return null;
  if (!fs.lstatSync(file).isFile()) throw new Error("INVALID_IDENTITY_FILE");
  let state: AgentState;
  try { state = JSON.parse(fs.readFileSync(file, "utf8")) as AgentState; }
  catch { throw new Error("INVALID_IDENTITY_FILE"); }
  if (!state || ![state.agent_id, state.api_key, state.display_name].every(v => typeof v === "string" && v.length)) throw new Error("INVALID_IDENTITY_FILE");
  fs.chmodSync(file, 0o600);
  return state;
}

/** One daemon per saved identity; a malformed identity must never create another. */
export function lockIdentity(file: string): () => void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const lock = `${file}.lock`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(lock, String(process.pid), { flag: "wx", mode: 0o600 });
      return () => { try { if (fs.readFileSync(lock, "utf8") === String(process.pid)) fs.unlinkSync(lock); } catch {} };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const pid = Number(fs.readFileSync(lock, "utf8"));
      if (!Number.isSafeInteger(pid) || pid < 1) throw new Error("INVALID_IDENTITY_LOCK");
      try { process.kill(pid, 0); }
      catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ESRCH") {
          // Serialize stale-lock recovery: two starters must not unlink a lock
          // that the other has just acquired. An interrupted recovery fails closed.
          const recovery = `${lock}.recovery`;
          try { fs.writeFileSync(recovery, String(process.pid), { flag: "wx", mode: 0o600 }); }
          catch { throw new Error("IDENTITY_LOCK_RECOVERY_IN_PROGRESS"); }
          try { if (fs.existsSync(lock) && Number(fs.readFileSync(lock, "utf8")) === pid) fs.unlinkSync(lock); }
          finally { fs.unlinkSync(recovery); }
          continue;
        }
      }
      throw new Error("SELLER_ALREADY_RUNNING");
    }
  }
  throw new Error("IDENTITY_LOCK_FAILED");
}

export async function registerSavedAgent(file: string, register: () => Promise<AgentState>): Promise<AgentState> {
  const old = readAgentState(file);
  if (old) return old;
  const pending = `${file}.registration-pending`;
  if (fs.existsSync(pending)) throw new Error("REGISTRATION_OUTCOME_UNKNOWN_CONTACT_OPERATOR");
  fs.writeFileSync(pending, new Date().toISOString(), { mode: 0o600, flag: "wx" });
  const state = await register(); // leave the marker on unknown outcomes; never silently register again
  fs.writeFileSync(file, JSON.stringify(state, null, 2), { mode: 0o600, flag: "wx" });
  fs.unlinkSync(pending);
  return state;
}
