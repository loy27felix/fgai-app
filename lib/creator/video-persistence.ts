import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import type { CreatorVideoTask } from '@/lib/creator/types';

const MAX_VIDEO_BYTES = 320 * 1024 * 1024;

type VideoStorageContext = {
  supabase: ReturnType<typeof createClient>;
  user: { id: string };
  workspace: { id: string };
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Copy a temporary provider URL into the private creator-assets bucket. */
export async function persistVideoOutput(
  context: VideoStorageContext,
  task: CreatorVideoTask,
  output: Record<string, unknown>,
) {
  if (typeof output.video_storage_path === 'string' || typeof output.video_url !== 'string' || !output.video_url) return output;
  try {
    const response = await fetch(output.video_url, { redirect: 'follow' });
    if (!response.ok) throw new Error('provider video download returned HTTP ' + response.status);
    const mimeType = response.headers.get('content-type')?.split(';')[0] || 'video/mp4';
    if (mimeType.includes('json') || mimeType.startsWith('text/')) {
      throw new Error('provider returned a non-video response');
    }
    const body = await response.arrayBuffer();
    if (body.byteLength > MAX_VIDEO_BYTES) throw new Error('provider video exceeds durable storage limit');
    const storagePath = context.user.id + '/video-tasks/' + task.id + '/result.mp4';
    let upload = await context.supabase.storage.from('creator-assets').upload(storagePath, body, { upsert: true, contentType: mimeType });
    if (upload.error) {
      try {
        upload = await createAdminClient().storage.from('creator-assets').upload(storagePath, body, { upsert: true, contentType: mimeType });
      } catch (error) {
        console.error('[creator video durable upload]', error);
      }
    }
    if (upload.error) throw upload.error;

    const existing = await context.supabase
      .from('creator_assets')
      .select('id')
      .eq('workspace_id', context.workspace.id)
      .eq('storage_path', storagePath)
      .maybeSingle();
    let assetId = existing.data?.id || null;
    if (existing.error || !assetId) {
      const row = {
        workspace_id: context.workspace.id,
        session_id: null,
        kind: 'video',
        source: 'generation',
        name: task.id + '.mp4',
        storage_path: storagePath,
        mime_type: mimeType,
        metadata: { task_id: task.id, node_id: task.node_id, model: task.model, duration: asRecord(task.request).duration, source_url: output.video_url },
      };
      let inserted = await context.supabase.from('creator_assets').insert(row).select('id').maybeSingle();
      if (inserted.error) {
        try { inserted = await createAdminClient().from('creator_assets').insert(row).select('id').maybeSingle(); } catch (error) { console.error('[creator video durable asset row]', error); }
      }
      if (inserted.error) throw inserted.error;
      assetId = inserted.data?.id || null;
    }
    return { ...output, video_storage_path: storagePath, video_asset_id: assetId };
  } catch (error) {
    // Keep the provider URL as a fallback; a transient download failure must
    // not turn a successful generation into a failed task.
    console.error('[creator video durable persistence]', error);
    return output;
  }
}

export async function ensureVideoOutputStored(context: VideoStorageContext, task: CreatorVideoTask) {
  const nextOutput = await persistVideoOutput(context, task, asRecord(task.output));
  if (nextOutput === task.output || JSON.stringify(nextOutput) === JSON.stringify(task.output)) return task;
  const values = { output: nextOutput };
  let update = await context.supabase
    .from('creator_generation_tasks')
    .update(values)
    .eq('id', task.id)
    .eq('workspace_id', context.workspace.id)
    .eq('user_id', context.user.id)
    .eq('kind', 'video')
    .select('*')
    .maybeSingle();
  if (update.error || !update.data) {
    try {
      update = await createAdminClient().from('creator_generation_tasks').update(values).eq('id', task.id).eq('workspace_id', context.workspace.id).eq('user_id', context.user.id).eq('kind', 'video').select('*').maybeSingle();
    } catch (error) {
      console.error('[creator video durable task update]', error);
    }
  }
  return update.error || !update.data ? task : update.data as CreatorVideoTask;
}

export async function signedVideoOutputUrl(context: VideoStorageContext, output: Record<string, unknown>, ttlSeconds = 300) {
  if (typeof output.video_storage_path === 'string') {
    const signed = await context.supabase.storage.from('creator-assets').createSignedUrl(output.video_storage_path, ttlSeconds);
    if (!signed.error && signed.data?.signedUrl) return signed.data.signedUrl;
  }
  return typeof output.video_url === 'string' ? output.video_url : null;
}
