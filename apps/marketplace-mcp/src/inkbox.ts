/**
 * Inkbox identities + A2A notices.
 *
 * Every buyer/seller gets an Inkbox identity with an A2A receiver. The
 * marketplace itself owns one identity (`atm-marketplace`) and sends task
 * notices from it: the seller's thread per task reads assignment → submitted
 * → verdict, and the buyer receives the verdict in its own thread.
 *
 * Nothing here may fail or slow a tool: every call is bounded by a timeout and
 * errors degrade to `null` with one log line. Notice text carries ids, prices
 * and fixed reason-code text only, never prompts, answers or judge output.
 */
import fs from "node:fs";
import { publicReason } from "@atm/shared";
import path from "node:path";
import { Inkbox, type A2AClient, type A2AResolvedTarget, type A2ASkill } from "@inkbox/sdk";
import { db, one, unwrap, type AgentRow, type TaskRow, type VerdictRow } from "./db.js";
import { env } from "./env.js";
import { kekOpen, kekSeal } from "./kek.js";

export interface InkboxIdentityInfo {
  handle: string;
  identity_id: string;
  card_url: string | null;
}

const MARKETPLACE_HANDLE = "atm-marketplace";
const TIMEOUT_MS = 5_000;
// Same place the daemons keep their state; git-ignored.
const STATE_FILE = path.resolve(process.cwd(), "../../.atm-state/inkbox-marketplace.json");

const SKILLS: Record<"buyer" | "seller" | "judge" | "marketplace", A2ASkill[]> = {
  buyer: [{ id: "atm-buyer", name: "Task buyer", description: "Posts tasks to the HANDOFF and receives verdict notices.", tags: ["atm", "buyer"] }],
  seller: [{ id: "atm-seller", name: "Task seller", description: "Runs marketplace tasks on local open-source models inside a Wasm sandbox; receives assignment notices.", tags: ["atm", "seller", "ollama"] }],
  judge: [{ id: "atm-judge", name: "Task judge", description: "Verifies submitted results inside a Wasm sandbox before the seller is paid.", tags: ["atm", "judge"] }],
  marketplace: [{ id: "atm-notices", name: "Marketplace notices", description: "Sends task lifecycle notices (assignment, submitted, verdict) to marketplace agents.", tags: ["atm", "marketplace"] }],
};

const once = new Set<string>();
function warnOnce(key: string, msg: string) {
  if (once.has(key)) return;
  once.add(key);
  console.warn(`[inkbox] ${msg}`);
}

function withTimeout<T>(p: Promise<T>, ms = TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

const errMsg = (err: unknown) => ((err as Error)?.message ?? String(err)).slice(0, 200);

let adminClient: Inkbox | undefined;
function admin(): Inkbox {
  return (adminClient ??= new Inkbox({ apiKey: env().INKBOX_API_KEY! }));
}

function cardUrl(handle: string): string {
  return `https://inkbox.ai/a2a/${handle}/card`;
}

function roleOf(handle: string): keyof typeof SKILLS {
  const m = /^atm-(buyer|seller|judge)-/.exec(handle);
  return (m?.[1] as "buyer" | "seller" | "judge" | undefined) ?? "marketplace";
}

// ---------------------------------------------------------------------------
// Marketplace sender identity (agent-scoped key, minted once and cached)
// ---------------------------------------------------------------------------

interface Sender { client: A2AClient; targets: Map<string, A2AResolvedTarget> }
let senderPromise: Promise<Sender> | undefined;

function loadScopedKey(identityId: string): string | null {
  try {
    const saved = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as { identity_id: string; key_enc: string };
    return saved.identity_id === identityId ? kekOpen<string>(saved.key_enc) : null;
  } catch {
    return null;
  }
}

function saveScopedKey(identityId: string, key: string) {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify({ identity_id: identityId, key_enc: kekSeal(key) }), { mode: 0o600 });
  } catch (err) {
    warnOnce("save-key", `could not cache the marketplace identity key (${errMsg(err)}); a new one is minted per process`);
  }
}

async function buildSender(): Promise<Sender> {
  const ib = admin();
  let identity = await ib.getIdentity(MARKETPLACE_HANDLE).catch(() => null);
  if (!identity) {
    identity = await ib.createIdentity(MARKETPLACE_HANDLE, { displayName: "HANDOFF" });
    await identity.a2aEnable();
    await identity.a2aSetSkills(SKILLS.marketplace);
  }
  let key = loadScopedKey(identity.id);
  if (!key) {
    key = (await ib.apiKeys.create({ label: "atm-marketplace-a2a", description: "Marketplace A2A notices", scopedIdentityId: identity.id })).apiKey;
    saveScopedKey(identity.id, key);
  }
  const scoped = new Inkbox({ apiKey: key });
  const client = await (await scoped.getIdentity(MARKETPLACE_HANDLE)).a2aClient();
  return { client, targets: new Map() };
}

function sender(): Promise<Sender> {
  senderPromise ??= buildSender().catch((err) => {
    senderPromise = undefined; // retry on the next notice
    throw err;
  });
  return senderPromise;
}

async function target(s: Sender, handle: string): Promise<A2AResolvedTarget> {
  let t = s.targets.get(handle);
  if (!t) {
    t = await s.client.fetchCard(cardUrl(handle));
    s.targets.set(handle, t);
  }
  return t;
}

