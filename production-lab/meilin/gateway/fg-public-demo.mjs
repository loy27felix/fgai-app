export const publicDemoEmail='test@beva.com';
export const isPublicDemo=actor=>String(actor?.email||'').toLowerCase()===publicDemoEmail;

export function publicDemoDenied(path,method='GET'){
 const p=path.pathname;
 // Company catalogues and integrations are not part of the public sandbox.
 if(p.startsWith('/api/fg/')&&!['/api/fg/models/quote','/api/fg/models/prices','/api/fg/budgets/users'].includes(p)&&!p.startsWith('/api/fg/inspiration')&&!p.startsWith('/api/fg/meilin/'))return true;
 if(/^\/api\/(fg-company-assets|admin|share)(\/|$)/.test(p)||p.startsWith('/share/'))return true;
 if(p.startsWith('/api/settings/')&&method!=='GET')return true;
 if(p==='/api/ai/models')return true;
 if(p.includes('/share')||p.startsWith('/api/fg-meilin/share'))return true;
 if(p.startsWith('/api/creator')||p.startsWith('/creator-app')||p.startsWith('/arcreel')||p.startsWith('/advertising-app')||p.startsWith('/adcraft-api'))return true;
 return false;
}
