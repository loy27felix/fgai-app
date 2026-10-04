// Native AdCraft keeps its API contracts; FG adds an authenticated workspace prefix.
export const fgWorkspace = /^\/advertising-app\/([0-9a-f-]{36})(?:\/|$)/.exec(window.location.pathname)?.[1] || '';
export const fgBasename = fgWorkspace ? '/advertising-app/' + fgWorkspace : undefined;
let editorToken='';
export function setFGEditorToken(token:string){editorToken=token;}
const labels: Record<string, string> = {
  'The backend workflow data does not match this frontend. Your project selection was preserved; update the frontend and refresh the page.':'广告工程数据与当前页面版本不一致，工程关联已保留；请刷新页面或联系管理员更新。',
  'The backend could not be reached. Your project selection was preserved; retry when the service is available.':'暂时无法连接广告服务，工程关联已保留；请返回广告项目页重试。',
  'The backend project could not be restored. Your project selection was preserved; retry when the service is available.':'广告工程暂时无法恢复，工程关联已保留；请返回广告项目页重试，或联系管理员检查 NAS 连接。',
  'The backend project could not be restored.':'广告工程暂时无法恢复，请联系管理员恢复原工程。',
  'Saved project could not be restored.':'已保存的广告工程暂时无法恢复，请返回广告项目页重试。',
  'Choose model':'选择模型','Compatible models':'可用模型',
  'Default model':'默认模型','Name unavailable':'名称不可用','Not configured':'未配置','Loading compatible models...':'正在读取可用模型…',
  Assets:'项目素材', 'Project Assets':'工程素材','My Assets':'我的图片','Recommended':'推荐图片','All media':'全部类型',Images:'图片',Videos:'视频',
  'Agent Canvas assets':'广告项目素材','Close assets':'关闭素材窗口','Search assets':'搜索素材','Images only':'仅图片',
  'Attach references or place ready media on the canvas.':'选择参考素材，或把已有图片、视频和音频放入画布。工程素材默认私有，公司素材可按需导入。',
  'No matching assets':'没有匹配的素材','No project assets yet':'工程中还没有素材','No saved images':'还没有收藏图片','No recommended images':'暂无推荐图片',
  'Loading assets':'正在加载素材',Retry:'重试','Upload media':'上传素材',Unavailable:'暂不可用',Adding:'正在添加',
  'Select compatible images to attach':'选择图片作为参考素材',Uploading:'上传中',Upload:'上传','Adding references':'正在添加参考素材',
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
