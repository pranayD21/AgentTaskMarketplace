/**
 * In-process stand-in for the slice of Insforge's PostgREST client the
 * service uses (from/select/insert/update, eq/in/lt, order, limit). Tables and
 * columns are parsed from db/schema.sql, so writing a column the schema does
 * not have fails here exactly as it would against Insforge. DB_MODE=memory
 * only: tests and offline development; nothing persists across restarts.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type Row = Record<string, unknown>;
type DbError = { code: string; message: string; details?: string };
type DbResult = { data: unknown; error: DbError | null };

interface Column {
  name: string;
  notNull: boolean;
  unique: boolean;
  serial: boolean;
  default?: () => unknown;
}

interface Table {
  name: string;
  columns: Map<string, Column>;
  rows: Row[];
  seq: number;
}

// ---------------------------------------------------------------------------
// Schema parsing (enough for db/schema.sql; not a general SQL parser)
// ---------------------------------------------------------------------------

function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0, quoted = false, cur = "";
  for (const ch of body) {
    if (ch === "'") quoted = !quoted;
    if (!quoted && ch === "(") depth++;
    if (!quoted && ch === ")") depth--;
    if (!quoted && depth === 0 && ch === ",") { parts.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function parseDefault(expr: string): () => unknown {
  const e = expr.trim();
  if (/^now\(\)$/i.test(e)) return () => new Date().toISOString();
  if (/^-?\d+(\.\d+)?$/.test(e)) { const n = Number(e); return () => n; }
  const json = /^'(.*)'::jsonb?$/is.exec(e);
  if (json) { const text = json[1]!.replace(/''/g, "'"); return () => JSON.parse(text); }
  const str = /^'(.*)'$/s.exec(e);
  if (str) { const v = str[1]!.replace(/''/g, "'"); return () => v; }
  if (/^(true|false)$/i.test(e)) { const b = e.toLowerCase() === "true"; return () => b; }
  throw new Error(`memdb: unsupported default ${e}`);
}

function parseColumn(def: string): Column | null {
  if (/^(primary|unique|constraint|foreign|check)\b/i.test(def)) return null;
  const [name, type = ""] = def.split(/\s+/);
  const col: Column = {
    name: name!,
    notNull: /\bnot null\b/i.test(def) || /\bprimary key\b/i.test(def),
    unique: /\bunique\b/i.test(def) || /\bprimary key\b/i.test(def),
    serial: /serial$/i.test(type),
  };
  const d = /\bdefault\s+('(?:[^']|'')*'(?:::\w+)?|[\w.()-]+)/i.exec(def);
  // Postgres array literal: only the empty array is used in db/schema.sql.
  if (d && type.endsWith("[]") && d[1] === "'{}'") col.default = () => [];
  else if (d) col.default = parseDefault(d[1]!);
  return col;
}

export function parseSchema(sql: string): Map<string, Table> {
  const clean = sql.replace(/--[^\n]*/g, "");
  const tables = new Map<string, Table>();
  for (const m of clean.matchAll(/create table if not exists (\w+)\s*\(([\s\S]*?)\n\);/gi)) {
    const table: Table = { name: m[1]!, columns: new Map(), rows: [], seq: 0 };
    for (const part of splitTopLevel(m[2]!)) {
      const col = parseColumn(part);
      if (col) table.columns.set(col.name, col);
    }
    tables.set(table.name, table);
  }
  for (const m of clean.matchAll(/alter table (\w+) add column if not exists ([^;]+);/gi)) {
    const table = tables.get(m[1]!);
    const col = parseColumn(m[2]!.trim());
    if (table && col) table.columns.set(col.name, col);
  }
  return tables;
}

// ---------------------------------------------------------------------------
// Query builder
// ---------------------------------------------------------------------------

type Filter = (row: Row) => boolean;

function comparable(v: unknown): number | string {
  if (typeof v === "number") return v;
  const s = String(v);
  const t = /^\d{4}-\d\d-\d\dT/.test(s) ? Date.parse(s) : NaN;
  return Number.isNaN(t) ? s : t;
}

function clone<T>(v: T): T {
  return structuredClone(v);
}

class Query implements PromiseLike<DbResult> {
  private op: "select" | "insert" | "update" = "select";
  private columns = "*";
  private returning = false;
  private values: Row[] = [];
  private patch: Row = {};
  private filters: Filter[] = [];
  private orders: { col: string; ascending: boolean }[] = [];
  private max: number | undefined;

  constructor(private readonly table: Table, private readonly fault: (op: "select" | "insert" | "update") => DbError | null = () => null) {}

  select(columns = "*"): this {
    if (this.op === "select") this.columns = columns;
    else { this.returning = true; this.columns = columns; }
    return this;
  }
  insert(values: Row | Row[]): this {
    this.op = "insert";
    this.values = Array.isArray(values) ? values : [values];
    return this;
  }
  update(patch: Row): this {
    this.op = "update";
    this.patch = patch;
    return this;
  }
  // SQL semantics: comparisons with NULL never match.
  eq(col: string, value: unknown): this {
    this.filters.push((r) => r[col] != null && value != null && r[col] === value);
    return this;
  }
  in(col: string, values: readonly unknown[]): this {
    this.filters.push((r) => r[col] != null && values.includes(r[col]));
    return this;
  }
  /** PostgREST `is`: matches NULL / true / false exactly (unlike eq, which never matches NULL). */
  is(col: string, value: null | boolean): this {
    this.filters.push((r) => (r[col] ?? null) === value);
    return this;
  }
  lt(col: string, value: unknown): this {
    this.filters.push((r) => r[col] != null && value != null && comparable(r[col]) < comparable(value));
    return this;
  }
  order(col: string, opts: { ascending?: boolean } = {}): this {
    this.orders.push({ col, ascending: opts.ascending ?? true });
    return this;
  }
  limit(n: number): this {
    this.max = n;
    return this;
  }

