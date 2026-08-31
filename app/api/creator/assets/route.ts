import { NextResponse } from 'next/server';

import { ensureCreatorWorkspace } from '@/lib/creator/workspace';
import { createClient } from '@/lib/local/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SIGNED_URL_TTL_SECONDS = 3600;

function errorResponse(error: string, code: string, status: number) {
  return NextResponse.json({ error, code }, { status });
}

function serverError(error: unknown) {
  console.error('[creator assets route]', error);
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
    console.info('[creator assets listed]', { scope: materialScope ? 'material-library' : 'assets', count: assets.length });
    return NextResponse.json({ assets });
  } catch (error) {
    return serverError(error);
  }
}
