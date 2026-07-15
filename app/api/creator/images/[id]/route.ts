import { NextResponse } from 'next/server';
import {
  assertOwnedReferencePath,
  assertOwnedResultPath,
  referencePathFor,
  validateCompletedReferencePaths,
  type ImageReferenceManifest,
} from '@/lib/creator/image';
import type { CreatorImageAsset, CreatorImageTask } from '@/lib/creator/types';
import { ensureCreatorWorkspace } from '@/lib/creator/workspace';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

type RouteContext = { params: { id: string } };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function storedManifest(value: unknown): ImageReferenceManifest[] {
  if (!Array.isArray(value)) throw new Error('Stored reference manifest is invalid');
  return value.map((entry) => {
    const reference = asRecord(entry);
    if (
      typeof reference.name !== 'string'
      || typeof reference.mimeType !== 'string'
      || typeof reference.size !== 'number'
    ) {
      throw new Error('Stored reference manifest is invalid');
    }
    return {
      name: reference.name,
      mimeType: reference.mimeType,
      size: reference.size,
    };
  });
}

async function creatorContext() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const workspace = await ensureCreatorWorkspace({
    rpc: async () => supabase.rpc('ensure_creator_workspace'),
    load: async (id) => supabase.from('creator_workspaces').select('*').eq('id', id).single(),
  }, user.id);
  return { supabase, user, workspace };
}

async function findOwnedTask(
  context: NonNullable<Awaited<ReturnType<typeof creatorContext>>>,
  id: string,
) {
  return context.supabase
    .from('creator_generation_tasks')
    .select('*')
    .eq('id', id)
    .eq('workspace_id', context.workspace.id)
    .eq('user_id', context.user.id)
    .eq('kind', 'image')
    .maybeSingle();
}

