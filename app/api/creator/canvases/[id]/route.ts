import { NextResponse } from 'next/server';
import { ensureCreatorWorkspace } from '@/lib/creator/workspace';
import type { CreatorCanvasGraph } from '@/lib/creator/types';
import { createClient } from '@/lib/local/server';
import { logServerFailure } from '@/lib/observability/server-log';

export const runtime = 'nodejs';
const MAX_GRAPH_BYTES = 900_000;

function errorResponse(error: string, code: string, status: number) {
  return NextResponse.json({ error, code }, { status });
}

function serverError(error: unknown, code: string, message: string) {
  logServerFailure('creator_canvas_route', error);
  return errorResponse(message, code, 500);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizeGraph(value: unknown): CreatorCanvasGraph {
  const record = asRecord(value);
  const nodes = Array.isArray(record.nodes) ? record.nodes.slice(0, 500).map(asRecord) : [];
  const edges = Array.isArray(record.edges)
    ? record.edges.map(asRecord).filter((edge) => typeof edge.from === 'string' && typeof edge.to === 'string').slice(0, 1_000).map((edge) => ({ from: edge.from as string, to: edge.to as string }))
    : [];
  const viewportRecord = asRecord(record.viewport);
  const x = typeof viewportRecord.x === 'number' && Number.isFinite(viewportRecord.x) ? Math.max(-10000, Math.min(10000, viewportRecord.x)) : 0;
  const y = typeof viewportRecord.y === 'number' && Number.isFinite(viewportRecord.y) ? Math.max(-10000, Math.min(10000, viewportRecord.y)) : 0;
  const zoomValue = typeof viewportRecord.zoom === 'number' ? viewportRecord.zoom : viewportRecord.k;
  const zoom = typeof zoomValue === 'number' && Number.isFinite(zoomValue) ? Math.max(0.35, Math.min(2.4, zoomValue)) : 1;
  const background: 'grid' | 'dots' | 'blank' = record.background === 'dots' || record.background === 'blank' ? record.background : 'grid';
  const graph = { nodes, edges, viewport: { x, y, zoom, k: zoom }, background };
  if (JSON.stringify(graph).length > MAX_GRAPH_BYTES) throw new Error('canvas graph is too large');
  return graph;
}

async function creatorContext() {
  const localClient = createClient();
  const { data: { user } } = await localClient.auth.getUser();
  if (!user) return null;
  const workspace = await ensureCreatorWorkspace({
    rpc: async () => localClient.rpc('ensure_creator_workspace'),
    load: async (id) => localClient.from('creator_workspaces').select('*').eq('id', id).single(),
  }, user.id);
  return { localClient, user, workspace };
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const context = await creatorContext();
    if (!context) return errorResponse('请先登录', 'UNAUTHENTICATED', 401);
    const { data, error } = await context.localClient
      .from('creator_canvases')
      .select('*')
      .eq('id', params.id)
      .eq('workspace_id', context.workspace.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: '画布不存在' }, { status: 404 });
    return NextResponse.json({ canvas: data });
  } catch (error: unknown) {
    return serverError(error, 'CANVAS_FAILED', '画布读取失败，请稍后重试');
  }
}
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const context = await creatorContext();
    if (!context) return errorResponse('\u8bf7\u5148\u767b\u5f55', 'UNAUTHENTICATED', 401);
    const body = asRecord(await req.json().catch(() => ({})));
    const changes: Record<string, unknown> = {};
    if (typeof body.title === 'string' && body.title.trim()) changes.title = body.title.trim().slice(0, 80);
    if (typeof body.graph !== 'undefined') {
      try { changes.graph = normalizeGraph(body.graph); } catch { return NextResponse.json({ error: '画布数据无效' }, { status: 400 }); }
    }
    if (!Object.keys(changes).length) return NextResponse.json({ error: '没有可更新的字段' }, { status: 400 });
    const { data, error } = await context.localClient
      .from('creator_canvases')
      .update(changes)
      .eq('id', params.id)
      .eq('workspace_id', context.workspace.id)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: '画布不存在' }, { status: 404 });
    return NextResponse.json({ canvas: data });
  } catch (error: unknown) {
    return serverError(error, 'CANVAS_FAILED', '\u753b\u5e03\u8bf7\u6c42\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5');
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const context = await creatorContext();
    if (!context) return errorResponse('\u8bf7\u5148\u767b\u5f55', 'UNAUTHENTICATED', 401);
    const { data, error } = await context.localClient
      .from('creator_canvases')
      .delete()
      .eq('id', params.id)
      .eq('workspace_id', context.workspace.id)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: '画布不存在' }, { status: 404 });
    return NextResponse.json({ ok: true, id: data.id });
  } catch (error: unknown) {
    return serverError(error, 'CANVAS_FAILED', '\u753b\u5e03\u8bf7\u6c42\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5');
  }
}
