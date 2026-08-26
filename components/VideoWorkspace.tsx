'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Episode, Scene } from '@/lib/types';
import {
  createVideoTask,
  getVideoTask,
  isActiveVideoTask,
  listVideoTasks,
  type VideoGenerationTask,
} from '@/lib/ai/video-client';
import { getVideoModel, VIDEO_MODELS } from '@/lib/ai/video-models';
import StudioShell from '@/components/studio/StudioShell';
import { Icon } from '@/components/studio/ui';
import { localMediaUrl } from '@/lib/local/client';

type ShotRow = {
  id: string;
  scene_id: string;
  no: string;
  title?: string | null;
  duration_s?: number | null;
  keyframe_path?: string | null;
  frame_path?: string | null;
  video_prompt?: any;
  video_url?: string | null;
  roles?: string[] | null;
};

const fu = (path?: string | null) => path ? localMediaUrl('project-assets', path) : null;
const pad = (n: number) => `EP${String(n).padStart(2, '0')}`;
const STATUS: Record<string, { label: string; color: string }> = {
  submitting: { label: '提交中', color: '#d0a85c' },
  queued: { label: '排队中', color: '#d0a85c' },
  running: { label: '生成中', color: '#79a8ff' },
  unknown: { label: '等待对账', color: '#e39a62' },
  succeeded: { label: '已完成', color: '#62c98d' },
  failed: { label: '失败', color: '#ff7676' },
  expired: { label: '已过期', color: '#a5a5ad' },
};

function replaceTask(tasks: VideoGenerationTask[], task: VideoGenerationTask) {
  const index = tasks.findIndex((item) => item.id === task.id);
  if (index < 0) return [task, ...tasks];
  return tasks.map((item, itemIndex) => itemIndex === index ? task : item);
}

