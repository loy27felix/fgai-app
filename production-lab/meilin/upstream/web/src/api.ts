export type ImageCap = { references: { maxImages: number; maskSupported: boolean }; size: { parameter: string; values: string[]; default: string; presets?: { size: string; tier: string; ratio: string }[] }; quality: { supported: boolean; values: string[]; default: string } };
export type VideoCap = { references: { maxImages: number; maxVideos: number }; duration: { values: number[]; default: number }; ratios: string[]; resolutions: string[]; generateAudio: { supported: boolean }; operations: string[] };
export type Model = { id: string; label: string; capability: 'text' | 'image' | 'video'; note?: string; summary: string; default: boolean; cap: { image?: ImageCap; video?: VideoCap } };
export type Skill = { id: string; key: string; stage: 'script' | 'style' | 'asset' | 'render' | 'segment' | 'action' | 'boost'; label: string; note: string; license?: string; local?: boolean; installed: boolean };
export type StylePreset = { id: string; source: 'overseas' | 'fg-library'; title: string; description: string; image: string; prompt: string; palette?: string[]; film?: string; tags?: string[]; category?: string };
export type Direction = { id: string; name: string; tagline: string; enabled: boolean; defaults: Record<string, any> };
export type Config = {
  chains?: StudioChain[];
  planningPrompts?: {brief:string;bible:string};
  actor?: {id: string; name: string}; budget?: {monthlyCny: number|null;usedCny:number;remainingCny:number|null;unknown:number};
  mode: 'mock' | 'live'; media: string; directions: Direction[]; models: Model[]; skills: Skill[]; styles: StylePreset[];
  dramaStages: { id: string; name: string }[]; episodeStages: { id: string; name: string }[];
  aiStudio: { steps: string[]; prompts: { name: string; text: string }[] }; inspirations: boolean;
};

export type Memory = { id: string; text: string; kind: 'decision' | 'fact' | 'rule'; source?: string; at: string; edited?: boolean; ruleId?: string };
export type TraceItem = { k: 'memory' | 'intent' | 'skill' | 'model' | 'library' | 'ref' | 'rule' | 'act'; t: string };
export type NextStep = { label: string; say: string };
export type Msg = { id: string; role: 'user' | 'agent'; text: string; at: string };
export type Version = { id: string; model: string; params?: Record<string, string>; at: string; url: string | null; simulated?: boolean; uploaded?: boolean; skill?: string; prompt?: string };
export type Asset = { code: string; kind: 'character' | 'scene' | 'prop'; name: string; zh?: string; palette: string[]; prompt: string; status: 'draft' | 'rendering' | 'ready' | 'approved'; versions: Version[]; current: string | null; model: string | null; renderSkill?: string | null; scope: 'drama' | 'episode'; episode: number | null };
export type Lock = { present: string; gaze: string; props: string; env: string; mood: string; lastShot: string };
export type Segment = {
  id?:string;
  n: number; seconds: number; plotSeconds?: number; title: string; event: string; ending: string; cast: string[]; scene?: string; props?: string[]; refs?: string[]; stale?: boolean;
  opening: string; action?: boolean; status: 'outline' | 'written' | 'confirmed'; prompt?: string; lock?: Lock; lockText?: string;
  continuity?: { ok: boolean; notes: string[] }; dialogue?: { who: string; at: string; line: string; zh: string }[];
  beats?: { t: string; task: string }[]; notes?: string[]; takes?: { id: string; res: string; model: string; at: string; simulated?: boolean;url?:string }[]; picked?: string;
};
export type Job = { id: string; seg: number; res: string; model: string; status: string; progress: number; simulated?: boolean };
export type ActionCard = { items: { k: string; v: string; options?: string[]; pick?: number }[]; beats: string; confirmed: boolean };
export type Episode = {
  id?:string;
  n: number; title: string; stage: 'script' | 'cast' | 'segments' | 'shoot' | 'post'; done: boolean;
  scripts: { aistudio: string; sonnet: string; upload: string }; uploadName: string; chosen: null | 'aistudio' | 'sonnet' | 'upload';
  castCodes: string[]; newCodes: string[]; castConfirmed: boolean; outline: any[] | null; segments: Segment[]; actionCards: Record<string, ActionCard>; jobs: Job[];
};
export type Style = { source: string; id: string; title: string; description: string; image: string; prompt: string; palette: string[]; film: string; references: { url: string; name: string }[]; tags: string[]; simulated?: boolean };
export type Upload = { id: string; name: string; mime: string; size: number; url: string; purpose: string; palette: string[]; at: string };
export type Settings = {
  textModel: string; imageModel: string; imageParams: { size?: string; quality?: string }; videoModel: string;
  videoParams: { ratio?: string; preview?: string; final?: string; generateAudio?: boolean; operation?: string };
  segmentSeconds: number; aspect: string; fps: number; language: string; episodeSeconds: number;
  skills: { script: string; style: string; asset: string; render: string; segment: string; action: string; boost: string[] };
};
export type Drama = {
  studio?: Studio;
  permissions?: {owner:boolean;canEdit:boolean};
  production?: ProductionOperation[];
  id: string; direction: string; mode: 'mock' | 'live'; stage: 'brief' | 'bible' | 'assets' | 'ready'; title: string; titleZh: string; settings: Settings;
  brief: null | { idea: string; premise: string; premiseZh: string; genre: string; market: string; language: string; episodes: number; episodeSeconds: number; protagonist: string; questions: { id: string; q: string; options: string[]; pick: number; custom?: boolean }[]; confirmed?: boolean; sample?: boolean };
  bible: null | { title: string; titleZh: string; logline: string; loglineZh: string; faces: string; performance: string; rules: string[]; cast: { code: string; key: string; name: string; zh: string; age: number; look: string; role: string }[]; style: Style; confirmed: boolean };
  assets: { items: Asset[]; confirmed: boolean };
  episodes: Episode[];
  uploads: Upload[];
  messages: Msg[];
  memory?: Memory[];
  music: { main: string; sting: string };
};
export type DramaSummary = { id: string; canDelete?:boolean; title: string; titleZh: string; premise: string; stage: string; updatedAt: string; episodes: number; done: number; planned: number; cover: string; palette: string[] };
export type ExistingScript = {title:string;text:string;file?:File;episodeSeconds:number;language:string};
export type StreamUpdate = {event:string;data:{text?:string;action?:string}};
export type Inspiration = { id: string; title: string; description: string; mode: string; prompt: string; image: string; source: string; credit?: string };
export type Nav = { view?: string; episode?: number; stage?: string };
export type Ctx = { episode?: number };
export type Reply = { reply: string; nav?: Nav; project: Drama; upload?: Upload; trace?: TraceItem[]; next?: NextStep[]; focus?: string[] };

