import { NextResponse } from 'next/server';

import { ensureCreatorWorkspace } from '@/lib/creator/workspace';
import { createClient } from '@/lib/local/server';
import { logServerEvent, logServerFailure } from '@/lib/observability/server-log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SIGNED_URL_TTL_SECONDS = 3600;

function errorResponse(error: string, code: string, status: number) {
  return NextResponse.json({ error, code }, { status });
}

function serverError(error: unknown) {
  logServerFailure('creator_assets_route', error);
  return errorResponse('资产加载失败，请稍后重试', 'ASSETS_FAILED', 500);
}

async function creatorContext() {
  const localClient = createClient();
  const { data: { user } } = await localClient.auth.getUser();
  if (!user) return null;
  const workspace = await ensureCreatorWorkspace({
    rpc: async () => localClient.rpc('ensure_creator_workspace'),
    load: async (id) => localClient.from('creator_workspaces').select('*').eq('id', id).single(),
  }, user.id);
  return { localClient, workspace };
}

export async function GET(request: Request) {
  try {
    const context = await creatorContext();
    if (!context) return errorResponse('请先登录', 'UNAUTHENTICATED', 401);
    const result = await context.localClient
      .from('creator_assets')
      .select('*')
      .eq('workspace_id', context.workspace.id)
      .in('kind', ['image', 'video', 'audio', 'document'])
      .order('created_at', { ascending: false })
      .limit(500);
    if (result.error) throw result.error;
    const bucket = context.localClient.storage.from('creator-assets');
    const materialScope = new URL(request.url).searchParams.get('scope') === 'material-library';
    const scopedRows = (result.data || []).filter((asset: any) => {
      const metadata = asset.metadata && typeof asset.metadata === 'object' && !Array.isArray(asset.metadata) ? asset.metadata as Record<string, unknown> : {};
      // library_folder was used by the short-lived merged implementation.
      // Treat it as material-library data during migration so it cannot leak
      // back into the original asset page.
      const isMaterial = metadata.library_scope === 'material-library' || typeof metadata.library_folder === 'string';
      return materialScope ? isMaterial : !isMaterial;
    });
    const assets = await Promise.all(scopedRows.map(async (asset: any) => {
      const signed = await bucket.createSignedUrl(asset.storage_path, SIGNED_URL_TTL_SECONDS);
      return {
        id: asset.id,
        kind: asset.kind,
        name: asset.name,
        storagePath: asset.storage_path,
        mimeType: asset.mime_type,
        width: asset.width,
        height: asset.height,
        durationMs: asset.duration_ms,
        metadata: asset.metadata || {},
        createdAt: asset.created_at,
        updatedAt: asset.updated_at,
        signedUrl: signed.error ? null : signed.data?.signedUrl || null,
      };
    }));
    logServerEvent('creator_assets_listed', { scope: materialScope ? 'material-library' : 'assets', count: assets.length });
    return NextResponse.json({ assets });
  } catch (error) {
    return serverError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const context = await creatorContext();
    if (!context) return errorResponse('请先登录', 'UNAUTHENTICATED', 401);
    const body = await request.json().catch(() => ({}));
    if (body.action === 'renameFolder') {
      const folderId = typeof body.folderId === 'string'
        ? body.folderId.trim().replace(/[^a-z0-9_-]+/gi, '-').slice(0, 48)
        : '';
      const folderName = typeof body.folderName === 'string' ? body.folderName.trim().replace(/\s+/g, ' ').slice(0, 48) : '';
      if (!folderId || folderId === 'uncategorized') return errorResponse('文件夹标识无效', 'INVALID_FOLDER_ID', 400);
      if (!folderName) return errorResponse('文件夹名称不能为空', 'INVALID_FOLDER_NAME', 400);

      const found = await context.localClient
        .from('creator_assets')
        .select('id, metadata')
        .eq('workspace_id', context.workspace.id)
        .limit(500);
      if (found.error) throw found.error;
      const targets = (found.data || []).filter((asset: any) => {
        const metadata = asset.metadata && typeof asset.metadata === 'object' && !Array.isArray(asset.metadata) ? asset.metadata as Record<string, unknown> : {};
        const storedFolderId = typeof metadata.library_folder_id === 'string' ? metadata.library_folder_id : metadata.library_folder;
        return (metadata.library_scope === 'material-library' || typeof metadata.library_folder === 'string') && storedFolderId === folderId;
      });
      const updates = await Promise.all(targets.map(async (asset: any) => {
        const metadata = asset.metadata && typeof asset.metadata === 'object' && !Array.isArray(asset.metadata) ? asset.metadata as Record<string, unknown> : {};
        const updated = await context.localClient
          .from('creator_assets')
          .update({ metadata: { ...metadata, library_scope: 'material-library', library_folder_id: folderId, library_folder_name: folderName } })
          .eq('id', asset.id)
          .eq('workspace_id', context.workspace.id);
        return updated.error;
      }));
      const failed = updates.find(Boolean);
      if (failed) throw failed;
      logServerEvent('material_library_folder_renamed', { folderId, updated: targets.length });
      return NextResponse.json({ renamed: true, updated: targets.length, folderId, folderName });
    }
    const assetId = typeof body.assetId === 'string' ? body.assetId.trim() : '';
    if (!assetId) return errorResponse('素材标识无效', 'INVALID_ASSET_ID', 400);
    if (body.folderId !== null && typeof body.folderId !== 'undefined' && typeof body.folderId !== 'string') {
      return errorResponse('文件夹标识无效', 'INVALID_FOLDER_ID', 400);
    }
    const folderId = typeof body.folderId === 'string'
      ? body.folderId.trim().replace(/[^a-z0-9_-]+/gi, '-').slice(0, 48) || null
      : null;
    const folderName = typeof body.folderName === 'string' ? body.folderName.trim().replace(/\s+/g, ' ').slice(0, 48) : '';

    const found = await context.localClient
      .from('creator_assets')
      .select('id, metadata')
      .eq('id', assetId)
      .eq('workspace_id', context.workspace.id)
      .maybeSingle();
    if (found.error) throw found.error;
    if (!found.data) return errorResponse('素材不存在或已删除', 'ASSET_NOT_FOUND', 404);
    const metadata = found.data.metadata && typeof found.data.metadata === 'object' && !Array.isArray(found.data.metadata) ? found.data.metadata as Record<string, unknown> : {};
    const isMaterial = metadata.library_scope === 'material-library' || typeof metadata.library_folder === 'string';
    if (!isMaterial) return errorResponse('只能移动素材库中的素材', 'ASSET_SCOPE_FORBIDDEN', 403);

    const updated = await context.localClient
      .from('creator_assets')
      .update({ metadata: { ...metadata, library_scope: 'material-library', library_folder_id: folderId, ...(folderId && folderName ? { library_folder_name: folderName } : {}) } })
      .eq('id', found.data.id)
      .eq('workspace_id', context.workspace.id);
    if (updated.error) throw updated.error;

    logServerEvent('material_library_folder_updated', { assetId, folderId });
    return NextResponse.json({ updated: true, folderId });
  } catch (error) {
    logServerFailure('material_library_folder_update', error);
    return errorResponse('移动素材失败，请稍后重试', 'MATERIAL_MOVE_FAILED', 500);
  }
}

