"use client";

import type { LocalResult, LocalUser } from "@/lib/local/types";

type Filter = { method: "eq" | "neq" | "in" | "is" | "gte" | "lte" | "lt"; column: string; value: unknown };
type Order = { column?: string; ascending?: boolean };

export function localMediaUrl(bucket: string, path: string) {
  return `/api/local/storage/content?bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(path)}`;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "include", ...init });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "本地服务请求失败");
  return body;
}

class RemoteQuery<T = any> implements PromiseLike<LocalResult<T[] | T | null>> {
  private operation: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private selection = "*";
  private payload: unknown = null;
  private filters: Filter[] = [];
  private orders: Order[] = [];
  private maxRows: number | null = null;
  private one: "single" | "maybeSingle" | null = null;
  private options: Record<string, unknown> | undefined;

  constructor(private readonly table: string) {}
  select(selection = "*", options?: Record<string, unknown>) { this.selection = selection; this.options = options; return this; }
  insert(values: unknown) { this.operation = "insert"; this.payload = values; return this; }
  update(values: unknown) { this.operation = "update"; this.payload = values; return this; }
  delete() { this.operation = "delete"; return this; }
  upsert(values: unknown, options?: { onConflict?: string; ignoreDuplicates?: boolean }) { this.operation = "upsert"; this.payload = values; this.options = options; return this; }
  eq(column: string, value: unknown) { this.filters.push({ method: "eq", column, value }); return this; }
  neq(column: string, value: unknown) { this.filters.push({ method: "neq", column, value }); return this; }
  gte(column: string, value: unknown) { this.filters.push({ method: "gte", column, value }); return this; }
  lte(column: string, value: unknown) { this.filters.push({ method: "lte", column, value }); return this; }
  lt(column: string, value: unknown) { this.filters.push({ method: "lt", column, value }); return this; }
  in(column: string, value: unknown[]) { this.filters.push({ method: "in", column, value }); return this; }
  is(column: string, value: null) { this.filters.push({ method: "is", column, value }); return this; }
  order(column: string, options?: Order) { this.orders.push({ column, ...options }); return this; }
  limit(value: number) { this.maxRows = value; return this; }
  single() { this.one = "single"; return this; }
  maybeSingle() { this.one = "maybeSingle"; return this; }
  then<TResult1 = LocalResult<T[] | T | null>, TResult2 = never>(onfulfilled?: ((value: LocalResult<T[] | T | null>) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null) {
    return request<LocalResult<T[] | T | null>>("/api/local/db", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ table: this.table, operation: this.operation, selection: this.selection, payload: this.payload, filters: this.filters, orders: this.orders, limit: this.maxRows, single: this.one, options: this.options }),
    }).then(onfulfilled, onrejected);
  }
}

class RemoteBucket {
  constructor(private readonly bucket: string) {}
  async upload(name: string, file: Blob, options?: { upsert?: boolean; contentType?: string }) {
    const form = new FormData();
    form.set("bucket", this.bucket);
    form.set("path", name);
    form.set("upsert", String(Boolean(options?.upsert)));
    form.set("file", file);
    return request<{ data: { path: string } | null; error: { message: string } | null }>("/api/local/storage", { method: "POST", body: form });
  }
  async remove(paths: string[]) {
    return request<{ data: unknown; error: { message: string } | null }>("/api/local/storage", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bucket: this.bucket, paths }) });
  }
  getPublicUrl(path: string) { return { data: { publicUrl: localMediaUrl(this.bucket, path) } }; }
  async createSignedUrl(path: string, expiresIn: number) { return { data: { signedUrl: `${this.getPublicUrl(path).data.publicUrl}&expires=${Math.floor(Date.now() / 1000) + expiresIn}` }, error: null }; }
}

export function createClient() {
  return {
    auth: {
      getSession: async () => request<{ data: { session: { user: LocalUser } | null }; error: null }>("/api/auth/session"),
      getUser: async () => { const session = await request<{ data: { session: { user: LocalUser } | null }; error: null }>("/api/auth/session"); return { data: { user: session.data.session?.user || null }, error: null }; },
      signUp: (credentials: { email: string; password: string }) => request<{ data: { user: LocalUser | null }; error: { message: string } | null }>("/api/auth/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(credentials) }),
      signInWithPassword: (credentials: { email: string; password: string }) => request<{ data: { user: LocalUser | null }; error: { message: string } | null }>("/api/auth/signin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(credentials) }),
      signOut: () => request<{ error: null }>("/api/auth/signout", { method: "POST" }),
    },
    from: (table: string) => new RemoteQuery<any>(table),
    storage: { from: (bucket: string) => new RemoteBucket(bucket) },
  };
}
