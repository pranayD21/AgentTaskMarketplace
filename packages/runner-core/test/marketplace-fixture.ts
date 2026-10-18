import { generateKeypair, keyDescriptor, open, sealJson, sha256Hex, fromUtf8 } from "@atm/crypto";
import type { Envelope, KeyDescriptor } from "@atm/shared";

/** Synthetic service for transport and sandbox tests; no external accounts. */
export function fixture(options: { legacy?: boolean; sse?: boolean; missingModel?: boolean; fail?: string; expired?: boolean } = {}) {
  const buyer = generateKeypair(), judge = generateKeypair();
  const buyerKey = keyDescriptor("buyer-test", buyer.publicKey), judgeKey = keyDescriptor("judge-test", judge.publicKey);
  const calls: string[] = [];
  const registered = new Map<string, KeyDescriptor>();
  let claimKey: KeyDescriptor | undefined;
  let state = "OPEN";
  let result: any;
  let claimOwner = "";
  let counter = 0;
  let currentClaim = "";
  let inputChars = 0;
  let outputVerified = false;
  let delayMs = 0;

  const handle = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.endsWith("/api/tags")) return Response.json({ models: options.missingModel ? [] : [{ name: "qwen3:8b" }] });
    if (url.endsWith("/api/chat")) {
      calls.push("ollama");
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      inputChars = JSON.stringify(JSON.parse(String(init?.body)).messages).length;
      if (options.fail === "timeout") throw new DOMException("request timed out", "AbortError");
      if (options.fail === "ollama") return new Response("PRIVATE PROMPT SHOULD NOT ESCAPE", { status: 500 });
      return Response.json({ message: { content: "Paris" }, eval_count: 2 });
    }
    const req = JSON.parse(String(init?.body));
    const name = req.params?.name;
    const args = req.params?.arguments;
    const headers = new Headers(init?.headers);
    const actor = headers.get("authorization") ?? "";
    if (req.method === "notifications/initialized") return new Response(null, { status: 202 });
    const ok = (value: unknown) => {
      const rpc = { jsonrpc: "2.0", id: req.id, result: value };
      return options.sse ? new Response(`: heartbeat\r\n\r\nevent: message\r\ndata: ${JSON.stringify(rpc)}\r\n\r\n`, { headers: { "content-type": "text/event-stream", "mcp-session-id": "fixture-session" } }) : Response.json(rpc, { headers: { "mcp-session-id": "fixture-session" } });
    };
    if (req.method === "initialize") return ok({ protocolVersion: "2025-06-18" });
    if (headers.get("mcp-session-id") !== "fixture-session") throw new Error("SESSION_HEADER_MISSING");
    const error = (code: string) => ok({ isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code, message: "PRIVATE ERROR DETAILS" } }) }] });
    calls.push(name);
    if (options.fail === name) return error(name === "claim_task" ? "SELLER_SUSPENDED" : "LEASE_EXPIRED");
    let data: any = {};
    switch (name) {
      case "register_seller":
        registered.set(actor, { key_id: args.runner_key_id, public_key_b64: args.runner_pubkey_b64 });
        data = { seller: { status: "ACTIVE" } }; break;
      case "claim_task": {
        if (state !== "OPEN") return error("CLAIM_CONFLICT");
        state = "PAYLOAD_READY";
        claimOwner = actor;
        claimKey = options.legacy ? registered.get(actor) : { key_id: args.runner_key_id, public_key_b64: args.runner_pubkey_b64 };
        if (!claimKey) throw new Error("KEY_MISSING");
        currentClaim = `claim_${++counter}`;
        data = { claim: {
          task_id: "task_fixture", claim_id: currentClaim, seller_id: actor, model_id: "qwen3:8b", price_cents: 60,
          lease_expires_at: new Date(Date.now() + (options.expired ? -1 : 300_000)).toISOString(), max_runtime_s: 180,
          seller_envelope: sealJson(claimKey, { task_id: "task_fixture", claim_id: currentClaim, prompt: "What is the capital of France?", max_tokens: 64 }),
          ...(!options.legacy ? { buyer_public_key: buyerKey, judge_public_key: judgeKey } : {}),
        } }; break;
      }
      case "get_recipient_keys": data = { buyer_public_key: buyerKey, judge_public_key: judgeKey }; break;
      case "start_task": state = "RUNNING"; break;
      case "get_task":
        if (actor !== claimOwner) return error("FORBIDDEN");
        data = { task: { status: state, claim_id: currentClaim } }; break;
      case "submit_result": {
        const buyerBytes = open(buyer, args.result_enc_buyer as Envelope);
        const judgeBytes = open(judge, args.result_enc_judge as Envelope);
        if (sha256Hex(buyerBytes) !== args.commitment_sha256 || fromUtf8(buyerBytes) !== fromUtf8(judgeBytes)) throw new Error("COMMITMENT_FAILED");
        result = JSON.parse(fromUtf8(buyerBytes)); outputVerified = true; state = "SUBMITTED";
        data = { result_id: "result_fixture" }; break;
      }
      case "release_task": if (state !== "SUBMITTED") state = "OPEN"; break;
      default: throw new Error(`UNKNOWN_TOOL_${name}`);
    }
    return ok({ content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data });
  };
  return { fetch: handle as typeof fetch, calls, setDelay: (ms: number) => { delayMs = ms; }, reset: () => { state = "OPEN"; }, summary: () => ({ state, result, claimKey, inputChars, outputVerified }) };
}
