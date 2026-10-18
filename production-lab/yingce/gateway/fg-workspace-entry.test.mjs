import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {installWorkspaceEntry,workspaceEntryDocument} from './fg-workspace-entry.mjs';
function page({hash='',stored=null,user='member',entry='/fg-six/'}={}){
 const frame={dataset:{entry},contentWindow:{},src:''};const handlers={};const values=new Map(stored?[['fg-workspace-route:'+user,stored]]:[]);
 const location={origin:'https://fg.example',pathname:'/production-lab',search:'',hash};
 const context={document:{querySelector:()=>frame},URL,location,sessionStorage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)},history:{replaceState:(_,__,url)=>{location.hash=url.slice(url.indexOf('#'));}},addEventListener:(k,fn)=>handlers[k]=fn};
 vm.runInNewContext('('+installWorkspaceEntry.toString()+')('+JSON.stringify(user)+')',context);
 const report=(route,options={})=>handlers.message({source:frame.contentWindow,origin:'https://fg.example',data:{type:'fg-workspace-location',route},...options});
 return {frame,location,values,report,handlers};
}
test('refresh restores canvas, chapter, admin page and filters from outer URL',()=>{
 for(const route of ['/canvas/abc?node=video#preview','/projects/p?tab=chapters&chapter=c','/admin/users?tab=budgets','/fg-finance?month=2026-09']){
  const p=page();p.report(route);const refreshed=page({hash:p.location.hash});assert.equal(refreshed.frame.src,'https://fg.example/fg-six'+route);
 }
});
test('storage is scoped per user and hash wins over last route',()=>{
 assert.equal(page({stored:'/admin/users'}).frame.src,'https://fg.example/fg-six/admin/users');
 assert.equal(page({stored:'/admin/users',hash:'#workspace='+encodeURIComponent('/canvas/c')}).frame.src,'https://fg.example/fg-six/canvas/c');
 const p=page({user:'a'});p.report('/canvas/private');assert.ok(p.values.has('fg-workspace-route:a'));assert.ok(!p.values.has('fg-workspace-route:b'));
});
test('ignore foreign messages, APIs, script URLs, path escapes and malformed hashes',()=>{
 const p=page();const before=p.location.hash;
 for(const route of ['//evil.example/','https://evil.example','/api/admin/users','/login','/../api/admin','/%2e%2e/api/admin','/%2f%2fevil','/\\evil','/canvas\n/'])p.report(route);
 p.report('/admin/users',{origin:'https://evil.example'});p.report('/admin/users',{source:{}});assert.equal(p.location.hash,before);
 assert.equal(page({hash:'#workspace=%zz'}).frame.src,'https://fg.example/fg-six/');
 assert.equal(page({hash:'#workspace='+encodeURIComponent('//evil.example')}).frame.src,'https://fg.example/fg-six/');
 const html=workspaceEntryDocument('/fg-six/','</script><evil>','https://fg.example');assert.ok(!html.includes('</script><evil>'));assert.ok(html.includes('data-entry="/fg-six/"'));
});
