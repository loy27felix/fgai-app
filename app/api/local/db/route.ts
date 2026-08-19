import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/local/auth";
import { createClient } from "@/lib/local/server-client";

const allowedTables = new Set(["custom_presets", "chat_sessions", "canvases"]);
const allowedOperations = new Set(["select", "insert", "update", "delete", "upsert"]);
const allowedFilters = new Set(["eq", "neq", "in", "is", "gte", "lte", "lt"]);

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  try {
    const body = await request.json();
    if (!allowedTables.has(body.table)) return NextResponse.json({ error: "不支持的数据表" }, { status: 400 });
    if (!allowedOperations.has(body.operation)) return NextResponse.json({ error: "不支持的数据库操作" }, { status: 400 });
    const client = createClient();
    let operation: any = client.from(body.table);
    const userScopedTables = new Set(["custom_presets", "chat_sessions", "canvases"]);
    const payload = body.payload && !Array.isArray(body.payload) ? { ...body.payload } : body.payload;
    if (userScopedTables.has(body.table) && body.operation !== "delete") {
      if (Array.isArray(payload)) payload.forEach((row) => { row.user_id ||= user.id; });
      else if (payload && typeof payload === "object") payload.user_id ||= user.id;
    }
    if (body.operation === "update") operation = operation.update(payload);
    if (body.operation === "delete") operation = operation.delete();
    if (body.operation === "insert") operation = operation.insert(payload);
    if (body.operation === "upsert") operation = operation.upsert(payload, body.options);
    if (body.operation === "select" || body.selection) operation = operation.select(body.selection || "*", body.options);
    for (const filter of body.filters || []) {
      if (!allowedFilters.has(filter.method)) return NextResponse.json({ error: "不支持的查询条件" }, { status: 400 });
      operation = operation[filter.method](filter.column, filter.value);
    }
    if (userScopedTables.has(body.table)) operation = operation.eq("user_id", user.id);
    for (const order of body.orders || []) operation = operation.order(order.column, order);
    if (body.limit !== null && body.limit !== undefined) operation = operation.limit(body.limit);
    if (body.single === "single") operation = operation.single();
    if (body.single === "maybeSingle") operation = operation.maybeSingle();
    const result = await operation;
    return NextResponse.json(result, { status: result.error ? 400 : 200 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "数据库请求失败" }, { status: 400 });
  }
}
