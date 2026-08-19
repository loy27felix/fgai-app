import { redirect } from 'next/navigation';
import { createClient } from '@/lib/local/server';
import GenCanvas from '@/components/studio/GenCanvas';

export const dynamic = 'force-dynamic';

export default async function ShotCanvasPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { shot?: string };
}) {
  const localClient = createClient();
  const { data: { user } } = await localClient.auth.getUser();
  if (!user) redirect('/');
  const projectId = params.id;
  const shotId = searchParams.shot || '';
  const [{ data: project }, { data: member }] = await Promise.all([
    localClient.from('projects').select('id,name').eq('id', projectId).single(),
    localClient.from('project_members').select('role').eq('project_id', projectId).eq('user_id', user.id).maybeSingle(),
  ]);
  if (!project) redirect('/projects');
  if (!member || !shotId) redirect(`/projects/${projectId}/shots`);

  const { data: shot } = await localClient.from('shots')
    .select('id,scene_id,no,duration_s,keyframe_path,frame_path,keyframe_prompt,video_prompt')
    .eq('id', shotId).maybeSingle();
  if (!shot) redirect(`/projects/${projectId}/shots`);
  const { data: scene } = await localClient.from('scenes').select('id,episode_id').eq('id', shot.scene_id).maybeSingle();
  const { data: episode } = scene
    ? await localClient.from('episodes').select('id,project_id').eq('id', scene.episode_id).maybeSingle()
    : { data: null };
  if (episode?.project_id !== projectId) redirect(`/projects/${projectId}/shots`);

  const storagePath = shot.keyframe_path || shot.frame_path;
  const initialImageUrl = storagePath
    ? localClient.storage.from('project-assets').getPublicUrl(storagePath).data.publicUrl
    : null;
  return (
    <GenCanvas
      projectId={projectId}
      projectName={project.name}
      scope='shots'
      refKey={shot.id}
      assetType='场景'
      stageKey='shots'
      backHref={`/projects/${projectId}/shots`}
      shotId={shot.id}
      shotField='keyframe_path'
      initialImageUrl={initialImageUrl}
      initialPrompt={shot.keyframe_prompt}
      initialVideoPrompt={shot.video_prompt?.text || null}
      shotDuration={shot.duration_s || 5}
      canvasTitle={`镜头 ${shot.no} · 独立画布`}
    />
  );
}