export type StudioChain={id:string;name:string;lead:string;description:string;available:boolean;stages:{id:string;name:string}[]};
export type StudioVersion={id:string;n:number;content:string;data:{assets?:{key:string;kind:string;name:string;prompt:string}[];shots?:StudioShot[]};at:string;note:string;approvedAt?:string;receipts:{id:string;path:string;sha256:string}[]};
export type StudioShot={key:string;title:string;seconds:number;prompt:string;referenceIds:string[];continuity?:string};
export type StudioArtifact={id:string;kind:string;title:string;current:string;approved?:string;stale?:boolean;versions:StudioVersion[]};
export type Studio={schema:number;chain:string;mode:string;stage:string;focus?:string;legacy?:boolean;locks:Record<string,string|number>;questions:{id:string;question:string;options:string[]}[];artifacts:StudioArtifact[];runs:{id:string;phase:string;status:string;at:string;error?:string}[]};
export type ProductionOperation={id:string;kind:string;label:string;model?:string;params?:Record<string,unknown>;referenceNames?:string[];referencePreviews?:{name:string;url:string}[];target?:{artifactId?:string;itemKey?:string};result?:{url:string};actorId?:string;digest:string;status:string;taskId?:string;error?:string;quotedAt:number;quote:{estimatedCny:number|null;lines:string[];notes:string[];budget:{remainingCny:number|null;monthlyCny:number|null;usedCny:number;unknown:number}}};
const integrated=window.location.pathname.includes('/meilin-app');
const fgPrefix=window.location.pathname.startsWith('/fg-six/')?'/fg-six':'';
export const apiURL=(path:string)=>integrated?fgPrefix+'/api/fg/meilin'+path.replace(/^\/api/,''):path;
const mapURLs=(value:any):any=>Array.isArray(value)?value.map(mapURLs):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,mapURLs(v)])):typeof value==='string'&&value.startsWith('/api/fg/meilin/')?fgPrefix+value:typeof value==='string'&&value.startsWith('/styles/')&&integrated?fgPrefix+'/meilin-app'+value:value;
async function req<T>(url: string, body?: unknown, method?: string, onUpdate?:(update:StreamUpdate)=>void): Promise<T> {
  const verb=method || (body ? 'POST' : 'GET'),raw=body?JSON.stringify(body):undefined;
  let key='',operationId='';
  if(!['GET','HEAD'].includes(verb)){
    const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(url+verb+(raw||'')));
    key='meilin.request.'+Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('');
    operationId=sessionStorage.getItem(key)||crypto.randomUUID();sessionStorage.setItem(key,operationId);
  }
  const r = await fetch(apiURL(url), { method:verb, headers: {...(body?{'content-type':'application/json'}:{}),...(operationId?{'x-fg-operation-id':operationId}:{}),...(onUpdate?{accept:'text/event-stream'}:{})}, body:raw,credentials:'same-origin' });
  if(onUpdate&&r.ok&&r.headers.get('content-type')?.includes('text/event-stream')){
    if(!r.body)throw Error('流式连接不可用，请刷新后查看原操作结果');
    const reader=r.body.getReader(),decoder=new TextDecoder();let buffer='',final:T|undefined;
    while(true){const {value,done}=await reader.read();buffer+=decoder.decode(value,{stream:!done});let end;
      while((end=buffer.indexOf('\n\n'))>=0){const block=buffer.slice(0,end);buffer=buffer.slice(end+2);const event=/^event: (.+)$/m.exec(block)?.[1],rawData=/^data: (.+)$/m.exec(block)?.[1];if(!event||!rawData)continue;
        const data=JSON.parse(rawData);if(event==='error')throw Error(data.error);if(event==='final')final=mapURLs(data) as T;else onUpdate({event,data});
      }if(done)break;
    }
    if(!final)throw Error('连接中断，原操作可能仍在处理；请刷新查看，不要重复提交。');if(key)sessionStorage.removeItem(key);return final;
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `请求失败（${r.status}）`);
  if(key)sessionStorage.removeItem(key);
  return mapURLs(data) as T;
}

