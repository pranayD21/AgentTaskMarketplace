/**
 * Observer tap: a 127.0.0.1 forwarder placed between the sandbox and one of
 * its allowed upstreams (marketplace or Ollama). The sandbox is granted the
 * tap's origin instead of the upstream's, and the tap forwards to exactly
 * that one upstream, so the reachable set is unchanged.
 *
 * Every request and response is reported to the live view. Ollama chat calls
 * made with `stream: false` are streamed upstream so tokens appear live, then
 * reassembled into the single JSON response the runner expects.
 *
 * DEMO TOOL: this deliberately exposes decrypted prompts and model output on
 * the seller host. Do not enable it where that matters.
 */
import http from "node:http";
import type { LiveView } from "./server.js";

export type TapTarget = "marketplace" | "ollama";
export interface Tap { url: string; close(): Promise<void> }

const DISPLAY_LIMIT = 256 * 1024;
const HOP_HEADERS = new Set(["host", "connection", "content-length", "transfer-encoding", "accept-encoding", "keep-alive"]);
const DROP_RESPONSE = new Set(["content-encoding", "content-length", "transfer-encoding", "connection", "keep-alive"]);

export async function startTap(view: LiveView, target: TapTarget, upstream: string): Promise<Tap> {
  const up = new URL(upstream);
  let counter = 0;
  const server = http.createServer(async (req, res) => {
    const id = `${target}-${++counter}`;
    const started = Date.now();
    const vm = view.activeVm();
    const ac = new AbortController();
    res.on("close", () => { if (!res.writableFinished) ac.abort(); });
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = Buffer.concat(chunks);
      const reqPath = req.url ?? "/";
      const described = describeRequest(target, reqPath, body.toString("utf8"));
      view.emit({ t: "net", phase: "start", id, vm, target, method: req.method, path: reqPath, call: described.call, req: described.display });

      const headers: Record<string, string> = { "accept-encoding": "identity" };
      for (const [k, v] of Object.entries(req.headers)) if (!HOP_HEADERS.has(k) && typeof v === "string") headers[k] = v;
      const forwardUrl = new URL(reqPath, up.origin);

      const chat = target === "ollama" && reqPath.startsWith("/api/chat") ? parseJson(body.toString("utf8")) as Record<string, unknown> | null : null;
      if (chat && chat.stream === false) {
        await streamChat(view, { id, vm, started, forwardUrl, headers, chat, signal: ac.signal, res });
        return;
      }

      const upstreamRes = await fetch(forwardUrl, {
        method: req.method, headers, redirect: "manual", signal: ac.signal,
        ...(req.method === "GET" || req.method === "HEAD" ? {} : { body }),
      });
      const outHeaders: Record<string, string> = {};
      upstreamRes.headers.forEach((v, k) => { if (!DROP_RESPONSE.has(k)) outHeaders[k] = v; });
      res.writeHead(upstreamRes.status, outHeaders);
      let seen = "";
      if (upstreamRes.body) {
        const decoder = new TextDecoder();
        for await (const chunk of upstreamRes.body as unknown as AsyncIterable<Uint8Array>) {
          res.write(chunk);
          if (seen.length < DISPLAY_LIMIT) seen += decoder.decode(chunk, { stream: true });
        }
      }
      res.end();
      const shown = describeResponse(target, upstreamRes.headers.get("content-type") ?? "", seen);
      view.emit({ t: "net", phase: "end", id, vm, status: upstreamRes.status, ms: Date.now() - started, ok: upstreamRes.ok && !shown.error, res: shown.display, error: shown.error });
    } catch (error) {
      const message = ac.signal.aborted ? "ABORTED_BY_SANDBOX" : `TAP_UPSTREAM_FAILED: ${(error as Error)?.message ?? error}`;
      view.emit({ t: "net", phase: "end", id, vm, status: 502, ms: Date.now() - started, ok: false, error: message });
      if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "tap upstream failed" }));
    }
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => resolve()); });
  const port = (server.address() as { port: number }).port;
  return {
    // Keep the upstream's path (e.g. /mcp) so callers use the tap exactly like the original URL.
    url: `http://127.0.0.1:${port}${up.pathname === "/" ? "" : up.pathname}${up.search}`,
    close: async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); },
  };
}

interface ChatCtx {
  id: string; vm: string | null; started: number; forwardUrl: URL; headers: Record<string, string>;
  chat: Record<string, unknown>; signal: AbortSignal; res: http.ServerResponse;
}

