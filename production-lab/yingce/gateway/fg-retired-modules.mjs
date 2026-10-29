export function retiredModulePath(path) {
 return /^\/(?:creator-app|creator-static|creator-presets|arcreel|fg-director)(?:\/|$)/.test(path)
  || /^\/api\/(?:creator|referral|admin\/referral|admin\/settings\/referral)(?:\/|$)/.test(path)
  || /^\/(?:referral|admin\/referral)(?:\/|$)/.test(path)
  || /^\/(?:wallet|admin\/(?:payments|credit-operations|redemption-codes))(?:\/|$)/.test(path)
  || /^\/api\/(?:payments|wallet|admin\/(?:payments|credit-operations|redemption-codes|credit-adjustments|redeem-batches|billing-orders))(?:\/|$)/.test(path)
  || /^\/api\/admin\/users\/[^/]+\/credits\/adjust\/?$/.test(path)
  || /^\/api\/admin\/settings\/credits(?:\/|$)/.test(path)
  || path.startsWith('/internal/arcreel/');
}

export function retiredModuleResponse(res) {
 res.writeHead(410, {'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
 res.end(JSON.stringify({code:410,data:null,msg:'此板块已下线，请返回 FG 工作台',reason:'FG_MODULE_RETIRED'}));
}
