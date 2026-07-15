import { NextResponse } from 'next/server';
import {
  confirmImageReferenceUploads,
  deleteOwnedImageTask,
  ImageStorageError,
  type CreatorImageDeletionStore,
  type CreatorImagePatchStore,
} from '@/lib/creator/imageStorage';
import type { CreatorImageTask } from '@/lib/creator/types';
import { ensureCreatorWorkspace } from '@/lib/creator/workspace';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

type RouteContext = { params: { id: string } };

type ImageItemHandlerDeps = {
  createClient: () => unknown;
  ensureCreatorWorkspace: (
    store: Parameters<typeof ensureCreatorWorkspace>[0],
    userId: string,
  ) => Promise<{ id: string }>;
  confirmImageReferenceUploads: typeof confirmImageReferenceUploads;
  deleteOwnedImageTask: typeof deleteOwnedImageTask;
};

function response(error: string, code: string, status: number) {
  return NextResponse.json({ error, code }, { status });
}

function serverError(
  error: unknown,
  fallbackCode: string,
  fallbackMessage: string,
  storageStatus: number,
) {
  console.error('[creator image item]', error);
  if (error instanceof ImageStorageError) {
    return NextResponse.json(
      { error: error.publicMessage, code: error.code },
      { status: storageStatus },
    );
  }
  return response(fallbackMessage, fallbackCode, 500);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function createImageItemHandlers(deps: ImageItemHandlerDeps) {
  async function creatorContext() {
    const supabase = deps.createClient() as ReturnType<typeof createClient>;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const workspace = await deps.ensureCreatorWorkspace({
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

  async function patch(req: Request, { params }: RouteContext) {
    try {
      const context = await creatorContext();
      if (!context) return response('\u8bf7\u5148\u767b\u5f55', 'UNAUTHENTICATED', 401);

      const owned = await findOwnedTask(context, params.id);
      if (owned.error) throw owned.error;
      if (!owned.data) return response('\u56fe\u7247\u4efb\u52a1\u4e0d\u5b58\u5728', 'IMAGE_TASK_NOT_FOUND', 404);
      const task = owned.data as CreatorImageTask;

      let body: Record<string, unknown>;
      try {
        const value: unknown = await req.json();
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid body');
        body = value as Record<string, unknown>;
      } catch {
        return response('\u8bf7\u6c42\u4f53\u683c\u5f0f\u9519\u8bef', 'INVALID_REQUEST_BODY', 400);
      }
      if (
        Object.keys(body).length !== 1
        || !Object.prototype.hasOwnProperty.call(body, 'referencePaths')
      ) {
        return response('\u53ea\u80fd\u66f4\u65b0\u53c2\u8003\u56fe\u8def\u5f84', 'INVALID_PATCH_FIELDS', 400);
      }

      const store: CreatorImagePatchStore = {
        updateTask: async (id, workspaceId, userId, request) => {
          const updated = await context.supabase
            .from('creator_generation_tasks')
            .update({ request })
            .eq('id', id)
            .eq('workspace_id', workspaceId)
            .eq('user_id', userId)
            .eq('kind', 'image')
            .select('*')
            .maybeSingle();
          return { data: updated.data, error: updated.error };
        },
      };
      const updated = await deps.confirmImageReferenceUploads(
        context.supabase.storage.from('creator-assets'),
        store,
        {
          id: task.id,
          userId: context.user.id,
          workspaceId: context.workspace.id,
          model: task.model,
          request: task.request,
        },
        body.referencePaths,
      );
      return NextResponse.json({ task: updated });
    } catch (error: unknown) {
      return serverError(
        error,
        'UPLOAD_CONFIRM_FAILED',
        '\u53c2\u8003\u56fe\u786e\u8ba4\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5',
        409,
      );
    }
  }

  async function remove(_req: Request, { params }: RouteContext) {
    try {
      const context = await creatorContext();
      if (!context) return response('\u8bf7\u5148\u767b\u5f55', 'UNAUTHENTICATED', 401);

      const owned = await findOwnedTask(context, params.id);
      if (owned.error) throw owned.error;
      if (!owned.data) return response('\u56fe\u7247\u4efb\u52a1\u4e0d\u5b58\u5728', 'IMAGE_TASK_NOT_FOUND', 404);
      const task = owned.data as CreatorImageTask;
      const output = asRecord(task.output);
      const assetId = typeof output.asset_id === 'string' && output.asset_id
        ? output.asset_id
        : null;

      const store: CreatorImageDeletionStore = {
        loadAsset: async (id, workspaceId) => {
          const found = await context.supabase
            .from('creator_assets')
            .select('id,storage_path')
            .eq('id', id)
            .eq('workspace_id', workspaceId)
            .eq('kind', 'image')
            .eq('source', 'generation')
            .maybeSingle();
          return {
            data: found.data ? { id: found.data.id, storagePath: found.data.storage_path } : null,
            error: found.error,
          };
        },
        deleteAsset: async (id, workspaceId) => {
          const deleted = await context.supabase
            .from('creator_assets')
            .delete()
            .eq('id', id)
            .eq('workspace_id', workspaceId)
            .eq('kind', 'image')
            .eq('source', 'generation')
            .select('id')
            .maybeSingle();
          return { deleted: !!deleted.data, error: deleted.error };
        },
        deleteTask: async (id, workspaceId, userId) => {
          const deleted = await context.supabase
            .from('creator_generation_tasks')
            .delete()
            .eq('id', id)
            .eq('workspace_id', workspaceId)
            .eq('user_id', userId)
            .eq('kind', 'image')
            .select('id')
            .maybeSingle();
          return { deleted: !!deleted.data, error: deleted.error };
        },
      };

      const deleted = await deps.deleteOwnedImageTask(
        context.supabase.storage.from('creator-assets'),
        store,
        {
          id: task.id,
          userId: context.user.id,
          workspaceId: context.workspace.id,
          assetId,
        },
      );
      return NextResponse.json({ ok: true, id: deleted.id });
    } catch (error: unknown) {
      return serverError(
        error,
        'IMAGE_TASK_DELETE_FAILED',
        '\u56fe\u7247\u4efb\u52a1\u5220\u9664\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5',
        500,
      );
    }
  }

  return { PATCH: patch, DELETE: remove };
}

const defaultImageItemHandlers = createImageItemHandlers({
  createClient,
  ensureCreatorWorkspace,
  confirmImageReferenceUploads,
  deleteOwnedImageTask,
});

export async function PATCH(req: Request, context: RouteContext) {
  return defaultImageItemHandlers.PATCH(req, context);
}

export async function DELETE(req: Request, context: RouteContext) {
  return defaultImageItemHandlers.DELETE(req, context);
}