export default function VideoWorkspace({ projectId, projectName, canEdit, episodes, scenes, shots }: {
  projectId: string;
  projectName: string;
  canEdit: boolean;
  episodes: Episode[];
  scenes: Scene[];
  shots: ShotRow[];
}) {
  const [epId, setEpId] = useState<string | null>(episodes[0]?.id || null);
  const [model, setModel] = useState(VIDEO_MODELS[0].id);
  const [resolution, setResolution] = useState('720p');
  const [ratio, setRatio] = useState('16:9');
  const [generateAudio, setGenerateAudio] = useState(true);
  const [watermark, setWatermark] = useState(false);
  const [tasks, setTasks] = useState<VideoGenerationTask[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(true);
  const [busyShot, setBusyShot] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [videoUrls, setVideoUrls] = useState<Record<string, string>>(
    Object.fromEntries(shots.filter((shot) => shot.video_url).map((shot) => [shot.id, shot.video_url as string])),
  );

  const selectedModel = getVideoModel(model) || VIDEO_MODELS[0];
  const epSceneIds = useMemo(
    () => new Set(scenes.filter((scene) => scene.episode_id === epId).map((scene) => scene.id)),
    [scenes, epId],
  );
  const epShots = useMemo(
    () => shots
      .filter((shot) => epSceneIds.has(shot.scene_id))
      .sort((a, b) => (a.no || '').localeCompare(b.no || '', 'zh', { numeric: true })),
    [shots, epSceneIds],
  );
  const latestByShot = useMemo(() => {
    const result = new Map<string, VideoGenerationTask>();
    tasks.forEach((task) => {
      if (task.shot_id && !result.has(task.shot_id)) result.set(task.shot_id, task);
    });
    return result;
  }, [tasks]);
  const activeIds = useMemo(
    () => tasks.filter(isActiveVideoTask).map((task) => task.id).join(','),
    [tasks],
  );
  const done = epShots.filter((shot) => videoUrls[shot.id]).length;

  useEffect(() => {
    let cancelled = false;
    setLoadingTasks(true);
    listVideoTasks(projectId)
      .then((items) => {
        if (cancelled) return;
        setTasks(items);
        const completed: Record<string, string> = {};
        items.forEach((task) => {
          if (task.shot_id && task.output?.videoUrl) completed[task.shot_id] = task.output.videoUrl;
        });
        if (Object.keys(completed).length) setVideoUrls((current) => ({ ...current, ...completed }));
      })
      .catch((error) => {
        if (!cancelled) setErrors((current) => ({ ...current, page: error.message || '读取视频任务失败' }));
      })
      .finally(() => {
        if (!cancelled) setLoadingTasks(false);
      });
    return () => { cancelled = true; };
  }, [projectId]);

  useEffect(() => {
    if (!activeIds) return;
    let stopped = false;
    let polling = false;
    const poll = async () => {
      if (polling || stopped) return;
      polling = true;
      const results = await Promise.allSettled(activeIds.split(',').map((id) => getVideoTask(id)));
      if (!stopped) {
        const fulfilled = results
          .filter((result): result is PromiseFulfilledResult<VideoGenerationTask> => result.status === 'fulfilled')
          .map((result) => result.value);
        if (fulfilled.length) {
          setTasks((current) => fulfilled.reduce(replaceTask, current));
          const completed: Record<string, string> = {};
          fulfilled.forEach((task) => {
            if (task.shot_id && task.output?.videoUrl) completed[task.shot_id] = task.output.videoUrl;
          });
          if (Object.keys(completed).length) setVideoUrls((current) => ({ ...current, ...completed }));
        }
      }
      polling = false;
    };
    const first = window.setTimeout(poll, 1800);
    const timer = window.setInterval(poll, 6500);
    return () => {
      stopped = true;
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [activeIds]);

  function changeModel(nextId: string) {
    const next = getVideoModel(nextId);
    setModel(nextId);
    if (next && !next.resolutions.includes(resolution)) setResolution(next.resolutions.includes('720p') ? '720p' : next.resolutions[0]);
  }

  async function generate(shot: ShotRow) {
    const prompt = String(shot.video_prompt?.text || '').trim();
    const frame = fu(shot.keyframe_path) || fu(shot.frame_path);
    if (!prompt && !frame) {
      setErrors((current) => ({ ...current, [shot.id]: '请先准备视频 Prompt 或关键帧。' }));
      return;
    }
    setBusyShot(shot.id);
    setErrors((current) => ({ ...current, [shot.id]: '' }));
    try {
      const task = await createVideoTask({
        projectId,
        shotId: shot.id,
        model,
        prompt,
        references: frame ? [{ type: 'image', url: frame, role: 'first_frame' }] : [],
        duration: Math.max(4, Math.min(15, Math.round(shot.duration_s || 5))),
        ratio,
        resolution,
        watermark,
        generateAudio,
      });
      setTasks((current) => replaceTask(current, task));
    } catch (error: any) {
      setErrors((current) => ({ ...current, [shot.id]: error?.message || '视频任务提交失败' }));
    } finally {
      setBusyShot(null);
    }
  }

  const fieldStyle = {
    height: 38,
    borderRadius: 10,
    background: 'var(--bg-2)',
    border: '1px solid var(--stroke)',
    padding: '0 10px',
    color: 'var(--text)',
    outline: 'none',
    fontSize: 12,
  };

  return (
    <StudioShell projectId={projectId} projectName={projectName} stageKey='video'>
      <div style={{ flex: 'none', padding: '20px 28px 16px', borderBottom: '1px solid var(--stroke)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 18, flexWrap: 'wrap' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 6 }}>
              <span className='fg-mono' style={{ fontSize: 11, letterSpacing: 2, color: 'var(--text-3)' }}>GENERATE</span>
              <span className='fg-script' style={{ fontSize: 22, color: 'var(--accent)', transform: 'rotate(-5deg)', textShadow: '0 0 18px var(--glow-a)' }}>frame to motion</span>
            </div>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: '-.6px' }}>
              生视频 <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--text-3)' }}>站内提交 · 自动追踪 · 回填镜头</span>
            </h1>
          </div>
          <span className='fg-mono' style={{ fontSize: 11, color: loadingTasks ? 'var(--text-3)' : 'var(--accent)' }}>
            {loadingTasks ? '同步任务中…' : `已接入 ${VIDEO_MODELS.length} 个 Seedance 模型`}
          </span>
        </div>

        <div style={{ marginTop: 16, padding: 13, borderRadius: 14, background: 'var(--panel)', border: '1px solid var(--stroke)', display: 'flex', alignItems: 'end', gap: 10, flexWrap: 'wrap' }}>
          <label style={{ flex: '1 1 310px', display: 'grid', gap: 5 }}>
            <span style={{ fontSize: 10.5, color: 'var(--text-3)' }}>模型</span>
            <select value={model} onChange={(event) => changeModel(event.target.value)} style={{ ...fieldStyle, width: '100%' }}>
              {VIDEO_MODELS.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.id}</option>)}
            </select>
          </label>
          <label style={{ display: 'grid', gap: 5 }}>
            <span style={{ fontSize: 10.5, color: 'var(--text-3)' }}>清晰度</span>
            <select value={resolution} onChange={(event) => setResolution(event.target.value)} style={fieldStyle}>
              {selectedModel.resolutions.map((value) => <option key={value}>{value}</option>)}
            </select>
          </label>
          <label style={{ display: 'grid', gap: 5 }}>
            <span style={{ fontSize: 10.5, color: 'var(--text-3)' }}>画幅</span>
            <select value={ratio} onChange={(event) => setRatio(event.target.value)} style={fieldStyle}>
              {['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9'].map((value) => <option key={value}>{value}</option>)}
            </select>
          </label>
          <button onClick={() => setGenerateAudio((value) => !value)} style={{ ...fieldStyle, cursor: 'pointer', color: generateAudio ? 'var(--accent)' : 'var(--text-3)' }}>
            {generateAudio ? '✓ 生成音频' : '不生成音频'}
          </button>
          <button onClick={() => setWatermark((value) => !value)} style={{ ...fieldStyle, cursor: 'pointer', color: watermark ? 'var(--accent)' : 'var(--text-3)' }}>
            {watermark ? '✓ 水印' : '无水印'}
          </button>
        </div>
        {selectedModel.filterOff && (
          <div style={{ marginTop: 8, fontSize: 11.5, color: '#d6ad62' }}>
            FILTER OFF 是 Wetoken 提供的关闭模型过滤版本；仍需遵守平台规则与适用法律。
          </div>
        )}
        {errors.page && <div style={{ marginTop: 8, fontSize: 12, color: '#ff7676' }}>{errors.page}</div>}

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', padding: 3, borderRadius: 11, background: 'var(--bg-2)', border: '1px solid var(--stroke)', gap: 3 }}>
            {episodes.map((episode) => {
              const active = epId === episode.id;
              return (
                <button key={episode.id} onClick={() => setEpId(episode.id)} style={{ padding: '7px 13px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 500, color: active ? 'var(--text)' : 'var(--text-3)', background: active ? 'var(--panel-2)' : 'transparent', border: 'none' }}>
                  {pad(episode.idx)}
                </button>
              );
            })}
          </div>
          <span className='fg-mono' style={{ fontSize: 12, color: 'var(--text-3)' }}>已完成 {done}/{epShots.length}</span>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 28px 60px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {epShots.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-3)', padding: '60px 0', border: '1.5px dashed var(--stroke-2)', borderRadius: 16 }}>
            本集还没有镜头。先到「逐镜头设计」准备关键帧和视频 Prompt。
          </div>
        ) : epShots.map((shot) => {
          const frame = fu(shot.keyframe_path) || fu(shot.frame_path);
          const prompt = String(shot.video_prompt?.text || '');
          const task = latestByShot.get(shot.id);
          const taskState = task ? STATUS[task.status] || STATUS.running : null;
          const videoUrl = videoUrls[shot.id] || task?.output?.videoUrl;
          const submitting = busyShot === shot.id;
          const active = task ? isActiveVideoTask(task) : false;
          const submissionUnknown = task?.status === 'unknown' || task?.status === 'submitting';
          const targetDuration = Math.max(4, Math.min(15, Math.round(shot.duration_s || 5)));
          return (
            <div key={shot.id} style={{ display: 'flex', gap: 16, padding: 16, borderRadius: 16, background: 'var(--panel)', border: '1px solid var(--stroke)', boxShadow: 'var(--inset)', flexWrap: 'wrap' }}>
              <div style={{ flex: 'none', width: 220 }}>
                <div style={{ aspectRatio: '16/9', borderRadius: 11, overflow: 'hidden', background: 'var(--bg-2)', border: '1px solid var(--stroke-2)', display: 'grid', placeItems: 'center', color: 'var(--text-3)', fontSize: 12 }}>
                  {videoUrl ? (
                    <video src={videoUrl} controls preload='metadata' poster={frame || undefined} style={{ width: '100%', height: '100%', objectFit: 'cover', background: '#080808' }} />
                  ) : frame ? (
                    <img src={frame} alt='' style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : '无关键帧 · 可纯文本生成'}
                </div>
                <div className='fg-mono' style={{ marginTop: 7, fontSize: 11, color: 'var(--text-3)', display: 'flex', justifyContent: 'space-between' }}>
                  <span>镜 {shot.no} · {targetDuration}s</span>
                  {taskState && <span style={{ color: taskState.color }}>{active && '● '}{taskState.label}</span>}
                </div>
              </div>

              <div style={{ flex: 1, minWidth: 300, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, fontWeight: 650 }}>{shot.title || `镜头 ${shot.no}`}</span>
                  {frame && <span style={{ fontSize: 10.5, color: 'var(--accent)', padding: '3px 7px', borderRadius: 6, background: 'var(--user-bubble)' }}>首帧已接入</span>}
                  {task?.model && <span className='fg-mono' style={{ fontSize: 9.5, color: 'var(--text-3)' }}>{task.model}</span>}
                </div>
                <div style={{ minHeight: 66, maxHeight: 118, overflow: 'auto', whiteSpace: 'pre-wrap', borderRadius: 10, border: '1px solid var(--stroke)', background: 'var(--bg-2)', padding: 11, fontSize: 12.5, lineHeight: 1.6, color: prompt ? 'var(--text-2)' : 'var(--text-3)' }}>
                  {prompt || '（没有视频 Prompt；有关键帧时仍可直接生成）'}
                </div>
                {errors[shot.id] && <div style={{ fontSize: 11.5, color: '#ff7676' }}>{errors[shot.id]}</div>}
                {task?.error && <div style={{ fontSize: 11.5, color: '#ff7676' }}>任务失败：{task.error}</div>}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 'auto', flexWrap: 'wrap' }}>
                  {canEdit && (
                    <button onClick={() => generate(shot)} disabled={submitting || active || submissionUnknown} style={{ height: 38, padding: '0 16px', borderRadius: 10, border: 'none', cursor: submitting || active || submissionUnknown ? 'wait' : 'pointer', color: 'var(--accent-ink)', background: 'var(--accent)', fontSize: 12.5, fontWeight: 650, opacity: submitting || active || submissionUnknown ? .58 : 1, display: 'flex', alignItems: 'center', gap: 7 }}>
                      <Icon d={['M12 19l7-7a2.8 2.8 0 0 0-4-4l-7 7-1 5 5-1Z']} size={15} sw={1.8} />
                      {submitting ? '提交中…' : submissionUnknown ? taskState?.label : active ? taskState?.label : videoUrl ? '重新生成' : '生成视频'}
                    </button>
                  )}
                  {videoUrl && <a href={videoUrl} target='_blank' rel='noreferrer' style={{ height: 38, padding: '0 13px', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--accent)', background: 'var(--user-bubble)', border: '1px solid var(--user-stroke)', fontSize: 12 }}>打开原视频 ↗</a>}
                  {task?.created_at && <span style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--text-3)' }}>{new Date(task.created_at).toLocaleString('zh-CN')}</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </StudioShell>
  );
}