export async function PATCH(req: Request, { params }: RouteContext) {
  try {
    const context = await creatorContext();
    if (!context) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const owned = await findOwnedTask(context, params.id);
    if (owned.error) throw owned.error;
    if (!owned.data) return NextResponse.json({ error: 'Image task not found' }, { status: 404 });
    const task = owned.data as CreatorImageTask;

    let body: Record<string, unknown>;
    try {
      const value: unknown = await req.json();
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid body');
      body = value as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    if (Object.keys(body).some((key) => key !== 'referencePaths')) {
      return NextResponse.json({ error: 'Only referencePaths can be updated' }, { status: 400 });
    }

    const request = asRecord(task.request);
    const manifest = storedManifest(request.reference_manifest);
    let paths: string[];
    try {
      paths = validateCompletedReferencePaths(
        body.referencePaths,
        manifest,
        context.user.id,
        task.id,
      );
      paths.forEach((path, index) => {
        assertOwnedReferencePath(path, context.user.id, task.id);
        if (path !== referencePathFor(context.user.id, task.id, index, manifest[index].mimeType)) {
          throw new Error('Reference upload path does not match server plan');
        }
      });
    } catch (error: unknown) {
      return NextResponse.json({
        error: error instanceof Error ? error.message : 'Invalid reference paths',
      }, { status: 400 });
    }

    const bucket = context.supabase.storage.from('creator-assets');
    for (const path of paths) {
      const slash = path.lastIndexOf('/');
      const directory = path.slice(0, slash);
      const fileName = path.slice(slash + 1);
      const listed = await bucket.list(directory, { search: fileName, limit: 100 });
      if (listed.error) {
        return NextResponse.json({
          error: `Failed to verify reference upload: ${listed.error.message}`,
        }, { status: 500 });
      }
      if (!(listed.data || []).some((object) => object.name === fileName)) {
        return NextResponse.json({ error: `Reference upload is missing: ${fileName}` }, { status: 400 });
      }
    }

    const updated = await context.supabase
      .from('creator_generation_tasks')
      .update({
        request: {
          ...request,
          reference_paths: paths,
          uploads_complete: true,
        },
      })
      .eq('id', task.id)
      .eq('workspace_id', context.workspace.id)
      .eq('user_id', context.user.id)
      .eq('kind', 'image')
      .select('*')
      .maybeSingle();
    if (updated.error) throw updated.error;
    if (!updated.data) return NextResponse.json({ error: 'Image task not found' }, { status: 404 });
    return NextResponse.json({ task: updated.data });
  } catch (error: unknown) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to complete reference uploads',
    }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: RouteContext) {
  try {
    const context = await creatorContext();
    if (!context) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const owned = await findOwnedTask(context, params.id);
    if (owned.error) throw owned.error;
    if (!owned.data) return NextResponse.json({ error: 'Image task not found' }, { status: 404 });
    const task = owned.data as CreatorImageTask;
    const output = asRecord(task.output);
    const assetId = typeof output.asset_id === 'string' ? output.asset_id : null;

    let asset: CreatorImageAsset | null = null;
    if (assetId) {
      const found = await context.supabase
        .from('creator_assets')
        .select('*')
        .eq('id', assetId)
        .eq('workspace_id', context.workspace.id)
        .eq('kind', 'image')
        .eq('source', 'generation')
        .maybeSingle();
      if (found.error) {
        return NextResponse.json({
          error: `Failed to load result asset: ${found.error.message}`,
        }, { status: 500 });
      }
      asset = found.data as CreatorImageAsset | null;
    }

    const bucket = context.supabase.storage.from('creator-assets');
    const referencePrefix = `${context.user.id}/image-tasks/${task.id}/references`;
    const listed = await bucket.list(referencePrefix, { limit: 100 });
    if (listed.error) {
      return NextResponse.json({
        error: `Failed to list task references: ${listed.error.message}`,
      }, { status: 500 });
    }
    const referencePaths: string[] = [];
    try {
      for (const object of listed.data || []) {
        const path = `${referencePrefix}/${object.name}`;
        assertOwnedReferencePath(path, context.user.id, task.id);
        referencePaths.push(path);
      }
      if (asset) assertOwnedResultPath(asset.storage_path, context.user.id, task.id);
    } catch (error: unknown) {
      return NextResponse.json({
        error: error instanceof Error ? error.message : 'Task storage ownership check failed',
      }, { status: 500 });
    }

    const storagePaths = asset
      ? [...referencePaths, asset.storage_path]
      : referencePaths;
    if (storagePaths.length) {
      const removed = await bucket.remove(storagePaths);
      if (removed.error) {
        return NextResponse.json({
          error: `Failed to delete task storage: ${removed.error.message}`,
        }, { status: 500 });
      }
    }

    if (asset) {
      const deletedAsset = await context.supabase
        .from('creator_assets')
        .delete()
        .eq('id', asset.id)
        .eq('workspace_id', context.workspace.id)
        .eq('kind', 'image')
        .eq('source', 'generation');
      if (deletedAsset.error) {
        return NextResponse.json({
          error: `Task storage was deleted, but the result asset row could not be deleted: ${deletedAsset.error.message}`,
        }, { status: 500 });
      }
    }

    const deletedTask = await context.supabase
      .from('creator_generation_tasks')
      .delete()
      .eq('id', task.id)
      .eq('workspace_id', context.workspace.id)
      .eq('user_id', context.user.id)
      .eq('kind', 'image')
      .select('id')
      .maybeSingle();
    if (deletedTask.error) {
      return NextResponse.json({
        error: `Task storage and asset were deleted, but the task row could not be deleted: ${deletedTask.error.message}`,
      }, { status: 500 });
    }
    if (!deletedTask.data) return NextResponse.json({ error: 'Image task not found' }, { status: 404 });

    return NextResponse.json({ ok: true, id: deletedTask.data.id });
  } catch (error: unknown) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to delete image task',
    }, { status: 500 });
  }
}
