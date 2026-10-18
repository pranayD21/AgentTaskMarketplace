import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MemoryDb, parseSchema } from "../src/memdb.ts";

const schema = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");

describe("memdb", () => {
  it("parses every table and the v0.2 columns from db/schema.sql", () => {
    const tables = parseSchema(schema);
    expect([...tables.keys()].sort()).toEqual(["agents", "events", "jobs", "provider_budget", "results", "sellers", "settlements", "tasks", "verdicts"]);
    expect(tables.get("tasks")!.columns.has("claim_runner_pubkey_b64")).toBe(true);
    expect(tables.get("sellers")!.columns.has("last_claim_key_id")).toBe(true);
  });

  it("applies defaults and refuses unknown columns, nulls and duplicates like Postgres", async () => {
    const db = new MemoryDb(schema);
    const ok = await db.from("events").insert({ type: "x" }).select();
    expect(ok.error).toBeNull();
    expect(ok.data).toMatchObject([{ id: 1, type: "x", meta: {} }]);

    expect((await db.from("tasks").update({ no_such_column: 1 }).eq("id", "t")).error).toMatchObject({ code: "PGRST204" });
    expect((await db.from("events").insert({ meta: {} })).error).toMatchObject({ code: "23502" });
    await db.from("agents").insert({ id: "a1", kind: "buyer", display_name: "a", api_key_hash: "h" });
    expect((await db.from("agents").insert({ id: "a2", kind: "buyer", display_name: "b", api_key_hash: "h" })).error).toMatchObject({ code: "23505" });
  });

  it("filters, orders, limits and returns rows only when asked", async () => {
    const db = new MemoryDb(schema);
    for (const [i, t] of ["a", "b", "c"].entries()) await db.from("events").insert({ type: t, task_id: i === 1 ? null : "t" });
    const res = await db.from("events").select("type").eq("task_id", "t").order("id", { ascending: false }).limit(1);
    expect(res.data).toEqual([{ type: "c" }]);
    expect((await db.from("events").select("*").eq("task_id", null)).data).toEqual([]); // = NULL never matches
    expect((await db.from("events").update({ type: "z" }).in("type", ["a", "b"])).data).toBeNull();
    expect((await db.from("events").update({ type: "y" }).eq("type", "z").select()).data).toHaveLength(2);
  });
});
