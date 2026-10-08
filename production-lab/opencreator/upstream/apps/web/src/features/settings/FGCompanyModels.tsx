import { useEffect, useState } from 'react';

type Model = { billingId: string; name: string; capability: string; profile: Record<string, unknown> };
export default function FGCompanyModels() {
  const [models, setModels] = useState<Model[]>([]);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    void fetch('/.opencreator/runtime/fg-models', {signal: controller.signal}).then(async r => {
      const data = await r.json();
      if (!r.ok) throw Error(data.error?.message || '公司模型读取失败');
      if (!Array.isArray(data.models) || !data.defaults) throw Error('公司模型列表暂不可用');
      if (!controller.signal.aborted) {setModels(data.models); setSelected(data.defaults);}
    }).catch(e => {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '公司模型读取失败');
    }).finally(() => {if (!controller.signal.aborted) setLoading(false);});
    return () => controller.abort();
  }, [revision]);
  async function choose(capability: string, model: string) {
    setSaving(true); setError('');
    try {
      const r = await fetch('/.opencreator/runtime/fg-model-selection', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({capability, model})});
      const data = await r.json(); if (!r.ok) throw Error(data.error?.message || '模型保存失败');
      setSelected(data.defaults);
    } catch (e) {setError(e instanceof Error ? e.message : '模型保存失败');}
    finally {setSaving(false);}
  }
  return <section className="settings-section">
    <header><h1>公司 AI 服务</h1><p>使用 FG 统一渠道，无需个人 Codex 账号；Suno 音乐对成员免费，火山语音不受制作额度拦截。其他模型费用计入本人月额度。</p></header>
    <div className="settings-card">
      {(['text', 'image', 'video', 'audio'] as const).map(capability => {
        const available = models.filter(m => m.capability === capability);
        const value = available.some(m => m.billingId === selected[capability]) ? selected[capability] : '';
        return <label className="settings-row" key={capability}>
        <span>{{text: '默认文本模型', image: '默认图片模型', video: '默认视频模型',audio:'默认配音模型'}[capability]}</span>
        <select className="settings-select" aria-label={{text: '默认文本模型', image: '默认图片模型', video: '默认视频模型',audio:'默认配音模型'}[capability]} value={value} disabled={saving || loading || !!error || !available.length} onChange={e => void choose(capability, e.target.value)}>
          <option value="" disabled>{loading ? '正在读取模型…' : available.length ? '请选择默认模型' : error ? '工作区连接未就绪' : '暂无可用模型'}</option>
          {available.map(m => <option key={m.billingId} value={m.billingId}>{m.name}</option>)}
        </select>
      </label>;})}
      <div className="settings-row"><span>音乐、配音与字幕</span><a href={`${window.location.port === '3016' ? '' : '/fg-six'}/fg-audio-tools?tab=music`} target="_blank" rel="noopener noreferrer">打开音乐与歌词工作区</a></div>
    </div>
    {error ? <div role="alert"><p>{error}。恢复连接后可重新读取模型。</p><button type="button" className="settings-button" disabled={loading} onClick={() => setRevision(value => value + 1)}>重新读取</button></div> : null}
  </section>;
}
