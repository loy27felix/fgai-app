import { NextResponse } from 'next/server';
import { ensureCreatorWorkspace } from '@/lib/creator/workspace';
import { createClient } from '@/lib/local/server';
import { createAdminClient } from '@/lib/local/admin';
import { randomId } from '@/lib/utils';
import { logServerEvent, logServerFailure, requestTraceId } from '@/lib/observability/server-log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const SIGNED_URL_TTL_SECONDS = 3600;
const MAX_BYTES = 320 * 1024 * 1024;
const KINDS = new Set(['image', 'video', 'audio', 'document']);
const SOURCES = new Set(['upload', 'generation', 'project_copy']);

function response(error: string, code: string, status: number) {
  return NextResponse.json({ error, code }, { status });
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

function safeName(value: string) {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned.slice(0, 100) || 'asset';
}

function extensionFor(mimeType: string, name: string) {
  const fromName = name.match(/\.([a-z0-9]{1,8})$/i)?.[1];
  if (fromName) return fromName.toLowerCase();
  if (mimeType.includes('png')) return 'png';
  if (mimeType.includes('webp')) return 'webp';
  if (mimeType.includes('jpeg')) return 'jpg';
  if (mimeType.includes('quicktime')) return 'mov';
  if (mimeType.includes('webm')) return 'webm';
  if (mimeType.includes('mpeg')) return 'mp3';
  return mimeType.includes('audio') ? 'audio' : mimeType.includes('video') ? 'mp4' : 'bin';
}

export async function GET(req: Request) {
  try {
    const context = await creatorContext();
    if (!context) return response('请先登录', 'UNAUTHENTICATED', 401);
    const path = new URL(req.url).searchParams.get('path') || '';
    if (!path || path.includes('..') || path.split('/')[0] !== context.user.id) return response('素材路径无效', 'INVALID_PATH', 400);
    const signed = await context.localClient.storage.from('creator-assets').createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (signed.error || !signed.data?.signedUrl) return response('素材不存在或已删除', 'ASSET_NOT_FOUND', 404);
    return NextResponse.json({ signedUrl: signed.data.signedUrl, path });
  } catch (error) {
    logServerFailure('creator_canvas_asset_url', error, { feature: 'creator_canvas_asset', stage: 'signed_url' });
    return response('素材地址读取失败', 'ASSET_URL_FAILED', 500);
  }
}

export async function POST(req: Request) {
  const traceId = requestTraceId(req);
  try {
    const context = await creatorContext();
    if (!context) return response('请先登录', 'UNAUTHENTICATED', 401);
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return response('素材文件无效', 'INVALID_FILE', 400);
    if (file.size <= 0 || file.size > MAX_BYTES) return response('素材大小超出限制', 'FILE_TOO_LARGE', 413);

    const kindValue = String(form.get('kind') || '').toLowerCase();
    const sourceValue = String(form.get('source') || 'project_copy').toLowerCase();
    const kind = KINDS.has(kindValue) ? kindValue : file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : 'document';
    const source = SOURCES.has(sourceValue) ? sourceValue : 'project_copy';
    const nodeId = String(form.get('nodeId') || '').slice(0, 128);
    const libraryScope = String(form.get('libraryScope') || '') === 'material-library';
    const folderId = String(form.get('folderId') || '').trim().replace(/[^a-z0-9_-]+/gi, '-').slice(0, 48);
    const name = safeName(String(form.get('name') || file.name || 'asset'));
    const extension = extensionFor(file.type, name);
    const storagePath = context.user.id + '/canvas-assets/' + randomId() + '-' + name.replace(/\.[a-z0-9]{1,8}$/i, '') + '.' + extension;
    const body = new Uint8Array(await file.arrayBuffer());
    let upload = await context.localClient.storage.from('creator-assets').upload(storagePath, body, { upsert: false, contentType: file.type || 'application/octet-stream' });
    if (upload.error) {
      try {
        upload = await createAdminClient().storage.from('creator-assets').upload(storagePath, body, { upsert: false, contentType: file.type || 'application/octet-stream' });
      } catch (error) {
        logServerFailure('creator_canvas_asset_admin_upload', error, { traceId, feature: 'creator_canvas_asset', stage: 'admin_upload' });
      }
    }
    if (upload.error) {
      logServerEvent('creator_canvas_asset', { traceId, feature: 'creator_canvas_asset', stage: 'storage_upload_failed', kind, bytes: file.size, nodeId: nodeId || null }, 'warn');
      return response('素材上传失败，请稍后重试', 'ASSET_UPLOAD_FAILED', 502);
    }

    const inserted = await context.localClient
      .from('creator_assets')
      .insert({
        workspace_id: context.workspace.id,
        session_id: null,
        kind,
        source,
        name,
        storage_path: storagePath,
        mime_type: file.type || 'application/octet-stream',
        metadata: {
          canvas_node_id: nodeId || null,
          original_name: file.name,
          bytes: file.size,
          ...(libraryScope ? { library_scope: 'material-library', library_folder_id: folderId || null } : {}),
        },
      })
      .select('id, storage_path')
      .single();
    if (inserted.error || !inserted.data) {
      await context.localClient.storage.from('creator-assets').remove([storagePath]);
      logServerEvent('creator_canvas_asset', { traceId, feature: 'creator_canvas_asset', stage: 'asset_record_failed', kind, bytes: file.size, nodeId: nodeId || null }, 'warn');
      return response('素材记录保存失败，请稍后重试', 'ASSET_RECORD_FAILED', 500);
    }
    const signed = await context.localClient.storage.from('creator-assets').createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
    logServerEvent('creator_canvas_asset', { traceId, feature: 'creator_canvas_asset', stage: 'completed', kind, source, bytes: file.size, nodeId: nodeId || null, libraryScope: libraryScope ? 'material-library' : 'asset', folderId: folderId || null, assetId: inserted.data.id, storagePath: inserted.data.storage_path });
    return NextResponse.json({
      assetId: inserted.data.id,
      storagePath: inserted.data.storage_path,
      signedUrl: signed.error ? null : signed.data?.signedUrl || null,
    }, { status: 201 });
  } catch (error) {
    logServerFailure('creator_canvas_asset_failed', error, { traceId, feature: 'creator_canvas_asset', stage: 'exception' });
    return response('素材上传失败，请稍后重试', 'ASSET_UPLOAD_FAILED', 500);
  }
}
