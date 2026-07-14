'use client';

import { useMemo, useState } from 'react';
import type { BibleFields, Episode, Scene } from '@/lib/types';
import { buildBgmShotContext } from '@/lib/bgm';
import StudioShell from '@/components/studio/StudioShell';
import AiPanel from '@/components/studio/AiPanel';
import { Icon, Hov } from '@/components/studio/ui';

type ShotRow = {
  id: string;
  scene_id: string;
  no: string;
  title?: string | null;
  duration_s?: number | null;
  script_beat?: Record<string, string> | null;
  video_prompt?: { text?: string } | null;
};

const pad = (index: number) => `EP${String(index).padStart(2, '0')}`;

export default function BgmWorkspace({ projectId, projectName, canEdit, bible, episodes, scenes, shots }: {
  projectId: string;
  projectName: string;
  canEdit: boolean;
  bible: BibleFields;
  episodes: Episode[];
  scenes: Scene[];
  shots: ShotRow[];
}) {
  const [episodeId, setEpisodeId] = useState(episodes[0]?.id || '');
  const [briefs, setBriefs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const episode = episodes.find((item) => item.id === episodeId) || episodes[0];
  const shotContext = useMemo(
    () => episode ? buildBgmShotContext(episode.id, scenes, shots) : '',
    [episode, scenes, shots],
  );
  const episodeSceneIds = useMemo(
    () => new Set(scenes.filter((scene) => scene.episode_id === episode?.id).map((scene) => scene.id)),
    [episode, scenes],
  );
  const episodeShots = shots.filter((shot) => episodeSceneIds.has(shot.scene_id));
  const duration = episodeShots.reduce((total, shot) => total + (shot.duration_s || 0), 0);
  const brief = episode ? briefs[episode.id] || '' : '';

  function setBrief(value: string) {
    if (episode) setBriefs((current) => ({ ...current, [episode.id]: value }));
  }

  async function generateBrief() {
    if (!episode || !shotContext) return;
    setBusy(true);
    try {
      const system = [
        '你是影视配乐导演与 Suno Style Prompt 专家。',
        '根据连续镜头的剧情与情绪，把本集划分成少量连续配乐段落；不要机械地每个镜头换一首音乐。',
        '每个段落必须严格使用以下格式：',
        '【镜头 X–Y】',
        '配乐作用：中文说明情绪、叙事功能、进入与退出方式。',
        '速度与配器：BPM、主要乐器、节奏密度。',
        'Suno Style Prompt: 一行英文，适合粘贴到 Suno Style，明确 instrumental / no vocals、曲风、情绪、乐器、BPM、动态结构和影视用途。',
        '相邻段落需要说明转场方式。最后补一个全剧统一性建议。不要输出 markdown 表格或代码块。',
      ].join('\n');
      const user = [
        `项目：《${projectName}》`,
        `集数：${pad(episode.idx)} ${episode.title || ''}`,
        `题材：${bible.genre || '未填'}`,
        `画风/色调：${bible.style || '未填'}`,
        `世界观：${bible.worldRules || '未填'}`,
        `一句话梗概：${bible.logline || '未填'}`,
        `本集总时长约：${duration} 秒`,
        '',
        '逐镜头信息：',
        shotContext,
      ].join('\n');
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          model: 'deepseek-flash',
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'AI 生成失败');
      setBrief(data.content || '');
    } catch (error: any) {
      setBrief(`⚠️ ${error?.message || '生成失败'}`);
    } finally {
      setBusy(false);
    }
  }

  function copy() {
    navigator.clipboard?.writeText(brief);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }

  const systemAI = `你是 FG Studio 的配乐 AI，为 AI 漫剧《${projectName}》按连续镜头范围设计 BGM。必须给每段对应的镜头起止号、配乐作用、BPM/乐器，以及可粘到 Suno Style 的英文 instrumental prompt。当前集：${episode ? pad(episode.idx) : '未选'}。\n画风/基调：${bible.style || ''}；题材：${bible.genre || ''}\n镜头：\n${shotContext.slice(0, 3500)}`;

  return (
    <StudioShell projectId={projectId} projectName={projectName} stageKey='bgm'
      right={<AiPanel embedded projectId={projectId} scope={`bgm-${episode?.id || 'main'}`} title='配乐 AI' badge='FG-BGM' contextNote={episode ? `已读取 ${pad(episode.idx)} 的 ${episodeShots.length} 个镜头` : '暂无镜头'} system={systemAI}
        quick={['按镜头范围划分配乐段', '写每段 Suno 英文 Style', '优化段落之间的音乐转场']} placeholder='讨论镜头范围 / 情绪 / BPM / 配器……（⌘↵）' />}>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '28px 30px 60px' }}>
        <div style={{ maxWidth: 920, margin: '0 auto', animation: 'blurUp .5s var(--ease) both' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
            <span className='fg-mono' style={{ fontSize: 11, letterSpacing: 2, color: 'var(--text-3)' }}>AUDIO MAP</span>
            <span className='fg-script' style={{ fontSize: 22, color: 'var(--accent)', transform: 'rotate(-5deg)', textShadow: '0 0 18px var(--glow-a)' }}>shots to score</span>
          </div>
          <h1 style={{ margin: '0 0 8px', fontSize: 26, fontWeight: 700, letterSpacing: '-.6px' }}>
            BGM · 镜头配乐表 <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--text-3)' }}>镜头范围 → Suno Style Prompt</span>
          </h1>
          <p style={{ margin: '0 0 18px', fontSize: 13.5, color: 'var(--text-2)', lineHeight: 1.7 }}>
            AI 会按情绪连续性合并镜头，明确“镜头几到几”使用哪段音乐，并为每段生成可直接粘贴到 Suno Style 的英文提示词。
          </p>

          <div style={{ display: 'flex', gap: 5, padding: 4, borderRadius: 12, background: 'var(--bg-2)', border: '1px solid var(--stroke)', marginBottom: 12, width: 'fit-content', maxWidth: '100%', flexWrap: 'wrap' }}>
            {episodes.map((item) => {
              const active = item.id === episode?.id;
              return <button key={item.id} onClick={() => setEpisodeId(item.id)} style={{ padding: '7px 13px', borderRadius: 9, border: 'none', cursor: 'pointer', color: active ? 'var(--text)' : 'var(--text-3)', background: active ? 'var(--panel-2)' : 'transparent', fontSize: 12.5 }}>{pad(item.idx)}</button>;
            })}
          </div>

          {episode ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
                <span className='fg-mono' style={{ fontSize: 11, color: 'var(--text-3)' }}>{episodeShots.length} 镜 · 约 {duration}s</span>
                {canEdit && <Hov as='button' onClick={generateBrief} disabled={busy || !shotContext} base={{ display: 'flex', alignItems: 'center', gap: 8, height: 40, padding: '0 16px', borderRadius: 12, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--accent-ink)', background: 'var(--accent)', border: 'none', boxShadow: 'var(--inset),0 8px 20px -8px var(--accent)', opacity: busy || !shotContext ? .55 : 1 }} hover={busy ? undefined : { filter: 'brightness(1.08)' }}><Icon d={['M9 18V5l12-2v13', 'M9 13a3 3 0 1 0-6 0 3 3 0 0 0 6 0Z', 'M21 16a3 3 0 1 0-6 0 3 3 0 0 0 6 0Z']} size={16} sw={1.7} />{busy ? '正在分析镜头…' : `生成 ${pad(episode.idx)} 配乐表`}</Hov>}
                <button onClick={copy} disabled={!brief} style={{ height: 40, padding: '0 14px', borderRadius: 12, cursor: brief ? 'pointer' : 'default', fontSize: 13, color: 'var(--text-2)', background: 'var(--panel)', border: '1px solid var(--stroke)', opacity: brief ? 1 : .5 }}>{copied ? '已复制 ✓' : '复制本集全部 Prompt'}</button>
                <a href='https://suno.com/create' target='_blank' rel='noreferrer' style={{ display: 'flex', alignItems: 'center', gap: 6, height: 40, padding: '0 14px', borderRadius: 12, fontSize: 13, color: 'var(--accent)', background: 'var(--user-bubble)', border: '1px solid var(--user-stroke)' }}>打开 Suno<Icon d={['M7 17 17 7M9 7h8v8']} size={14} sw={1.7} /></a>
              </div>
              <div style={{ borderRadius: 16, background: 'var(--panel)', border: '1px solid var(--stroke)', boxShadow: 'var(--inset)', overflow: 'hidden' }}>
                <textarea value={brief} onChange={(event) => setBrief(event.target.value)} placeholder={shotContext ? '点击生成后，这里会按【镜头 X–Y】输出每段配乐方案和 Suno Style Prompt；结果可继续手动编辑。' : '本集还没有镜头，请先完成剧本/分镜。'} style={{ display: 'block', width: '100%', minHeight: 440, resize: 'vertical', border: 'none', outline: 'none', background: 'transparent', color: 'var(--text)', fontSize: 13.5, lineHeight: 1.85, padding: '17px 19px', fontFamily: 'inherit' }} />
              </div>
            </>
          ) : <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-3)', border: '1px dashed var(--stroke-2)', borderRadius: 16 }}>暂无剧集。请先在剧本工作台创建剧集和镜头。</div>}
        </div>
      </div>
    </StudioShell>
  );
}
