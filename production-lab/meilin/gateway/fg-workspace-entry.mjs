// Runs in the outer document. Store only a relative workspace route, scoped to
// this authenticated FG user. Hash state survives refresh without nginx rewrites.
export function installWorkspaceEntry(actorId){
 const frame=document.querySelector('iframe');
 const base=new URL(frame.dataset.entry,location.origin);
 const storageKey='fg-workspace-route:'+actorId;
 const valid=route=>typeof route==='string'&&route.length<=8192&&/^\/(?!\/)/.test(route)&&!/[\\\u0000-\u001f]/.test(route)&&!/%(?:2e|2f|5c|0[0-9a-f]|1[0-9a-f])/i.test(route)&&!/(?:^|\/)\.{1,2}(?:[/?#]|$)/.test(route)&&!/^\/(?:api|login|register|forgot-password)(?:[/?#]|$)/.test(route);
 const stored=()=>{try{return sessionStorage.getItem(storageKey);}catch{return null;}};
 const fromHash=()=>{try{return location.hash.startsWith('#workspace=')?decodeURIComponent(location.hash.slice(11)):null;}catch{return null;}};
 const href=route=>base.href.replace(/\/$/,'')+(valid(route)?route:'/');
 // A bare workbench link is an explicit return home. Only a true reload may
 // fall back to this user's last route when the URL has no workspace state.
 const isReload=performance.getEntriesByType('navigation')[0]?.type==='reload';
 let desired=fromHash()||(isReload?stored():null)||'/';if(!valid(desired))desired='/';
 frame.src=href(desired);
 addEventListener('message',event=>{
  if(event.source!==frame.contentWindow||event.origin!==base.origin||event.data?.type!=='fg-workspace-location'||!valid(event.data.route))return;
  const route=event.data.route;
  try{sessionStorage.setItem(storageKey,route);}catch{ /* URL still persists when storage is disabled. */ }
  const hash='#workspace='+encodeURIComponent(route);
  if(location.hash!==hash)history.replaceState(null,'',location.pathname+location.search+hash);
 });
 // The director's _top link can clear the hash without reloading this outer
 // document. Treat that same-document navigation as a return home too.
 addEventListener('hashchange',()=>{const route=fromHash()||'/';if(valid(route))frame.src=href(route);});
}
export function workspaceEntryDocument(entryURL,actorId,workspaceOrigin){
 const attr=value=>String(value).replace(/[&"<>]/g,c=>({'&':'&amp;','"':'&quot;','<':'&lt;','>':'&gt;'}[c]));
 return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FG Studio · 制作工作区</title><style>html,body{margin:0;height:100%;overflow:hidden;background:#101114}iframe{display:block;width:100%;height:100dvh;border:0}</style></head><body><iframe name="fg-canvas-workspace" title="FG 制作工作区" data-entry="${attr(entryURL)}" allow="clipboard-read; clipboard-write; fullscreen; microphone ${attr(workspaceOrigin)}" allowfullscreen></iframe><script>(${installWorkspaceEntry.toString()})(${JSON.stringify(actorId).replace(/</g,'\\u003c')})</script></body></html>`;
}
