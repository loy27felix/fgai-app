// Native AdCraft keeps its API contracts; FG adds an authenticated workspace prefix.
export const fgWorkspace = /^\/advertising-app\/([0-9a-f-]{36})(?:\/|$)/.exec(window.location.pathname)?.[1] || '';
export const fgBasename = fgWorkspace ? '/advertising-app/' + fgWorkspace : undefined;
const labels: Record<string, string> = {
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
  if (/^\/(?:brand|agent-icons|agent-roles|video-skills|showcase)(?:\/|$)/.test(input) || /^\/assets\/.*\.(?:webp|png|jpg|svg|mp4)$/.test(input)) return '/adcraft-static' + input;
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
  const applyTheme = (theme: unknown) => {
    if (theme === 'light' || theme === 'dark') document.documentElement.dataset.fgTheme = theme;
  };
  applyTheme(new URLSearchParams(window.location.search).get('fgTheme') || 'dark');
  window.addEventListener('message', (event) => {
    if (event.origin === window.location.origin && event.source === window.parent && event.data?.type === 'fg-advertising-theme') applyTheme(event.data.theme);
  });
  const fetchNative = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const requested = typeof input === 'string' ? fgURL(input) : input;
    const response = await fetchNative(requested, init);
    if (!response.headers.get('content-type')?.includes('application/json')) return response;
    const headers = new Headers(response.headers); headers.delete('content-length'); headers.delete('content-encoding');
    return new Response(JSON.stringify(rewrite(await response.json())), { status: response.status, statusText: response.statusText, headers });
  };
  const NativeEventSource = window.EventSource;
  window.EventSource = class extends NativeEventSource { constructor(url: string | URL, options?: EventSourceInit) { super(fgURL(String(url)), options); } };
}
