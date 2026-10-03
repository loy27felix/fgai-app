import {afterEach,describe,expect,it,vi} from 'vitest';

const originalFetch=window.fetch;
const originalEventSource=window.EventSource;
afterEach(()=>{window.fetch=originalFetch;window.EventSource=originalEventSource;window.history.replaceState({},'', '/');vi.resetModules();});

describe('FG native response contracts',()=>{
  async function scopedFetch(response:Response){
    window.history.replaceState({},'', '/advertising-app/14d736b1-3077-4f96-a0fb-dfa8272d4b5e');
    window.fetch=vi.fn().mockResolvedValue(response);
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
});
