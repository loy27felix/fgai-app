import { useEffect, useState } from 'react';
export default function FGImageModelSelect() {
  const [models, setModels] = useState<Array<{billingId: string; name: string; capability: string}>>([]);
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {void fetch('/.opencreator/runtime/fg-models').then(async r => {
    if (!r.ok) throw Error('公司模型读取失败');
    const data = await r.json(); setModels(data.models.filter((m: {capability: string}) => m.capability === 'image'));setModel(data.defaults.image);
  }).catch(e => setError(e.message));}, []);
  return <label className="creator-tool-field"><span>图片模型 · 本人默认</span><select aria-label="图片模型" value={model} disabled={busy || !models.length} onChange={async e => {
    const next = e.target.value;setBusy(true);setError('');
    try {const r = await fetch('/.opencreator/runtime/fg-model-selection', {method: 'POST',headers: {'content-type': 'application/json'},body: JSON.stringify({capability: 'image',model: next})});if (!r.ok) throw Error('模型保存失败');setModel(next);}
    catch (e) {setError(e instanceof Error ? e.message : '模型保存失败');}finally {setBusy(false);}
  }}>{models.map(m => <option key={m.billingId} value={m.billingId}>{m.name}</option>)}</select>{error ? <small role="alert">{error}</small> : null}</label>;
}
