// Native AdCraft keeps its API contracts; FG adds an authenticated workspace prefix.
export const fgWorkspace = /^\/advertising-app\/([0-9a-f-]{36})(?:\/|$)/.exec(window.location.pathname)?.[1] || '';
export const fgBasename = fgWorkspace ? '/advertising-app/' + fgWorkspace : undefined;
let editorToken='';
export function setFGEditorToken(token:string){editorToken=token;}
const labels: Record<string, string> = {
  Text:'文本',Script:'脚本',Image:'图片',Video:'视频',Audio:'音频',Editing:'剪辑',Draft:'草稿',Failed:'失败',
  'Platform Default':'通用广告风格',
  'Size':'尺寸','Aspect ratio':'比例','Duration seconds':'时长（秒）','Duration (s)':'时长（秒）','Ratio':'比例','Resolution':'清晰度','Quality':'画质','Generate audio':'同时生成声音','Not set':'使用默认值','Clear':'恢复默认值',
  'General Image':'图片','General Text':'文本','General Video':'视频','General Audio':'音频',
  'Start with a node or talk to AdCraft Video Agent.': '添加节点，或告诉 FG 广告助手你的产品、卖点和制作目标。',
  'Describe the ad you want to build.': '描述产品、受众、卖点和广告风格，开始制作。',
  'Ask AdCraft Video Agent...': '告诉 FG 广告助手你的制作需求…',
  'Collaboration': '自动制作',
  'Ready': '待命',
  'Waiting for model': '等待模型',
  'Working': '制作中',
  'Skill': '制作技能',
};
export function fgLabel(text: string): string {
  return fgWorkspace ? labels[text] || text.replaceAll('AdCraft Video Agent', 'FG 广告助手').replaceAll('AdCraft Bot', 'FG 广告助手') : text;
}
export function fgURL(input: string): string {
  if (!fgWorkspace) return input;
  if (/^\/(?:api\/v[12](?:\/|$)|media(?:\/|$))/.test(input)) return '/adcraft-api/' + fgWorkspace + input;
  if (/^\/(?:brand|agent-icons|agent-roles|video-skills|showcase|imgs|icon|fonts)(?:\/|$)/.test(input) || /^\/assets\/.*\.(?:webp|png|jpg|svg|mp4)$/.test(input)) return '/adcraft-static' + input;
  return input;
}
function rewrite(value: unknown): unknown {
  if (typeof value === 'string') return fgURL(value);
  if (Array.isArray(value)) return value.map(rewrite);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, rewrite(child)]));
  return value;
}
export function installFGScope() {
  if (!fgWorkspace) return;
  // AdCraft owns its appearance independently from the FG workbench.
  document.documentElement.lang = 'zh-CN';
  const fetchNative = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const requested = typeof input === 'string' ? fgURL(input) : input;
    if(editorToken&&typeof requested==='string'&&(requested.startsWith('/adcraft-api/')||requested==='/api/fg/advertising/'+fgWorkspace+'/company-asset')){
      const headers=new Headers(init?.headers);headers.set('X-FG-Editor-Key','ad:'+fgWorkspace);headers.set('X-FG-Editor-Token',editorToken);init={...init,headers};
    }
    const response = await fetchNative(requested, init);
    // Deletes and conditional reads may advertise JSON while returning no body.
    // Keep native no-content responses intact so the caller can handle their status.
    if ([204, 205, 304].includes(response.status) || init?.method?.toUpperCase() === 'HEAD' || !response.headers.get('content-type')?.includes('application/json')) return response;
    const headers = new Headers(response.headers); headers.delete('content-length'); headers.delete('content-encoding');
    const data=await response.json();if(data.reason==='FG_EDITOR_REPLACED')window.dispatchEvent(new CustomEvent('fg-editor-lost',{detail:data.msg}));
    return new Response(JSON.stringify(rewrite(data)), { status: response.status, statusText: response.statusText, headers });
  };
  const NativeEventSource = window.EventSource;
  window.EventSource = class extends NativeEventSource { constructor(url: string | URL, options?: EventSourceInit) { super(fgURL(String(url)), options); } };
}
