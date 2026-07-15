import { NextResponse } from 'next/server';
import {
  assertOwnedResultPath,
  normalizeImageIdempotencyKey,
  referencePathFor,
  scopedImageIdempotencyKey,
  validateCompletedReferencePaths,
  validateImageDraftInput,
  type CreatorImageSkill,
  type ImageReferenceManifest,
} from '@/lib/creator/image';
import type { CreatorImageAsset, CreatorImageTask } from '@/lib/creator/types';
import { ensureCreatorWorkspace } from '@/lib/creator/workspace';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const SIGNED_URL_TTL_SECONDS = 300;

type CreateDraftBody = {
  prompt?: unknown;
  model?: unknown;
  ratio?: unknown;
  idempotencyKey?: unknown;
  references?: unknown;
  skill?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeSkill(value: unknown): CreatorImageSkill | null {
  const skill = asRecord(value);
  return typeof skill.name === 'string' && typeof skill.content === 'string'
    ? { name: skill.name, content: skill.content }
    : null;
}

function normalizeReferences(value: unknown): ImageReferenceManifest[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('references must be an array');
  return value.map((entry) => {
    const reference = asRecord(entry);
    if (
      typeof reference.name !== 'string'
      || typeof reference.mimeType !== 'string'
      || typeof reference.size !== 'number'
    ) {
      throw new Error('invalid reference manifest');
    }
    return {
      name: reference.name,
      mimeType: reference.mimeType,
      size: reference.size,
    };
  });
}

function taskReferences(task: CreatorImageTask) {
  try {
    const request = asRecord(task.request);
    const manifest = normalizeReferences(request.reference_manifest);
    return validateCompletedReferencePaths(request.reference_paths, manifest, task.user_id, task.id);
  } catch {
    return [];
  }
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

export async function GET() {
  try {
    const context = await creatorContext();
    if (!context) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { data, error } = await context.supabase
      .from('creator_generation_tasks')
      .select('*')
      .eq('workspace_id', context.workspace.id)
      .eq('user_id', context.user.id)
      .eq('kind', 'image')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    const tasks = (data || []) as CreatorImageTask[];

    const assetIds = Array.from(new Set(tasks.flatMap((task) => {
      const assetId = asRecord(task.output).asset_id;
      return typeof assetId === 'string' ? [assetId] : [];
    })));
    let assets: CreatorImageAsset[] = [];
    if (assetIds.length) {
      const result = await context.supabase
        .from('creator_assets')
        .select('*')
        .eq('workspace_id', context.workspace.id)
        .eq('kind', 'image')
        .eq('source', 'generation')
        .in('id', assetIds);
      if (result.error) throw result.error;
      assets = (result.data || []) as CreatorImageAsset[];
    }
    const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
    const bucket = context.supabase.storage.from('creator-assets');

    const views = await Promise.all(tasks.map(async (task) => {
      const assetId = asRecord(task.output).asset_id;
      const asset = typeof assetId === 'string' ? assetsById.get(assetId) || null : null;
      let resultUrl: string | null = null;
      if (asset) {
        try {
          assertOwnedResultPath(asset.storage_path, context.user.id, task.id);
          const signed = await bucket.createSignedUrl(asset.storage_path, SIGNED_URL_TTL_SECONDS);
          if (!signed.error) resultUrl = signed.data.signedUrl;
        } catch {
          resultUrl = null;
        }
      }

      const referenceUrls = (await Promise.all(taskReferences(task).map(async (path) => {
        const signed = await bucket.createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
        return signed.error ? null : signed.data.signedUrl;
      }))).filter((url): url is string => typeof url === 'string');

      return { ...task, asset, resultUrl, referenceUrls };
    }));

    return NextResponse.json({ workspace: context.workspace, tasks: views });
  } catch (error: unknown) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to load image tasks',
    }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const context = await creatorContext();
    if (!context) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    let body: CreateDraftBody;
    try {
      const value: unknown = await req.json();
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid body');
      body = value as CreateDraftBody;
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    let input;
    let idempotencyKey: string;
    try {
      const rawKey = normalizeImageIdempotencyKey(body.idempotencyKey);
      idempotencyKey = scopedImageIdempotencyKey(context.user.id, context.workspace.id, rawKey);
      input = validateImageDraftInput({
        prompt: typeof body.prompt === 'string' ? body.prompt : '',
        model: typeof body.model === 'string' ? body.model : 'gpt-image-2',
        ratio: typeof body.ratio === 'string' ? body.ratio : '1:1',
        references: normalizeReferences(body.references),
        skill: normalizeSkill(body.skill),
      });
    } catch (error: unknown) {
      return NextResponse.json({
        error: error instanceof Error ? error.message : 'Invalid image draft',
      }, { status: 400 });
    }

    const inserted = await context.supabase
      .from('creator_generation_tasks')
      .upsert({
        workspace_id: context.workspace.id,
        user_id: context.user.id,
        kind: 'image',
        provider: 'wetoken',
        model: input.model,
        idempotency_key: idempotencyKey,
        status: 'draft',
        request: {
          prompt: input.prompt,
          effective_prompt: input.effectivePrompt,
          skill: input.skill,
          ratio: input.ratio,
          size: input.size,
          reference_manifest: input.references,
          reference_paths: [],
          uploads_complete: input.references.length === 0,
        },
      }, { onConflict: 'idempotency_key', ignoreDuplicates: true })
      .select('*')
      .maybeSingle();
    if (inserted.error && inserted.error.code !== '23505') throw inserted.error;

    let task = inserted.data as CreatorImageTask | null;
    let replayed = false;
    if (!task) {
      replayed = true;
      const existing = await context.supabase
        .from('creator_generation_tasks')
        .select('*')
        .eq('idempotency_key', idempotencyKey)
        .eq('workspace_id', context.workspace.id)
        .eq('user_id', context.user.id)
        .eq('kind', 'image')
        .maybeSingle();
      if (existing.error) throw existing.error;
      task = existing.data as CreatorImageTask | null;
      if (!task) {
        return NextResponse.json({ error: 'Idempotency key conflict' }, { status: 409 });
      }
    }

    if (
      task.workspace_id !== context.workspace.id
      || task.user_id !== context.user.id
      || task.kind !== 'image'
    ) {
      return NextResponse.json({ error: 'Idempotency key conflict' }, { status: 409 });
    }

    const request = asRecord(task.request);
    const manifest = normalizeReferences(request.reference_manifest);
    const uploadPaths = manifest.map((reference, index) => (
      referencePathFor(context.user.id, task!.id, index, reference.mimeType)
    ));
    return NextResponse.json({ task, uploadPaths, replayed }, { status: replayed ? 200 : 201 });
  } catch (error: unknown) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to create image draft',
    }, { status: 500 });
  }
}
