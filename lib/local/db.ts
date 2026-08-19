import { Pool, type QueryResultRow } from "pg";
import type { LocalResult } from "@/lib/local/types";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgres://fg_studio:fg_studio@postgres:5432/fg_studio",
});

type Filter = { column: string; operator: "eq" | "neq" | "in" | "is" | "gte" | "lte" | "lt"; value: unknown };
type Order = { column: string; ascending: boolean };

const identifier = (value: string) => {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) throw new Error(`Invalid SQL identifier: ${value}`);
  return `"${value}"`;
};

const columns = (value?: string) => {
  if (!value || value === "*") return "*";
  return value.split(",").map((part) => {
    const name = part.trim().split(/\s+as\s+/i)[0];
    return identifier(name);
  }).join(", ");
};

function normalizeValue(value: unknown) {
  if (value !== null && typeof value === "object") return JSON.stringify(value);
  return value;
}

function whereClause(filters: Filter[], params: unknown[]) {
  if (!filters.length) return "";
  const parts = filters.map((filter) => {
    const column = identifier(filter.column);
    if (filter.operator === "in") {
      const values = Array.isArray(filter.value) ? filter.value : [];
      if (!values.length) return "FALSE";
      params.push(values.map(normalizeValue));
      return `${column} = ANY($${params.length})`;
    }
    params.push(normalizeValue(filter.value));
    const placeholder = `$${params.length}`;
    if (filter.operator === "is") return filter.value === null ? `${column} IS NULL` : `${column} IS NOT NULL`;
    if (filter.operator === "neq") return `${column} <> ${placeholder}`;
    if (filter.operator === "gte") return `${column} >= ${placeholder}`;
    if (filter.operator === "lte") return `${column} <= ${placeholder}`;
    if (filter.operator === "lt") return `${column} < ${placeholder}`;
    return `${column} = ${placeholder}`;
  });
  return ` WHERE ${parts.join(" AND ")}`;
}

export class LocalQuery<T = any> implements PromiseLike<LocalResult<T[] | T | null>> {
  private action: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private selection = "*";
  private payload: Record<string, unknown> | Record<string, unknown>[] | null = null;
  private filters: Filter[] = [];
  private orders: Order[] = [];
  private maxRows: number | null = null;
  private one: "single" | "maybeSingle" | null = null;
  private head = false;
  private conflict: string | null = null;

  constructor(private readonly table: string) {}

  select(selection = "*", options?: { count?: "exact"; head?: boolean }) {
    if (this.action === "select") this.action = "select";
    this.selection = selection;
    this.head = Boolean(options?.head);
    return this;
  }

  insert(values: Record<string, unknown> | Record<string, unknown>[]) {
    this.action = "insert";
    this.payload = values;
    return this;
  }

  update(values: Record<string, unknown>) {
    this.action = "update";
    this.payload = values;
    return this;
  }

  delete() { this.action = "delete"; return this; }

  upsert(values: Record<string, unknown> | Record<string, unknown>[], options?: { onConflict?: string; ignoreDuplicates?: boolean }) {
    this.action = "upsert";
    this.payload = values;
    this.conflict = options?.onConflict || null;
    return this;
  }

  eq(column: string, value: unknown) { this.filters.push({ column, operator: "eq", value }); return this; }
  neq(column: string, value: unknown) { this.filters.push({ column, operator: "neq", value }); return this; }
  gte(column: string, value: unknown) { this.filters.push({ column, operator: "gte", value }); return this; }
  lte(column: string, value: unknown) { this.filters.push({ column, operator: "lte", value }); return this; }
  lt(column: string, value: unknown) { this.filters.push({ column, operator: "lt", value }); return this; }
  in(column: string, value: unknown[]) { this.filters.push({ column, operator: "in", value }); return this; }
  is(column: string, value: null) { this.filters.push({ column, operator: "is", value }); return this; }
  order(column: string, options?: { ascending?: boolean }) { this.orders.push({ column, ascending: options?.ascending !== false }); return this; }
  limit(value: number) { this.maxRows = value; return this; }
  single() { this.one = "single"; return this; }
  maybeSingle() { this.one = "maybeSingle"; return this; }

  then<TResult1 = LocalResult<T[] | T | null>, TResult2 = never>(
    onfulfilled?: ((value: LocalResult<T[] | T | null>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute(): Promise<LocalResult<T[] | T | null>> {
    try {
      const params: unknown[] = [];
      const table = identifier(this.table);
      const where = whereClause(this.filters, params);
      const order = this.orders.length ? ` ORDER BY ${this.orders.map((item) => `${identifier(item.column)} ${item.ascending ? "ASC" : "DESC"}`).join(", ")}` : "";
      const limit = this.maxRows === null ? "" : ` LIMIT ${Math.max(0, Math.floor(this.maxRows))}`;
      let result;

      if (this.action === "select") {
        const query = this.head
          ? `SELECT COUNT(*)::int AS count FROM ${table}${where}`
          : `SELECT ${columns(this.selection)} FROM ${table}${where}${order}${limit}`;
        result = await pool.query(query, params);
        if (this.head) return { data: null, error: null, count: Number(result.rows[0]?.count || 0) };
      } else if (this.action === "delete") {
        result = await pool.query(`DELETE FROM ${table}${where}`, params);
      } else {
        const rows = Array.isArray(this.payload) ? this.payload : [this.payload || {}];
        const keys = Object.keys(rows[0]);
        const values = rows.flatMap((row) => keys.map((key) => normalizeValue(row[key])));
        const tupleSize = keys.length;
        const tuples = rows.map((_, rowIndex) => `(${keys.map((_, keyIndex) => `$${rowIndex * tupleSize + keyIndex + 1}`).join(", ")})`).join(", ");
        if (this.action === "insert" || this.action === "upsert") {
          const conflict = this.action === "upsert" && this.conflict ? ` ON CONFLICT (${this.conflict.split(",").map(identifier).join(", ")}) DO UPDATE SET ${keys.map((key) => `${identifier(key)} = EXCLUDED.${identifier(key)}`).join(", ")}` : "";
          result = await pool.query(`INSERT INTO ${table} (${keys.map(identifier).join(", ")}) VALUES ${tuples}${conflict} RETURNING ${columns(this.selection)}`, values);
        } else {
          const updateParams = values.slice(0, keys.length);
          const updateWhere = whereClause(this.filters, updateParams);
          const assignments = keys.map((key, index) => `${identifier(key)} = $${index + 1}`).join(", ");
          result = await pool.query(`UPDATE ${table} SET ${assignments}${updateWhere} RETURNING ${columns(this.selection)}`, updateParams);
        }
      }

      const rows = (result?.rows || []) as T[];
      if (this.one === "single") {
        if (rows.length !== 1) return { data: null, error: { message: `Expected one row from ${this.table}, received ${rows.length}` } };
        return { data: rows[0], error: null };
      }
      if (this.one === "maybeSingle") {
        if (rows.length > 1) return { data: null, error: { message: `Expected zero or one row from ${this.table}` } };
        return { data: rows[0] || null, error: null };
      }
      return { data: rows, error: null };
    } catch (error) {
      return { data: null, error: { message: error instanceof Error ? error.message : String(error) } };
    }
  }
}

export async function query<T extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []) {
  return pool.query<T>(text, values);
}

export async function closeDb() {
  await pool.end();
}
