import {afterEach,describe,expect,it,vi} from 'vitest';

const originalFetch=window.fetch;
const originalEventSource=window.EventSource;
let nativeFetch: ReturnType<typeof vi.fn>;
afterEach(()=>{window.fetch=originalFetch;window.EventSource=originalEventSource;window.history.replaceState({},'', '/');vi.resetModules();});

describe('FG native response contracts',()=>{
  async function scopedFetch(response:Response){
    window.history.replaceState({},'', '/advertising-app/14d736b1-3077-4f96-a0fb-dfa8272d4b5e');
    nativeFetch=vi.fn().mockResolvedValue(response);
    window.fetch=nativeFetch;
    window.EventSource=class {} as unknown as typeof EventSource;
    const {installFGScope}=await import('./fg-scope');
    installFGScope();
    return window.fetch('/api/v2/projects/extra',{method:'DELETE'});
  }
  it.each([204,205,304])('preserves an empty %i response with a JSON content type',async status=>{
    const response=new Response(null,{status,headers:{'content-type':'application/json'}});
    expect(await scopedFetch(response)).toBe(response);
  });
  it('continues rewriting NAS asset paths in actual JSON bodies',async()=>{
    const result=await scopedFetch(new Response(JSON.stringify({url:'/media/example.png'}),{headers:{'content-type':'application/json'}}));
    expect(await result.json()).toEqual({url:'/adcraft-api/14d736b1-3077-4f96-a0fb-dfa8272d4b5e/media/example.png'});
  });
  it('routes company APIs and lease events through the public workspace namespace',async()=>{
    await scopedFetch(new Response(null,{status:204}));
    const {fgURL}=await import('./fg-scope');
    expect(fgURL('/api/fg/editor/watch?key=ad%3A1')).toBe('/fg-six/api/fg/editor/watch?key=ad%3A1');
    expect(fgURL('/api/fg-company-assets?pageSize=100')).toBe('/fg-six/api/fg-company-assets?pageSize=100');
    expect(fgURL('/api/fgother')).toBe('/api/fgother');
  });
  it('keeps the editor credential attached to company asset imports after routing',async()=>{
    await scopedFetch(new Response(null,{status:204}));
    const {setFGEditorToken}=await import('./fg-scope');
    setFGEditorToken('test-editor-lease');
    await window.fetch('/api/fg/advertising/14d736b1-3077-4f96-a0fb-dfa8272d4b5e/company-asset',{method:'POST'});
    const [url,init]=nativeFetch.mock.calls.at(-1)!;
    expect(url).toBe('/fg-six/api/fg/advertising/14d736b1-3077-4f96-a0fb-dfa8272d4b5e/company-asset');
    expect(init.headers.get('X-FG-Editor-Key')).toBe('ad:14d736b1-3077-4f96-a0fb-dfa8272d4b5e');
    expect(init.headers.get('X-FG-Editor-Token')).toBe('test-editor-lease');
  });
});
