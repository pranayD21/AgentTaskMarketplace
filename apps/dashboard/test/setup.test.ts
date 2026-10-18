import { describe, expect, it } from "vitest";
import { defaultModel, deriveSetup } from "../src/lib/setup";
import type { Status } from "../src/lib/api";

const base = (over: Partial<Status> = {}): Status => ({
  buyer_id: "buyer", buyer_payment: { buyer_payment_status: "READY" }, provider_budget: null,
  machine: { hostname: "mac", chip: "Apple M4", cpu_cores: 10, memory_bytes: 32e9, free_memory_bytes: 8e9, load_average_1m: 1, ollama_online: true, models: [{ name: "qwen3:8b", size: 5e9 }], loaded_models: [] },
  worker: { service: "stopped", prepared: true, payout_status: "ACTIVE" },
  owner: { user_id: "human", email: "owner@example.test" }, seller_id: "seller", allowed_models: ["qwen3:8b"],
  phase: "", error: null, busy: false, payments_label: "Stripe TEST MODE", ...over,
});

describe("setup gating", () => {
  it("lets an existing seller enable chat while its worker keeps running", () => {
    const s = deriveSetup(base({ buyer_id: null, buyer_payment: null, worker: { service: "running", prepared: true, payout_status: "ACTIVE" } }));
    expect(s.googleLabel).toBe("Enable chat with Google");
    expect(s.canSend).toBe(false);
    expect(s.chatNotice).toContain("worker can keep running");
    expect(s.selling).toBe(true);
    expect(s.entryComplete).toBe(false);
  });
  it.each(["SETUP_REQUIRED", "READY"])("requires buying even when selling payouts are ready: %s", (payment) => {
    const s = deriveSetup(base({ buyer_payment: { buyer_payment_status: payment } }));
    expect(s.canSend).toBe(payment === "READY");
    expect(s.canStartSelling).toBe(payment === "READY");
    expect(s.entryComplete).toBe(payment === "READY");
    expect(s.readyCount).toBe(payment === "READY" ? 4 : 3);
  });
  it("keeps the onboarding gate closed until Google and buying are both done", () => {
    expect(deriveSetup(undefined).entryComplete).toBe(false);
    expect(deriveSetup(base({ owner: null, buyer_id: null, buyer_payment: null })).googleLabel).toBe("Continue with Google");
    expect(deriveSetup(base()).entryComplete).toBe(true);
  });
  it("prefers qwen3:8b, then the previous choice, then the first installed model", () => {
    expect(defaultModel(["a", "qwen3:8b"])).toBe("qwen3:8b");
    expect(defaultModel(["a", "qwen3:8b"], "a")).toBe("a");
    expect(defaultModel(["b"], "missing")).toBe("b");
    expect(defaultModel([])).toBe("");
  });
});