  then<A = DbResult, B = never>(onfulfilled?: ((v: DbResult) => A | PromiseLike<A>) | null, onrejected?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    // Runs synchronously at await time, so each statement is atomic like one SQL statement.
    let result: DbResult;
    try {
      result = this.execute();
    } catch (err) {
      result = { data: null, error: err as DbError };
    }
    return Promise.resolve(result).then(onfulfilled, onrejected);
  }

  private fail(code: string, message: string): never {
    throw { code, message } satisfies DbError;
  }

  private checkColumns(row: Row): void {
    for (const k of Object.keys(row)) {
      if (!this.table.columns.has(k)) this.fail("PGRST204", `Could not find the '${k}' column of '${this.table.name}' in the schema cache`);
    }
  }

  private checkRow(row: Row, ignore?: Row): void {
    for (const col of this.table.columns.values()) {
      if (col.notNull && row[col.name] == null) this.fail("23502", `null value in column "${col.name}" of relation "${this.table.name}" violates not-null constraint`);
      if (col.unique && row[col.name] != null && this.table.rows.some((r) => r !== ignore && r[col.name] === row[col.name])) {
        this.fail("23505", `duplicate key value violates unique constraint on "${this.table.name}.${col.name}"`);
      }
    }
  }

  private project(rows: Row[]): Row[] {
    if (this.columns.trim() === "*") return rows.map(clone);
    const cols = this.columns.split(",").map((c) => c.trim()).filter(Boolean);
    for (const c of cols) if (!this.table.columns.has(c)) this.fail("42703", `column ${this.table.name}.${c} does not exist`);
    return rows.map((r) => Object.fromEntries(cols.map((c) => [c, clone(r[c])])));
  }

  private matching(): Row[] {
    let rows = this.table.rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.orders.length) {
      rows = [...rows].sort((a, b) => {
        for (const { col, ascending } of this.orders) {
          const x = a[col], y = b[col];
          if (x === y) continue;
          if (x == null) return ascending ? 1 : -1; // Postgres: NULLS LAST ascending, FIRST descending
          if (y == null) return ascending ? -1 : 1;
          const cmp = comparable(x) < comparable(y) ? -1 : 1;
          return ascending ? cmp : -cmp;
        }
        return 0;
      });
    }
    return this.max === undefined ? rows : rows.slice(0, this.max);
  }

  private execute(): DbResult {
    const injected = this.fault(this.op);
    if (injected) throw injected;
    if (this.op === "select") return { data: this.project(this.matching()), error: null };

    if (this.op === "insert") {
      const prepared: Row[] = [];
      for (const v of this.values) {
        this.checkColumns(v);
        const row: Row = {};
        for (const col of this.table.columns.values()) {
          if (v[col.name] !== undefined) row[col.name] = clone(v[col.name]);
          else if (col.serial) row[col.name] = ++this.table.seq;
          else if (col.default) row[col.name] = col.default();
          else row[col.name] = null;
        }
        this.checkRow(row);
        if (prepared.some((p) => [...this.table.columns.values()].some((c) => c.unique && p[c.name] != null && p[c.name] === row[c.name]))) {
          this.fail("23505", `duplicate key value violates unique constraint on "${this.table.name}"`);
        }
        prepared.push(row);
      }
      this.table.rows.push(...prepared);
      return { data: this.returning ? this.project(prepared) : null, error: null };
    }

    this.checkColumns(this.patch);
    const targets = this.matching();
    const next = targets.map((r) => ({ ...r, ...clone(this.patch) }));
    next.forEach((r, i) => this.checkRow(r, targets[i]));
    targets.forEach((r, i) => Object.assign(r, next[i]));
    return { data: this.returning ? this.project(targets) : null, error: null };
  }
}

type Fault = { table: string; op: "select" | "insert" | "update"; remaining: number };

export class MemoryDb {
  readonly tables: Map<string, Table>;
  private faults: Fault[] = [];
  constructor(schemaSql: string) {
    this.tables = parseSchema(schemaSql);
  }
  from(name: string): Query {
    const table = this.tables.get(name);
    if (!table) throw new Error(`memdb: unknown table ${name}`);
    return new Query(table, (op) => this.takeFault(name, op));
  }
  /** Tests: make the next `times` statements of this kind fail as if the database were unreachable. */
  injectFault(table: string, op: Fault["op"], times = 1): void {
    this.faults.push({ table, op, remaining: times });
  }
  clearFaults(): void {
    this.faults = [];
  }
  private takeFault(table: string, op: Fault["op"]): DbError | null {
    const f = this.faults.find((x) => x.table === table && x.op === op && x.remaining > 0);
    if (!f) return null;
    f.remaining--;
    return { code: "INJECTED", message: `injected ${op} failure on ${table}` };
  }
  /** Rows of a table (copies), for aggregates the builder cannot express. */
  rows(name: string): Row[] {
    return (this.tables.get(name)?.rows ?? []).map(clone);
  }
}

let instance: MemoryDb | undefined;

export function memoryDb(): MemoryDb {
  if (!instance) {
    // src/memdb.ts under `mcp-use dev` and tests; the package root under `mcp-use start` (bundled build).
    const candidates = [fileURLToPath(new URL("../db/schema.sql", import.meta.url)), path.resolve(process.cwd(), "db/schema.sql")];
    const file = candidates.find((f) => existsSync(f));
    if (!file) throw new Error(`DB_MODE=memory needs db/schema.sql; looked in ${candidates.join(", ")}`);
    instance = new MemoryDb(readFileSync(file, "utf8"));
  }
  return instance;
}