export async function DELETE(request: Request) {
  try {
    const context = await creatorContext();
    if (!context) return errorResponse('请先登录', 'UNAUTHENTICATED', 401);
    const body = await request.json().catch(() => ({}));
    const assetId = typeof body.assetId === 'string' ? body.assetId.trim() : '';
    if (!assetId) return errorResponse('素材标识无效', 'INVALID_ASSET_ID', 400);

    const found = await context.localClient
      .from('creator_assets')
      .select('id, storage_path, metadata')
      .eq('id', assetId)
      .eq('workspace_id', context.workspace.id)
      .maybeSingle();
    if (found.error) throw found.error;
    if (!found.data) return errorResponse('素材不存在或已删除', 'ASSET_NOT_FOUND', 404);
    const metadata = found.data.metadata && typeof found.data.metadata === 'object' && !Array.isArray(found.data.metadata) ? found.data.metadata as Record<string, unknown> : {};
    const isMaterial = metadata.library_scope === 'material-library' || typeof metadata.library_folder === 'string';
    if (!isMaterial) return errorResponse('只能删除素材库中的素材', 'ASSET_SCOPE_FORBIDDEN', 403);

    const deleted = await context.localClient
      .from('creator_assets')
      .delete()
      .eq('id', found.data.id)
      .eq('workspace_id', context.workspace.id);
    if (deleted.error) throw deleted.error;

    const removed = await context.localClient.storage.from('creator-assets').remove([found.data.storage_path]);
    if (removed.error) {
      logServerEvent('material_library_storage_cleanup_failed', { assetId, code: removed.error.message }, 'warn');
    }
    logServerEvent('material_library_asset_deleted', { assetId, storageCleanup: !removed.error });
    return NextResponse.json({ deleted: true, storageCleanup: !removed.error });
  } catch (error) {
    logServerFailure('material_library_delete', error);
    return errorResponse('删除素材失败，请稍后重试', 'MATERIAL_DELETE_FAILED', 500);
  }
}