async function streamChat(view: LiveView, c: ChatCtx) {
  const upstreamRes = await fetch(c.forwardUrl, {
    method: "POST", headers: { ...c.headers, "content-type": "application/json" }, signal: c.signal,
    body: JSON.stringify({ ...c.chat, stream: true }),
  });
  if (!upstreamRes.ok || !upstreamRes.body) {
    const text = await upstreamRes.text();
    c.res.writeHead(upstreamRes.status, { "content-type": upstreamRes.headers.get("content-type") ?? "application/json" });
    c.res.end(text);
    view.emit({ t: "net", phase: "end", id: c.id, vm: c.vm, status: upstreamRes.status, ms: Date.now() - c.started, ok: false, error: text.slice(0, 500) });
    return;
  }
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let thinking = "";
  let last: Record<string, unknown> = {};
  let firstTokenMs: number | null = null;
  const take = (line: string) => {
    if (!line.trim()) return;
    const msg = parseJson(line) as { message?: { content?: string; thinking?: string }; error?: string } & Record<string, unknown> | null;
    if (!msg) return;
    if (msg.error) throw new Error(String(msg.error));
    const piece = msg.message?.content ?? "";
    const thought = msg.message?.thinking ?? "";
    if (piece || thought) {
      firstTokenMs ??= Date.now() - c.started;
      content += piece;
      thinking += thought;
      view.emit({ t: "token", id: c.id, vm: c.vm, text: piece, thinking: thought || undefined });
    }
    last = msg;
  };
  for await (const chunk of upstreamRes.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) { take(buffer.slice(0, nl)); buffer = buffer.slice(nl + 1); }
  }
  take(buffer);
  // The final streamed chunk carries the counters; it becomes the non-streamed response.
  const message: Record<string, unknown> = { role: "assistant", content };
  if (thinking) message.thinking = thinking;
  const final = { ...last, message, done: true };
  c.res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  c.res.end(JSON.stringify(final));
  view.emit({
    t: "net", phase: "end", id: c.id, vm: c.vm, status: 200, ms: Date.now() - c.started, ok: true,
    res: { content, eval_count: last.eval_count, prompt_eval_count: last.prompt_eval_count, eval_duration_ms: nsToMs(last.eval_duration), load_duration_ms: nsToMs(last.load_duration), first_token_ms: firstTokenMs, done_reason: last.done_reason },
  });
}

function nsToMs(v: unknown) { return typeof v === "number" ? Math.round(v / 1e6) : undefined; }

function parseJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return null; }
}

/** Shorten long opaque strings (ciphertext, keys) so the page stays readable. */
function shrink(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return value.length > 600 ? `${value.slice(0, 96)}… (${value.length} chars)` : value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => shrink(v, depth + 1));
  if (value && typeof value === "object" && depth < 8) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shrink(v, depth + 1)]));
  return value;
}

function describeRequest(target: TapTarget, reqPath: string, body: string): { call: string; display: unknown } {
  const json = parseJson(body) as Record<string, unknown> | null;
  if (target === "ollama") {
    const call = reqPath.split("?")[0] ?? reqPath;
    // The prompt is shown in full: that is the point of the tap.
    return { call, display: json ? { model: json.model, messages: json.messages, options: json.options } : undefined };
  }
  if (!json) return { call: reqPath, display: body ? shrink(body) : undefined };
  const params = (json.params ?? {}) as Record<string, unknown>;
  if (json.method === "tools/call") return { call: String(params.name), display: shrink(params.arguments) };
  return { call: String(json.method ?? reqPath), display: undefined };
}

function describeResponse(target: TapTarget, contentType: string, text: string): { display: unknown; error?: string } {
  if (target === "ollama") {
    const json = parseJson(text) as Record<string, unknown> | null;
    if (json && Array.isArray(json.models)) return { display: { models: (json.models as { name?: string }[]).map((m) => m.name) } };
    return { display: json ? shrink(json) : shrink(text) };
  }
  // MCP over HTTP answers with JSON or an SSE stream of JSON-RPC messages.
  const messages = contentType.includes("text/event-stream")
    ? text.split("\n").filter((l) => l.startsWith("data:")).map((l) => parseJson(l.slice(5).trim())).filter(Boolean)
    : [parseJson(text)].filter(Boolean);
  const rpc = messages.find((m) => m && typeof m === "object" && ("result" in m || "error" in m)) as { result?: Record<string, unknown>; error?: { message?: string } } | undefined;
  if (!rpc) return { display: text ? shrink(text) : undefined };
  if (rpc.error) return { display: rpc.error, error: rpc.error.message ?? "RPC_ERROR" };
  const content = (rpc.result?.content as { type: string; text?: string }[] | undefined)?.find((c) => c.type === "text")?.text;
  const payload = content !== undefined ? (parseJson(content) ?? content) : rpc.result;
  const toolError = rpc.result?.isError ? (typeof payload === "object" && payload && "code" in payload ? String((payload as { code: unknown }).code) : String(content ?? "TOOL_ERROR").slice(0, 200)) : undefined;
  return { display: shrink(payload), error: toolError };
}
