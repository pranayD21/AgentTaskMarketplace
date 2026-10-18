/**
 * Inkbox identities + A2A notices.
 *
 * Every buyer/seller gets an Inkbox identity with an A2A receiver. The
 * marketplace itself owns one identity (`atm-marketplace`) and sends task
 * notices from it, reusing one A2A context per task so the console shows a
 * single thread: assignment → submitted → verdict.
 *
 * Nothing here may fail or slow a tool: every call is bounded by a timeout and
 * errors degrade to `null` with one log line. Notice text carries ids, prices
 * and public verdict reasons only, never prompts or answers.
 */
import fs from "node:fs";
import path from "node:path";
import { Inkbox, type A2AClient, type A2AResolvedTarget, type A2ASkill } from "@inkbox/sdk";
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
  buyer: [{ id: "atm-buyer", name: "Task buyer", description: "Posts tasks to the Agent Task Marketplace and receives verdict notices.", tags: ["atm", "buyer"] }],
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
    identity = await ib.createIdentity(MARKETPLACE_HANDLE, { displayName: "Agent Task Marketplace" });
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
// per recipient. The first recipient (the seller, at assignment) owns the
// task's main thread, whose id the service stores as `inkbox_context_id`;
// notices without a recipient ("submitted") and every verdict go there too,
// so that thread reads assignment → submitted → verdict.
const threadOwner = new Map<string, string>();
const contexts = new Map<string, string>();

async function sendNotice(s: Sender, taskId: string, handle: string, text: string, storedContext: string | null): Promise<string | null> {
  const key = `${taskId}:${handle}`;
  const known = contexts.get(key) ?? (threadOwner.get(taskId) === handle ? storedContext ?? undefined : undefined);
  const t = await target(s, handle);
  const send = (contextId?: string) => s.client.send(t, { text, ...(contextId ? { contextId } : {}) });
  let res;
  try {
    res = await send(known);
  } catch (err) {
    // A context from another recipient (or a lost in-memory map) is refused; start a fresh thread.
    if (!known || !/context/i.test(errMsg(err))) throw err;
    res = await send(undefined);
  }
  const ctx = (res.kind === "task" ? res.task.contextId : (res.message.contextId as string | undefined)) ?? null;
  if (ctx) contexts.set(key, ctx);
  return ctx;
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
    if (event.to_handle && !threadOwner.has(event.task_id)) threadOwner.set(event.task_id, event.to_handle);
    const owner = threadOwner.get(event.task_id);
    const recipients = [...new Set([event.to_handle, event.type === "verdict" || !event.to_handle ? owner : null].filter((h): h is string => Boolean(h)))];
    if (!recipients.length) return stored;
    const text = `[${event.type}] ${event.text}`;
    try {
      return await withTimeout(
        (async () => {
          const s = await sender();
          const sent = await Promise.allSettled(recipients.map((h) => sendNotice(s, event.task_id, h, text, stored)));
          const failed = sent.find((r): r is PromiseRejectedResult => r.status === "rejected");
          if (failed) warnOnce(`notify:${errMsg(failed.reason).slice(0, 40)}`, `${event.type} notice for ${event.task_id} partly failed: ${errMsg(failed.reason)}`);
          return (owner && contexts.get(`${event.task_id}:${owner}`)) ?? stored;
        })(),
      );
    } catch (err) {
      warnOnce(`notify:${errMsg(err).slice(0, 40)}`, `${event.type} notice for ${event.task_id} not sent: ${errMsg(err)}`);
      return event.context_id ?? null;
    }
  },
};
