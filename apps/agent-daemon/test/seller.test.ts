import { expect, it } from "vitest";
import { sellerGrants } from "../src/runtime/wassette.js";
import { recoverClaim } from "../src/seller.js";

it("grants the configured hosts and only the seller's API key", () => {
  expect(sellerGrants("https://marketplace.example/mcp", "http://192.168.1.12:11434"))
    .toEqual({ network: ["https://marketplace.example", "http://192.168.1.12:11434"], env: ["AGENT_API_KEY"] });
  expect(sellerGrants("http://127.0.0.1:3000/mcp", "http://localhost:11434", true).network).toEqual(["http://127.0.0.1:3000"]);
});
it("rejects a denial demo that would still grant the same host", () => {
  expect(() => sellerGrants("http://localhost:3000/mcp", "http://localhost:11434", true)).toThrow();
});
it.each(["SUBMITTED", "APPROVED", "OPEN"])("does not release a %s task after a lost response", async (status) => {
  const calls: string[] = [];
  await recoverClaim({ call: async (name: string) => { calls.push(name); return { task: { status, claim_id: "c" } } as any; } }, "t", () => {});
  expect(calls).toEqual(["get_task"]);
});
it("releases an interrupted active claim", async () => {
  const calls: string[] = [];
  await recoverClaim({ call: async (name: string) => { calls.push(name); return { task: { status: "RUNNING", claim_id: "c" } } as any; } }, "t", () => {});
  expect(calls).toEqual(["get_task", "release_task"]);
});
