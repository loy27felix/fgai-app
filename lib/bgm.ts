type SceneLike = { id: string; episode_id: string; idx: number };
type ShotLike = {
  id: string;
  scene_id: string;
  no: string;
  title?: string | null;
  duration_s?: number | null;
  script_beat?: Record<string, string> | null;
  video_prompt?: { text?: string } | null;
};

export function buildBgmShotContext(episodeId: string, scenes: SceneLike[], shots: ShotLike[]) {
  const orderedScenes = scenes.filter((scene) => scene.episode_id === episodeId).sort((a, b) => a.idx - b.idx);
  const sceneOrder = new Map(orderedScenes.map((scene, index) => [scene.id, index]));
  return shots
    .filter((shot) => sceneOrder.has(shot.scene_id))
    .sort((a, b) => {
      const sceneDiff = (sceneOrder.get(a.scene_id) || 0) - (sceneOrder.get(b.scene_id) || 0);
      return sceneDiff || (a.no || '').localeCompare(b.no || '', 'zh', { numeric: true });
    })
    .map((shot) => {
      const beat = shot.script_beat || {};
      const details = [
        shot.title,
        beat['画面'] && `画面：${beat['画面']}`,
        beat['动作'] && `动作：${beat['动作']}`,
        beat['情绪'] && `情绪：${beat['情绪']}`,
        beat['对白'] && `对白：${beat['对白']}`,
        shot.video_prompt?.text && `视频意图：${shot.video_prompt.text.slice(0, 180)}`,
      ].filter(Boolean);
      return `镜头 ${shot.no || '?'} | ${shot.duration_s || 0}s | ${details.join('；') || '无补充描述'}`;
    })
    .join('\n');
}
