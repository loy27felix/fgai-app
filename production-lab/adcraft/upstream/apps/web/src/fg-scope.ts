// Native AdCraft keeps its API contracts; FG adds an authenticated workspace prefix.
export const fgWorkspace = /^\/advertising-app\/([0-9a-f-]{36})(?:\/|$)/.exec(window.location.pathname)?.[1] || '';
export const fgBasename = fgWorkspace ? '/advertising-app/' + fgWorkspace : undefined;
export function fgURL(input: string): string {
  if (!fgWorkspace) return input;
  if (/^\/(?:api\/v[12](?:\/|$)|media(?:\/|$))/.test(input)) return '/adcraft-api/' + fgWorkspace + input;
  if (/^\/(?:brand|agent-icons|agent-roles|video-skills|showcase)(?:\/|$)/.test(input)) return '/adcraft-static' + input;
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
