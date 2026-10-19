// Only structured provider codes may override an authentication-looking 403.
// Never expose diagnostic response bodies, which can echo credentials or input.
export function meilinQuotaError(log) {
 if(!log||![402,403,429].includes(Number(log.status_code)))return null;
 let body;try{body=JSON.parse(log.response_body);}catch{return null;}
 const code=body?.error?.code??body?.code;
 if(typeof code!=='string'||!['insufficient_user_quota','insufficient_quota','quota_not_enough','quota_exceeded'].includes(code.toLowerCase()))return null;
 return '模型服务额度不足，请检查当前渠道余额或配额；补足后可重新尝试';
}
