import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Dashboard, dashboardUrl, leaseLabel, stripeLink } from "../src/data";
import { DashboardView } from "../src/App";

const stamp = "2026-10-18T02:00:00.000Z";
const privateMarker = "PRIVATE_DATA_MUST_NOT_RENDER";
function fixture() {
  return {
    generated_at: stamp,
    payments: { mode: "card", label: privateMarker },
    db: privateMarker,
    counts: { RUNNING: 1, APPROVED: 2 },
    tasks: [
      {
        task_id: "task_synthetic",
        buyer_id: "buyer_synthetic",
        allowed_models: ["qwen3:8b"],
        max_price_cents: 100,
        max_runtime_s: 180,
        status: "RUNNING",
        created_at: stamp,
        expires_at: stamp,
        claim_id: "claim_synthetic",
        seller_id: "seller_synthetic",
        model_id: "qwen3:8b",
        price_cents: 75,
        lease_expires_at: "2026-10-18T02:01:01.000Z",
        payment: {
          mode: "card",
          state: "HELD",
          stripe_payment_intent_id: "pi_test123",
          payment_link: null,
        },
        inkbox_context_id: null,
        prompt: privateMarker,
        context: privateMarker,
        rubric: privateMarker,
        payload_enc_seller: privateMarker,
      },
    ],
    sellers: [
      {
        seller_id: "seller_synthetic",
        display_name: "Demo seller",
        status: "ACTIVE",
        models: [{ model_id: "qwen3:8b", ask_cents: 75 }],
        runner: {
          key_source: "per-claim",
          public_key: {
            key_id: "runner_synthetic",
            public_key_b64: "x".repeat(44),
          },
          wasm_sha256: null,
          runtime: "node-unsandboxed",
          wassette_version: null,
        },
        reputation: { approvals: 2, rejections: 1, strikes: 1 },
        inkbox_handle: null,
        last_seen: stamp,
      },
    ],
    verdicts: [
      {
        id: "verdict_synthetic",
        task_id: "task_synthetic",
        verdict: "APPROVE",
        reason_code: "RUBRIC_MATCH",
        reason_public: privateMarker,
        replacement_enc_buyer: privateMarker,
        created_at: stamp,
      },
    ],
    settlements: [
      {
        id: "settle_synthetic",
        task_id: "task_synthetic",
        kind: "STRIPE_TEST",
        state: "RECORDED",
        seller_payout_cents: 75,
        buyer_refund_cents: 25,
        note: `${privateMarker} PENDING_ONBOARDING`,
        created_at: stamp,
      },
    ],
    events: [
      {
        id: 123,
        task_id: "task_synthetic",
        type: "task.claimed",
        meta: { prompt: privateMarker },
        created_at: stamp,
      },
    ],
  };
}

describe("public dashboard boundary", () => {
  it("discards private fields and free-form reasons, labels runtime, test money, and pending transfers", () => {
    const data = Dashboard.parse(fixture());
    expect(data.events[0]!.id).toBe("123");
    expect(JSON.stringify(data)).not.toContain(privateMarker);
    const html = renderToStaticMarkup(
      <DashboardView
        data={data}
        now={Date.parse(stamp)}
        filter="ALL"
        search=""
      />,
    );
    expect(html).not.toContain(privateMarker);
    for (const visible of [
      "UNSANDBOXED",
      "Latest claim",
      "STRIPE_TEST",
      "PENDING_ONBOARDING",
      "$0.75",
      "$0.25",
      "1:01",
      "https://dashboard.stripe.com/test/payments/pi_test123",
    ])
      expect(html).toContain(visible);
  });
  it("labels simulated payments and sandbox runtime", () => {
    const raw = fixture();
    raw.payments.mode = "mock";
    raw.db = "MEMORY — in-process tables, dev/test only, lost on restart";
    raw.tasks[0]!.payment.mode = "mock";
    raw.settlements[0]!.kind = "MOCK";
    raw.sellers[0]!.runner.runtime = "wassette";
    const html = renderToStaticMarkup(
      <DashboardView
        data={Dashboard.parse(raw)}
        now={Date.parse(stamp)}
        filter="ALL"
        search=""
      />,
    );
    expect(html).toContain("MOCK");
    expect(html).toContain("MEMORY · TEMPORARY DEMO DATA");
    expect(html).toContain("wassette");
    expect(html).not.toContain("UNSANDBOXED");
  });
  it("does not display unrecognized event text", () => {
    const raw = fixture();
    raw.events[0]!.type = privateMarker;
    expect(Dashboard.parse(raw).events[0]!.type).toBe("marketplace.event");
  });
  it("keeps the board available for an unfamiliar settlement rail without rendering arbitrary text", () => {
    const raw = fixture();
    raw.settlements[0]!.kind = privateMarker;
    const data = Dashboard.parse(raw);
    const html = renderToStaticMarkup(
      <DashboardView data={data} now={Date.parse(stamp)} filter="ALL" search="" />,
    );
    expect(html).toContain("UNRECOGNIZED PAYMENT RAIL");
    expect(html).toContain("Demo seller");
    expect(html).not.toContain(privateMarker);
  });
  it("filters tasks and gives an empty state without hiding the rest of the network", () => {
    const html = renderToStaticMarkup(
      <DashboardView
        data={Dashboard.parse(fixture())}
        now={Date.parse(stamp)}
        filter="OPEN"
        search=""
      />,
    );
    expect(html).toContain("No tasks match");
    expect(html).toContain("Demo seller");
  });
  it("rejects a malformed response instead of turning it into zero counts", () => {
    expect(Dashboard.safeParse({ counts: {} }).success).toBe(false);
  });
});

describe("links and leases", () => {
  it("normalizes origins and MCP URLs; rejects credentials and unsafe schemes", () => {
    expect(dashboardUrl("http://localhost:3000/mcp")).toBe(
      "http://localhost:3000/api/dashboard",
    );
    expect(dashboardUrl("https://host.test/base/")).toBe(
      "https://host.test/base/api/dashboard",
    );
    expect(() => dashboardUrl("javascript:alert(1)")).toThrow();
    expect(() => dashboardUrl("https://token@host.test")).toThrow();
    expect(stripeLink("pi_test123")).toContain("/test/payments/pi_test123");
    expect(stripeLink("https://evil.test")).toBeUndefined();
  });
  it("never displays a negative or terminal-state lease", () => {
    expect(leaseLabel("RUNNING", stamp, Date.parse(stamp))).toContain(
      "Expired",
    );
    expect(leaseLabel("APPROVED", stamp, Date.parse(stamp) - 1000)).toBe("—");
    expect(leaseLabel("RUNNING", "invalid", 0)).toBe("Unknown");
  });
});
