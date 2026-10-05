import { useEffect, useState } from 'react';

type Model = { billingId: string; name: string; capability: string; profile: Record<string, unknown> };
export default function FGCompanyModels() {
  const [models, setModels] = useState<Model[]>([]);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    void fetch('/.opencreator/runtime/fg-models').then(async r => {
      if (!r.ok) throw Error('公司模型读取失败');
      const data = await r.json(); setModels(data.models); setSelected(data.defaults);
    }).catch(e => setError(String(e.message)));
  }, []);
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
    <header><h1>公司 AI 服务</h1><p>使用 FG 统一渠道，无需个人 Codex 账号；费用计入本人月额度。对话模型可在助手中单独切换。</p></header>
    <div className="settings-card">
      {(['text', 'image', 'video', 'audio'] as const).map(capability => <label className="settings-row" key={capability}>
        <span>{{text: '默认文本模型', image: '默认图片模型', video: '默认视频模型',audio:'默认配音模型'}[capability]}</span>
        <select className="settings-select" aria-label={{text: '默认文本模型', image: '默认图片模型', video: '默认视频模型',audio:'默认配音模型'}[capability]} value={selected[capability] || ''} disabled={saving || !models.length} onChange={e => void choose(capability, e.target.value)}>
          {models.filter(m => m.capability === capability).map(m => <option key={m.billingId} value={m.billingId}>{m.name}</option>)}
        </select>
      </label>)}
      <div className="settings-row"><span>音乐、配音与语音识别</span><a href="/fg-audio-tools" target="_blank">打开公司音频工具</a></div>
    </div>
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
