import { beforeEach, afterEach, expect, test } from 'bun:test';
import localforage from 'localforage';
import { deleteCloudAgentConversation, loadCloudAgentConversations, saveCloudAgentConversations, type CloudAgentConversation } from '@/services/cloud-agent-conversations';
const old = { get:localforage.getItem, set:localforage.setItem, remove:localforage.removeItem, keys:localforage.keys };
let data = new Map<string, unknown>();
let windowDescriptor: PropertyDescriptor | undefined;
let actor='history-delete-user';
const item=(id:string):CloudAgentConversation=>({id,title:id,messages:[{id:'prompt',role:'user',text:'test'}],run:null,permissionMode:'request_approval',createdAt:'2026-10-13',updatedAt:'2026-10-13'});
beforeEach(()=>{
    windowDescriptor=Object.getOwnPropertyDescriptor(globalThis,'window');
    data=new Map<string,unknown>();
    localforage.keys=async()=>[...data.keys()];
    localforage.getItem=(async(key:string)=>data.get(key)??null) as typeof old.get;
    localforage.setItem=(async(key:string,value:unknown)=>{data.set(key,value);return value;}) as typeof old.set;
    localforage.removeItem=async(key:string)=>{data.delete(key);};
    Object.defineProperty(globalThis,'window',{configurable:true,value:{localStorage:{getItem:()=>actor}}});
});
afterEach(()=>{
    localforage.getItem=old.get;localforage.setItem=old.set;localforage.removeItem=old.remove;localforage.keys=old.keys;
    actor='history-delete-user';
    if(windowDescriptor)Object.defineProperty(globalThis,'window',windowDescriptor);else delete(globalThis as {window?:unknown}).window;
});
test('deleted active history stays absent after reload and a delayed stale autosave',async()=>{
    const canvas='history-race',rows=[item('deleted'),item('kept')];
    await saveCloudAgentConversations('deleted',rows);
    await deleteCloudAgentConversation('deleted','deleted',rows);
    await saveCloudAgentConversations('deleted',rows);
    const doc=await loadCloudAgentConversations();
    expect(doc.activeId).toBeNull();expect(doc.conversations.map(row=>row.id)).toEqual(['kept']);
});
test('delete failure retains the original history and permits retry',async()=>{
    const canvas='history-failure',rows=[item('failure')];
    await saveCloudAgentConversations('failure',rows);
    const actual=localforage.setItem;
    localforage.setItem=async()=>{throw Error('disk unavailable');};
    await expect(deleteCloudAgentConversation('failure','failure',rows)).rejects.toThrow('disk unavailable');
    localforage.setItem=actual;
    expect((await loadCloudAgentConversations()).conversations).toHaveLength(1);
    await deleteCloudAgentConversation('failure','failure',rows);
    expect((await loadCloudAgentConversations()).conversations).toHaveLength(0);
});
test('global history deletion remains isolated by account',async()=>{
    await saveCloudAgentConversations('shared',[item('shared')]);
    actor='another-user';await saveCloudAgentConversations('shared',[item('shared')]);
    actor='history-delete-user';await deleteCloudAgentConversation('shared','shared',[item('shared')]);
    expect((await loadCloudAgentConversations()).conversations).toHaveLength(0);
    actor='another-user';expect((await loadCloudAgentConversations()).conversations).toHaveLength(1);
});

test('imports existing canvas conversations and preserves pending identities without crossing accounts',async()=>{
    const legacy='cloud-agent-conversations-v1:legacy-canvas';
    const original=JSON.stringify({version:1,activeId:'legacy',conversations:[item('legacy')]});
    data.set(`${legacy}:user:${actor}`,original);
    data.set(`${legacy}:user:another-user`,JSON.stringify({version:1,activeId:'private',conversations:[item('private')]}));
    const pending=JSON.stringify({fingerprint:'original',key:'stable-original-key'});
    data.set(`cloud-agent-conversations-v1:pending:legacy-canvas:legacy:user:${actor}`,pending);
    const result=await loadCloudAgentConversations();
    expect(result.conversations.map(row=>row.id)).toEqual(['legacy']);
    expect(data.get(`${legacy}:user:${actor}`)).toBe(original);
    expect(data.get(`cloud-agent-conversations-v2:pending:legacy:user:${actor}`)).toBe(pending);
    expect((await loadCloudAgentConversations()).conversations).toHaveLength(1);
});
