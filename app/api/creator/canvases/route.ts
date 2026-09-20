import { NextResponse } from 'next/server';
import { ensureCreatorWorkspace } from '@/lib/creator/workspace';
import { CanvasGraphLimitError, normalizeCreatorCanvasGraph } from '@/lib/creator/canvas-graph';
import type { CreatorCanvasGraph } from '@/lib/creator/types';
import { createClient } from '@/lib/local/server';
import { logServerFailure } from '@/lib/observability/server-log';

export const runtime = 'nodejs';

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

export async function GET(req: Request) {
  try {
    const context = await creatorContext();
    if (!context) return errorResponse('\u8bf7\u5148\u767b\u5f55', 'UNAUTHENTICATED', 401);
    const kind = new URL(req.url).searchParams.get('kind');
    let query = context.localClient
      .from('creator_canvases')
      .select('*')
      .eq('workspace_id', context.workspace.id)
      .order('updated_at', { ascending: false });
    if (kind === 'image' || kind === 'video') query = query.eq('kind', kind);
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ canvases: data || [] });
  } catch (error: unknown) {
    return serverError(error, 'CANVAS_FAILED', '\u753b\u5e03\u8bf7\u6c42\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5');
  }
}

export async function POST(req: Request) {
  try {
    const context = await creatorContext();
    if (!context) return errorResponse('\u8bf7\u5148\u767b\u5f55', 'UNAUTHENTICATED', 401);
    const body = asRecord(await req.json().catch(() => ({})));
    const kind = body.kind === 'video' ? 'video' : 'image';
    const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 80) : '新画布';
    let graph: CreatorCanvasGraph;
    try {
      graph = normalizeCreatorCanvasGraph(body.graph);
    } catch (error) {
      if (error instanceof CanvasGraphLimitError) {
        return NextResponse.json({ error: error.message, code: error.code, resource: error.resource, count: error.count, limit: error.limit }, { status: 413 });
      }
      return NextResponse.json({ error: '画布数据无效' }, { status: 400 });
    }
    const { data, error } = await context.localClient
      .from('creator_canvases')
      .insert({ workspace_id: context.workspace.id, kind, title, graph })
      .select('*')
      .single();
    if (error) throw error;
    return NextResponse.json({ canvas: data }, { status: 201 });
  } catch (error: unknown) {
    return serverError(error, 'CANVAS_FAILED', '\u753b\u5e03\u8bf7\u6c42\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5');
  }
}
