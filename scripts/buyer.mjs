#!/usr/bin/env node
// Buyer-only MCP client. No automatic retries of registrations or payments.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { JobError, planJob, saveJob, loadJob, runJob, collectJob, taskOfferFields } from "../skills/marketplace/scripts/job.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const help = `Agent Task Marketplace buyer (Node >=22.22)
  info | sellers | prices | tools                  Public discovery; no registration
  whoami | tasks                         Register once, reuse buyer identity
  post <prompt> --expect <text>           Case-insensitive substring rubric
  post --prompt-file <file> --criteria <text>
  task <id> | result <id> | cancel <id>    Inspect, read result, cancel OPEN task
  wait <id> [--timeout 180]               Poll every 3s until terminal/timeout
  job-plan <input.json> --name <name> --parts 2 --budget 200
  job-run <name> [--timeout 180]          Post/resume saved parts once
  job-status <name> | job-result <name>   Safe progress / private aggregate
Post flags: --models qwen3:8b --price 100 --max-tokens 400
            --context <text> | --context-file <file>
            --runtime 180 --expires 3600
Use exactly one of --expect or --criteria. Amounts are integer US cents.
MARKETPLACE_URL selects the MCP endpoint; ATM_API_KEY reuses a buyer.
ATM_BUYER_STATE overrides .atm-state/buyer.json (bound to its endpoint).
SPEND_CAP_CENTS sets the initial cap only (default 2000).
Posting sends private text to the trusted marketplace and judge immediately.
Only metadata is public. Seller receives an envelope after claiming.
Stripe uses test mode; MOCK is simulated. Decryption happens on the server.
`;
export class BuyerError extends Error {
  constructor(code, message, nextAction, retryable = false) {
    super(message);
    Object.assign(this, { code, nextAction, retryable });
  }
}
const invalid = (message) => {
  throw new BuyerError(
    "USAGE_ERROR",
    message,
    "Run node scripts/buyer.mjs --help.",
  );
};
function integer(value, name, min, max) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max)
    invalid(`${name} must be an integer from ${min} to ${max}.`);
  return n;
}
export function parseCommand(argv) {
  const [command, ...rest] = argv;
  if (!command || ["--help", "help", "-h"].includes(command))
    return { command: "help" };
  const noArgs = ["info", "sellers", "prices", "tools", "whoami", "tasks"];
  if (
    ![...noArgs, "post", "task", "result", "cancel", "wait", "job-plan", "job-run", "job-status", "job-result"].includes(command)
  )
    invalid("Unknown command.");
  const values = {},
    positionals = [];
  const flags =
    command === "post"
      ? [
          "prompt-file",
          "context",
          "context-file",
          "expect",
          "criteria",
          "models",
          "max",
          "price",
          "max-tokens",
          "runtime",
          "expires",
        ]
      : command === "wait" || command === "job-run"
        ? ["timeout"]
        : command === "job-plan" ? ["name", "parts", "budget"] : [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const name = arg.slice(2);
    if (
      !flags.includes(name) ||
      Object.hasOwn(values, name) ||
      !rest[i + 1] ||
      rest[i + 1].startsWith("--")
    )
      invalid(`Invalid, repeated, or missing value for --${name}.`);
    values[name] = rest[++i];
  }
  if (noArgs.includes(command)) {
    if (positionals.length) invalid(`${command} takes no arguments.`);
    return { command };
  }
  if (command.startsWith("job-")) {
    if (positionals.length !== 1) invalid("Supply exactly one job name or input file.");
    const name = command === "job-plan" ? values.name : positionals[0];
    if (!name || !/^[A-Za-z0-9_-]{1,48}$/.test(name)) invalid("Use a job name of 1–48 letters, digits, dashes or underscores.");
    return { command, name, input: command === "job-plan" ? positionals[0] : undefined,
      parts: integer(values.parts ?? 2, "--parts", 2, 20),
      budget: command === "job-plan" ? integer(values.budget, "--budget", 2, 100000) : undefined,
      timeout: integer(values.timeout ?? 180, "--timeout", 1, 3600) };
  }
  if (command !== "post") {
    if (positionals.length !== 1 || !positionals[0].trim())
      invalid(`${command} needs exactly one task ID.`);
    return {
      command,
      args: { task_id: positionals[0] },
      timeout: integer(values.timeout ?? 180, "--timeout", 1, 3600),
    };
  }
  if (
    values["prompt-file"] ? positionals.length !== 0 : positionals.length !== 1
  )
    invalid("Supply one prompt or --prompt-file, not both.");
  if (!!values.expect === !!values.criteria)
    invalid("Supply exactly one of --expect or --criteria.");
  if (values.context && values["context-file"])
    invalid("Use --context or --context-file, not both.");
  const prompt = values["prompt-file"]
    ? fs.readFileSync(values["prompt-file"], "utf8")
    : positionals[0];
  const context = values["context-file"]
    ? fs.readFileSync(values["context-file"], "utf8")
    : values.context;
  if (!prompt.trim() || prompt.length > 20000)
    invalid("Prompt must contain 1–20,000 characters.");
  if (context && context.length > 60000)
    invalid("Context must be at most 60,000 characters.");
  if (!(values.expect ?? values.criteria).trim())
    invalid("Rubric cannot be blank.");
  const models = [
    ...new Set((values.models ?? "qwen3:8b").split(",").map((v) => v.trim())),
  ];
  if (models.some((v) => !v)) invalid("Model IDs cannot be blank.");
  if (values.max && values.price && Number(values.max) !== Number(values.price)) invalid("--max is a deprecated alias and must equal --price.");
  return {
    command,
    args: {
      prompt,
      ...(context !== undefined ? { context } : {}),
      allowed_models: models,
      price_cents: integer(values.price ?? values.max ?? 100, "--price", 1, 100000),
      max_tokens: integer(values["max-tokens"] ?? 400, "--max-tokens", 1, 4096),
      max_runtime_s: integer(values.runtime ?? 180, "--runtime", 1, 1800),
      expires_in_s: integer(values.expires ?? 3600, "--expires", 1, 86400),
      rubric: values.expect
        ? { kind: "contains_text", expected_text: values.expect }
        : { kind: "llm_rubric", criteria: values.criteria },
    },
  };
}
export function normalizeEndpoint(value) {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    invalid(
      "MARKETPLACE_URL must be an HTTP(S) MCP URL without credentials or query parameters.",
    );
  return url.toString().replace(/\/$/, "");
}
export function parseRpcResponse(body, contentType, id) {
  const messages = contentType.includes("text/event-stream")
    ? body
        .replaceAll("\r\n", "\n")
        .split("\n\n")
        .flatMap((event) => {
          const data = event
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n");
          return data ? [JSON.parse(data)] : [];
        })
    : [JSON.parse(body)];
  const message = messages.find((m) => m.id === id);
  if (!message)
    throw new BuyerError(
      "PROTOCOL_ERROR",
      "MCP response did not contain the requested result.",
    );
  if (message.error)
    throw new BuyerError(
      "RPC_ERROR",
      "Marketplace rejected the MCP request.",
      "Check the endpoint and protocol compatibility.",
    );
  return message.result;
}
export function createClient(endpoint, key, fetcher = fetch) {
  const recovery =
    "Before repeating a post, use tasks to check whether it succeeded. Do not automatically repeat a post.";
  let session,
    protocol = "2025-06-18",
    id = 0;
  async function rpc(method, params, notification = false) {
    const requestId = ++id;
    let response;
    try {
      response = await fetcher(endpoint, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(30000),
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...(method !== "initialize"
            ? { "mcp-protocol-version": protocol }
            : {}),
          ...(session ? { "mcp-session-id": session } : {}),
          ...(key ? { authorization: `Bearer ${key}` } : {}),
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          ...(notification ? {} : { id: requestId }),
          method,
          params,
        }),
      });
    } catch {
      throw new BuyerError(
        "CONNECTION_FAILED",
        "Marketplace request failed or timed out.",
        `Check MARKETPLACE_URL. ${recovery}`,
      );
    }
    if (!response.ok)
      throw new BuyerError(
        `HTTP_${response.status}`,
        `Marketplace returned HTTP ${response.status}.`,
        `Check endpoint and buyer key. ${recovery}`,
      );
    session = response.headers.get("mcp-session-id") ?? session;
    if (notification) {
      await response.body?.cancel();
      return;
    }
    let body;
    try {
      body = await response.text();
    } catch {
      throw new BuyerError(
        "CONNECTION_FAILED",
        "Marketplace response was interrupted or timed out.",
        recovery,
      );
    }
    try {
      return parseRpcResponse(
        body,
        response.headers.get("content-type") ?? "",
        requestId,
      );
    } catch (error) {
      if (error instanceof BuyerError) {
        error.nextAction ??= recovery;
        throw error;
      }
      throw new BuyerError(
        "PROTOCOL_ERROR",
        "Marketplace returned an incomplete or invalid MCP response.",
        recovery,
      );
    }
  }
  return {
    async initialize() {
      const result = await rpc("initialize", {
        protocolVersion: protocol,
        capabilities: {},
        clientInfo: { name: "atm-buyer-cli", version: "0.2.0" },
      });
      protocol = result.protocolVersion ?? protocol;
      await rpc("notifications/initialized", {}, true);
    },
    async tool(name, args = {}) {
      const result = await rpc("tools/call", { name, arguments: args });
      const data =
        result.structuredContent ??
        JSON.parse(
          result.content?.find((c) => c.type === "text")?.text ?? "{}",
        );
      if (result.isError) {
        const e = data.error ?? {};
        throw new BuyerError(
          e.code ?? "TOOL_ERROR",
          e.message ?? "Marketplace tool failed.",
          e.next_action,
          e.retryable,
        );
      }
      return data;
    },
    async tools() {
      return rpc("tools/list", {});
    },
  };
}
export function readIdentity(statePath, endpoint) {
  if (!fs.existsSync(statePath)) return null;
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  if (state.marketplace_url !== endpoint)
    throw new BuyerError(
      "IDENTITY_ENDPOINT_MISMATCH",
      "Saved buyer belongs to a different or unspecified marketplace.",
      "Use ATM_API_KEY explicitly or choose a new ATM_BUYER_STATE path for this endpoint.",
    );
  if (typeof state.api_key !== "string" || !state.api_key.startsWith("atm_sk_"))
    throw new BuyerError("INVALID_IDENTITY", "The saved buyer key is invalid.");
  return state;
}
function writeIdentity(statePath, state) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true, mode: 0o700 });
  const temporary = `${statePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(state, null, 2), {
    mode: 0o600,
    flag: "wx",
  });
  fs.renameSync(temporary, statePath);
}
export function privateResult(data) {
  const result = data.result && {
    result_id: data.result.result_id,
    model_id: data.result.model_id,
    runtime_ms: data.result.runtime_ms,
    commitment_sha256: data.result.commitment_sha256,
    commitment_verified: data.result.commitment_verified,
    ...(data.result.commitment_verified === true
      ? { answer: data.result.answer }
      : {}),
  };
  const sellerAnswerWithheld = !!result && result.commitment_verified !== true;
  if (sellerAnswerWithheld && !data.replacement_answer)
    throw new BuyerError(
      "COMMITMENT_MISMATCH",
      "Seller result commitment could not be verified. Answer withheld.",
      "Inspect the verdict; do not trust the submitted answer.",
    );
  return {
    task: data.task,
    result,
    verdict: data.verdict,
    replacement_status: data.replacement_status ?? data.task?.replacement_status ?? null,
    replacement_answer: data.replacement_answer,
    ...(sellerAnswerWithheld ? { seller_answer_withheld: true } : {}),
    settlement: data.settlement,
    guidance: data.guidance,
  };
}
export async function main(argv = process.argv.slice(2)) {
  const parsed = parseCommand(argv);
  if (parsed.command === "help") {
    console.log(help);
    return;
  }
  if (fs.existsSync(path.join(root, ".env")))
    process.loadEnvFile(path.join(root, ".env"));
  const endpoint = normalizeEndpoint(
    process.env.MARKETPLACE_URL ?? "http://localhost:3000/mcp",
  );
  const statePath = path.resolve(
    process.env.ATM_BUYER_STATE ?? path.join(root, ".atm-state/buyer.json"),
  );
  const jobFile = parsed.name ? path.join(process.env.ATM_JOB_DIR ?? path.join(root, ".atm-state/jobs"), `${parsed.name}.json`) : null;
  if (parsed.command === "job-plan") {
    if (fs.existsSync(jobFile)) invalid("Job name already exists; resume it instead of overwriting its request keys.");
    const state = planJob(JSON.parse(fs.readFileSync(parsed.input, "utf8")), { endpoint, parts: parsed.parts, budget: parsed.budget });
    saveJob(jobFile, state, { createOnly: true });
    console.log(JSON.stringify({ status: "PLANNED", name: parsed.name, parts: state.plan.parts.length, budget_cents: state.plan.budget_cents, offers_cents: state.plan.parts.map(part => part.offer_cents) }));
    return;
  }
  const isPublic = ["info", "sellers", "prices", "tools"].includes(parsed.command);
  let key = isPublic
    ? undefined
    : (process.env.ATM_API_KEY ?? readIdentity(statePath, endpoint)?.api_key);
  if (parsed.command.startsWith("job-") && !key) throw new JobError("JOB_BUYER_REQUIRED", "Jobs require an existing authorized buyer.", "Use the original buyer credential; registration is never automatic for jobs.");
  let client = createClient(endpoint, key);
  await client.initialize();
  if (!isPublic && !key) {
    const cap = integer(
      process.env.SPEND_CAP_CENTS ?? 2000,
      "SPEND_CAP_CENTS",
      1,
      100000,
    );
    const r = await client.tool("register_agent", {
      kind: "buyer",
      display_name: process.env.ATM_BUYER_NAME ?? "marketplace-buyer",
      spend_cap_cents: cap,
    });
    writeIdentity(statePath, {
      marketplace_url: endpoint,
      agent_id: r.agent_id,
      api_key: r.api_key,
    });
    console.error(
      `Registered buyer ${r.agent_id}; saved key locally (cap ${cap} test cents).`,
    );
    client = createClient(endpoint, r.api_key);
    await client.initialize();
  }
  const out = (value) => console.log(JSON.stringify(value, null, 2));
  const simple = {
    info: "marketplace_info",
    sellers: "list_sellers",
    prices: "market_price_observations",
    whoami: "whoami",
    tasks: "list_my_tasks",
    task: "get_task",
    cancel: "cancel_task",
  };
  if (parsed.command.startsWith("job-")) {
    const state = loadJob(jobFile);
    if (state.plan.endpoint !== endpoint) throw new JobError("JOB_ENDPOINT_MISMATCH", "Job belongs to a different marketplace.");
    if (state.buyer_id && (await client.tool("whoami")).agent_id !== state.buyer_id) throw new JobError("JOB_BUYER_CHANGED", "Use the original buyer for this job.");
    const result = parsed.command === "job-run"
      ? await runJob(jobFile, client, endpoint, { timeoutSeconds: parsed.timeout, postFields: taskOfferFields })
      : await collectJob(state, client);
    const { records, ...metadata } = result;
    out(parsed.command === "job-result" ? result : metadata);
  } else if (parsed.command === "tools")
    out(
      (await client.tools()).tools.map((t) => ({
        name: t.name,
        description: t.description,
      })),
    );
  else if (simple[parsed.command])
    out(await client.tool(simple[parsed.command], parsed.args));
  else if (parsed.command === "post") {
    const info = await client.tool("marketplace_info");
    if (parsed.args.price_cents < info.payments.min_cents)
      invalid(
        `--price must be at least ${info.payments.min_cents} cents in ${info.payments.mode} mode.`,
      );
    if (
      parsed.args.allowed_models.some(
        (id) => !info.models.some((m) => m.model_id === id),
      )
    )
      invalid(
        "A requested model is not allowlisted. Run info and sellers to choose an exact model ID.",
      );
    taskOfferFields(parsed.args.price_cents, info);
    out(await client.tool("post_task", parsed.args));
  } else if (parsed.command === "result")
    out(privateResult(await client.tool("get_result", parsed.args)));
  else if (parsed.command === "wait") {
    const deadline = Date.now() + parsed.timeout * 1000;
    let lastState;
    while (true) {
      const data = await client.tool("get_task", parsed.args);
      if (data.task.status !== lastState) {
        console.error(`${data.task.task_id}: ${data.task.status}`);
        lastState = data.task.status;
      }
      if (["APPROVED", "REJECTED"].includes(lastState)) {
        out(privateResult(await client.tool("get_result", parsed.args)));
        break;
      }
      if (["EXPIRED", "CANCELLED", "AWAITING_PAYMENT"].includes(lastState)) {
        out(data);
        break;
      }
      if (Date.now() >= deadline)
        throw new BuyerError(
          "WAIT_TIMEOUT",
          "Task is still pending; it was not cancelled.",
          `Run task or wait for ${parsed.args.task_id} later. Do not create a duplicate task.`,
          true,
        );
      await delay(Math.min(3000, deadline - Date.now()));
    }
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    const known = error instanceof BuyerError || error instanceof JobError;
    console.error(
      JSON.stringify(
        {
          error: {
            code: known ? error.code : "CLIENT_ERROR",
            message: known
              ? error.message
              : "Buyer client failed. Check arguments, files, and marketplace connection.",
            retryable: known && error.retryable,
            ...(known && error.nextAction
              ? { next_action: error.nextAction }
              : {}),
          },
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  });
}