export const api = {
  members: (id:string)=>req<{user_id:string;role:string}[]>(`/api/dramas/${id}/members`),
  share: (id:string,value:{email?:string;userId?:string;role:string})=>req<{user_id:string;role:string}[]>(`/api/dramas/${id}/members`,value),
  confirm: (id:string,ops:ProductionOperation[])=>req<Reply>(`/api/dramas/${id}/confirm`,{ids:ops.map(o=>o.id),digests:Object.fromEntries(ops.map(o=>[o.id,o.digest]))}),
  cancel: (id:string,ids:string[])=>req<Reply>(`/api/dramas/${id}/cancel`,{ids}),
  requote: (id:string,ids:string[])=>req<Reply>(`/api/dramas/${id}/requote`,{ids}),
  costs: (id:string)=>req<{calls:any[];budget:any}>(`/api/dramas/${id}/costs`),
  config: () => req<Config>('/api/config'),
  list: () => req<DramaSummary[]>('/api/dramas'),
  create: (direction: string) => req<Drama>('/api/dramas', { direction }),
  createStudio: (chain:string,mode='production')=>req<Drama>('/api/dramas',{chain,mode}),
  studio: (id:string,type:string,payload:Record<string,unknown>={})=>req<Reply>(`/api/dramas/${id}/studio`,type==='turn'?{type,...payload}:{type,payload}),
  get: (id: string) => req<Drama>(`/api/dramas/${id}`),
  remove: (id: string) => req<{ ok: true }>(`/api/dramas/${id}`, undefined, 'DELETE'),
  turn: (id: string, text: string, ctx: Ctx, onUpdate?:(update:StreamUpdate)=>void) => req<Reply>(`/api/dramas/${id}/turn`, { text, ctx },undefined,onUpdate),
  action: (id: string, type: string, payload: Record<string, unknown> = {}, ctx: Ctx = {}, onUpdate?:(update:StreamUpdate)=>void) => req<Reply>(`/api/dramas/${id}/action`, { type, payload, ctx },undefined,onUpdate),
  upload: (id: string, body: Record<string, unknown>) => req<Reply>(`/api/dramas/${id}/upload`, body),
  next: (id: string, episode?: number | null) => req<{ next: NextStep[]; memory: number }>(`/api/dramas/${id}/next?episode=${episode || ''}`),
  inspirations: (q: string, mode: string, offset = 0) => req<{ connected: boolean; total: number; items: Inspiration[] }>(`/api/inspirations?q=${encodeURIComponent(q)}&mode=${mode}&offset=${offset}`),
};

export const currentVersion = (a: Asset) => a.versions.find((v) => v.id === a.current) || a.versions.at(-1);
