// Thin client for the daemon's loopback dashboard server. Every POST carries the
// X-ATM-Request header the server requires; the browser adds Origin itself.

export interface OllamaModel { name: string; size: number; digest?: string; parameters?: string; quantization?: string }
export interface LoadedModel { name: string; size: number; size_vram: number; expires_at?: string }
export interface Machine {
  hostname: string; chip: string; cpu_cores: number; memory_bytes: number; free_memory_bytes: number;
  load_average_1m: number; platform?: string; arch?: string; uptime_s?: number; ollama_online: boolean;
  models: OllamaModel[]; loaded_models: LoadedModel[];
}
export interface Worker {
  service?: string; pid?: number | null; seller_id?: string | null; prepared?: boolean; marketplace?: string;
  models?: string[]; approvals?: number | null; runtime?: string; component_sha256?: string;
  payout_status?: string; payout_label?: string; server_reachable?: boolean; viewer_url?: string | null;
  /** Marketplace-side state of this seller (ACTIVE, SUSPENDED…) and why the worker last stopped, if it did. */
  seller_status?: string | null; strikes?: number | null; stopped_reason?: string | null;
}
export interface Status {
  buyer_id: string | null;
  buyer_payment: { buyer_payment_status?: string; setup_url?: string | null } | null;
  provider_budget: { remaining_microusd?: number | null; enforced?: boolean; available?: boolean } | null;
  machine: Machine;
  worker: Worker;
  owner: { user_id: string; email?: string } | null;
  seller_id: string | null;
  /** Model this computer sells with; empty or null means every installed model the network accepts. */
  seller_model?: string | null;
  allowed_models: string[];
  phase: string;
  error: string | null;
  busy: boolean;
  payments_label: string;
}
export interface TaskState {
  task_id: string; status: string; seller_id?: string | null; model_id?: string | null; claim_id?: string | null;
  price_cents?: number; created_at?: string;
}
export interface ToolCall { function: { name: string; arguments: Record<string, unknown> } }
export interface AgentEvent {
  type: string; at: string; turn?: number;
  message?: { role?: string; content?: string; thinking?: string; tool_calls?: ToolCall[] };
  content?: string; thinking?: string; name?: string; arguments?: unknown; result?: unknown;
  task?: TaskState; task_id?: string; seller_id?: string; answer?: string; status?: string; reason?: string;
  tasks?: string[]; duration_ms?: number; [key: string]: unknown;
}
export interface Run {
  id: string; prompt: string; model: string; status: string; events: AgentEvent[]; task_ids: string[];
  error?: string; mode?: string; conversation_id?: string; task_prompts?: Record<string, string>;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function parse(response: Response) {
  const text = await response.text();
  let body: any = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
  if (!response.ok) {
    const message = typeof body.error === "string" ? body.error : body.error?.message;
    throw new ApiError(message || (response.status === 401
      ? "Open this dashboard again with atm-seller dashboard."
      : "The request could not finish. Please try again."), response.status);
  }
  return body;
}

export async function get<T>(route: string, signal?: AbortSignal): Promise<T> {
  return parse(await fetch(route, { signal: signal ?? AbortSignal.timeout(12000), cache: "no-store", headers: { Accept: "application/json" } }));
}

export async function post<T = any>(route: string, body?: unknown): Promise<T> {
  return parse(await fetch(route, {
    method: "POST", cache: "no-store",
    headers: { "X-ATM-Request": "1", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  }));
}

export const api = {
  status: () => get<Status>("/api/status"),
  chat: () => get<{ runs: Run[] }>("/api/chat"),
  google: () => post<{ url: string }>("/api/auth/google"),
  buyerPayment: () => post<{ setup_url?: string | null; buyer_payment_status?: string }>("/api/buyer-payment"),
  prepare: () => post("/api/prepare"),
  payout: () => post<{ payout_onboarding_url?: string | null; payout_status?: string }>("/api/payout"),
  start: () => post("/api/start"),
  stop: () => post("/api/stop"),
  send: (input: { prompt: string; model: string; conversation_id: string }) => post<{ id: string }>("/api/chat", input),
  stopRun: (id: string) => post("/api/chat/stop", { id }),
  sellerModel: (model: string) => post<{ seller_model: string }>("/api/seller-model", { model }),
};

/** Opens a Stripe-hosted page in a popup the browser allowed synchronously. */
export async function openHosted(name: string, request: () => Promise<string | null | undefined>) {
  const popup = window.open("about:blank", name);
  try {
    const url = await request();
    if (!url) { popup?.close(); return false; }
    if (popup) { popup.opener = null; popup.location = url; } else window.location.assign(url);
    return true;
  } catch (error) { popup?.close(); throw error; }
}