// An A2A context belongs to one caller/target pair, so a task has one thread
// per recipient. The seller's thread is the task's main thread: the service
// stores its id as `tasks.inkbox_context_id`, and it reads assignment →
// submitted → verdict. The buyer gets the verdict in its own thread.
// Recipients are rebuilt from the database on every notice, so a server
// restart between claim and verdict loses nothing (I1).


interface TaskRecipients { seller: string | null; buyer: string | null; verdict: { verdict: string; reason_code: string } | null }

async function recipientsFor(taskId: string): Promise<TaskRecipients> {
  const task = await one<Pick<TaskRow, "seller_id" | "buyer_id">>(await db().from("tasks").select("seller_id,buyer_id").eq("id", taskId).limit(1));
  const ids = [task?.seller_id, task?.buyer_id].filter((x): x is string => Boolean(x));
  const agents = ids.length ? (unwrap(await db().from("agents").select("id,inkbox_handle").in("id", ids)) as Pick<AgentRow, "id" | "inkbox_handle">[]) : [];
  const handle = (id: string | null | undefined) => agents.find((a) => a.id === id)?.inkbox_handle ?? null;
  const verdict = await one<Pick<VerdictRow, "verdict" | "reason_code">>(await db().from("verdicts").select("verdict,reason_code").eq("task_id", taskId).order("created_at", { ascending: false }).limit(1));
  return { seller: handle(task?.seller_id), buyer: handle(task?.buyer_id), verdict };
}

async function sendNotice(s: Sender, handle: string, text: string, contextId: string | null): Promise<string | null> {
  const t = await target(s, handle);
  const send = (ctx?: string) => s.client.send(t, { text, ...(ctx ? { contextId: ctx } : {}) });
  let res;
  try {
    res = await send(contextId ?? undefined);
  } catch (err) {
    // A stored context that Inkbox no longer accepts: start a fresh thread rather than drop the notice.
    if (!contextId || !/context/i.test(errMsg(err))) throw err;
    res = await send(undefined);
  }
  return (res.kind === "task" ? res.task.contextId : (res.message.contextId as string | undefined)) ?? null;
}

export const inkbox = {
  get enabled(): boolean {
    return Boolean(env().INKBOX_API_KEY);
  },

  async createIdentity(handle: string, displayName: string): Promise<InkboxIdentityInfo | null> {
    if (!this.enabled) return null;
    const role = roleOf(handle);
    // The free tier allows three identities: the marketplace sender, one buyer
    // and one seller. Judges never receive notices, so they do not use one.
    if (role === "judge") return null;
    try {
      return await withTimeout(
        (async () => {
          await sender().catch(() => undefined); // claim the sender slot first
          const identity = await admin().createIdentity(handle, { displayName: displayName.slice(0, 80) });
          await identity.a2aEnable();
          await identity.a2aSetSkills(SKILLS[role]);
          return { handle: identity.agentHandle, identity_id: identity.id, card_url: cardUrl(identity.agentHandle) };
        })(),
        TIMEOUT_MS * 2,
      );
    } catch (err) {
      warnOnce(`create:${/limit|quota|maximum|exceed|402|403/i.test(errMsg(err)) ? "quota" : handle}`, `identity ${handle} not created: ${errMsg(err)}`);
      return null;
    }
  },

  async notify(event: { type: string; task_id: string; to_handle: string | null; text: string; context_id?: string | null }): Promise<string | null> {
    if (!this.enabled) return null;
    const stored = event.context_id ?? null;
    try {
      return await withTimeout(
        (async () => {
          const r = await recipientsFor(event.task_id);
          let text = event.text;
          let sends: { handle: string; context: string | null; main: boolean }[];
          if (event.type === "verdict") {
            if (!r.verdict) return stored;
            text = `Judge ${r.verdict.verdict} for ${event.task_id}: ${publicReason(r.verdict.reason_code)}`;
            sends = [
              ...(r.seller ? [{ handle: r.seller, context: stored, main: true }] : []),
              ...(r.buyer && r.buyer !== r.seller ? [{ handle: r.buyer, context: null, main: false }] : []),
            ];
          } else {
            const to = event.to_handle ?? r.seller;
            sends = to ? [{ handle: to, context: to === r.seller ? stored : null, main: to === r.seller }] : [];
          }
          if (!sends.length) return stored;
          const s = await sender();
          const results = await Promise.allSettled(sends.map((x) => sendNotice(s, x.handle, `[${event.type}] ${text}`, x.context)));
          const failed = results.find((x): x is PromiseRejectedResult => x.status === "rejected");
          if (failed) warnOnce(`notify:${errMsg(failed.reason).slice(0, 40)}`, `${event.type} notice for ${event.task_id} partly failed: ${errMsg(failed.reason)}`);
          const mainIdx = sends.findIndex((x) => x.main);
          const main = mainIdx >= 0 ? results[mainIdx] : undefined;
          return (main?.status === "fulfilled" ? main.value : null) ?? stored;
        })(),
      );
    } catch (err) {
      warnOnce(`notify:${errMsg(err).slice(0, 40)}`, `${event.type} notice for ${event.task_id} not sent: ${errMsg(err)}`);
      return stored;
    }
  },
};
