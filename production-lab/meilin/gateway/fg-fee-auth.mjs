import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import fs from 'node:fs/promises';

export function feeAuthHeaders(session){
 if(!/^\d+$/.test(String(session?.userId)))throw Error('INVALID_SESSION');
 const headers={'New-API-User':String(session.userId),Accept:'application/json'};
 if(typeof session.accessToken==='string'&&/^[^\s\r\n]{10,4096}$/.test(session.accessToken))headers.Authorization='Bearer '+session.accessToken;
 else if(typeof session.cookie==='string'&&/^session=[^;\r\n]+$/.test(session.cookie))headers.Cookie=session.cookie;
 else throw Error('INVALID_SESSION');
 if(session.expiresAt>0&&session.expiresAt*1000<=Date.now())throw Error('SESSION_EXPIRED');
 return headers;
}
export function feeResponseError(response,body){
 if(response.status===401||response.status===403)return 'SESSION_EXPIRED';
 if(!response.ok)return 'PROVIDER_UNAVAILABLE';
 if(body?.success!==true)return /未登录|登录已过期|授权.*失效|invalid.*token|unauthori[sz]ed|session.*expired/i.test(String(body?.message||''))?'SESSION_EXPIRED':'PROVIDER_REJECTED';
 return null;
}
function key(secret){if(!secret||secret.length<24)throw Error('BILLING_SECRET_UNAVAILABLE');return createHash('sha256').update('fg-billing-authorization-v1\0'+secret).digest();}
export function sealFeeAuthorization(session,secret){
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(secret),iv);
 const encrypted=Buffer.concat([cipher.update(JSON.stringify(session),'utf8'),cipher.final()]);
 return {v:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:encrypted.toString('base64')};
}
export function openFeeAuthorization(value,secret){
 if(value?.v!==1)throw Error('INVALID_SESSION');
 const decipher=createDecipheriv('aes-256-gcm',key(secret),Buffer.from(value.iv,'base64'));
 decipher.setAuthTag(Buffer.from(value.tag,'base64'));
 return JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.data,'base64')),decipher.final()]).toString('utf8'));
}
export async function loadFeeAuthorization(pool,{file=process.env.WETOKEN_FEE_SESSION_FILE,secret=process.env.FG_BILLING_SECRET||process.env.FG_ADCRAFT_SECRET}={}){
 const stored=(await pool.query("SELECT value FROM fg_company_settings WHERE key='wetokenFeeAuthorization'")).rows[0]?.value;
 if(stored)return openFeeAuthorization(stored,secret);
 if(!file)throw Error('INVALID_SESSION');
 return JSON.parse(await fs.readFile(file,'utf8'));
}
