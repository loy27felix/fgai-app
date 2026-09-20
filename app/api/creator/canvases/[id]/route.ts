import { NextResponse } from 'next/server';
import { ensureCreatorWorkspace } from '@/lib/creator/workspace';
import { CanvasGraphLimitError, normalizeCreatorCanvasGraph } from '@/lib/creator/canvas-graph';
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
    const expectedVersion = typeof body.expectedVersion === 'number' && Number.isInteger(body.expectedVersion) && body.expectedVersion >= 0
      ? body.expectedVersion
      : null;
    if (expectedVersion === null) return errorResponse('画布版本缺失，请刷新后重试', 'CANVAS_VERSION_REQUIRED', 409);
    const changes: Record<string, unknown> = {};
    if (typeof body.title === 'string' && body.title.trim()) changes.title = body.title.trim().slice(0, 80);
    if (typeof body.graph !== 'undefined') {
      try {
        changes.graph = normalizeCreatorCanvasGraph(body.graph);
      } catch (error) {
        if (error instanceof CanvasGraphLimitError) {
          return NextResponse.json({ error: error.message, code: error.code, resource: error.resource, count: error.count, limit: error.limit }, { status: 413 });
        }
        return NextResponse.json({ error: '画布数据无效' }, { status: 400 });
      }
    }
    if (!Object.keys(changes).length) return NextResponse.json({ error: '没有可更新的字段' }, { status: 400 });
    changes.version = expectedVersion + 1;
    const { data, error } = await context.localClient
      .from('creator_canvases')
      .update(changes)
      .eq('id', params.id)
      .eq('workspace_id', context.workspace.id)
      .eq('version', expectedVersion)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      const { data: current, error: currentError } = await context.localClient
        .from('creator_canvases')
        .select('*')
        .eq('id', params.id)
        .eq('workspace_id', context.workspace.id)
        .maybeSingle();
      if (currentError) throw currentError;
      if (!current) return NextResponse.json({ error: '画布不存在' }, { status: 404 });
      return NextResponse.json({ error: '画布已在其他位置更新，正在合并最新内容', code: 'CANVAS_VERSION_CONFLICT', canvas: current }, { status: 409 });
    }
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
