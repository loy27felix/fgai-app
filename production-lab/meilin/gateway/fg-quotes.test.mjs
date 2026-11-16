import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {priceQuote} from './fg-quotes.mjs';
const specs=JSON.parse(fs.readFileSync(new URL('./model-specs.json',import.meta.url)));
const quote=(id,intent,d=.85)=>priceQuote(id,{...specs.find(s=>s.id===id).price,enabled:true,discount:d},intent,6.77);
test('Seedance video input changes rate and includes source duration; image does not',()=>{
 const opts={size:'16:9',vquality:'480p',videoSeconds:4};
 const no=quote('dreamina-seedance-2-0-mini-filter-off',{capability:'video',inputs:{image:1},options:opts});
 const ref=quote('dreamina-seedance-2-0-mini-filter-off',{capability:'video',inputs:{video:1},options:{...opts,referenceVideoSeconds:4.042}});
 assert.ok(no.estimatedCny>0&&ref.estimatedCny>no.estimatedCny);
 assert.ok(Math.abs(no.estimatedCny-40595*3.5/1e6*.85*6.77)<1e-12);
 assert.equal(ref.estimateKind,'estimate');
 assert.equal(quote('dreamina-seedance-2-0-mini-filter-off',{capability:'video',inputs:{image:1},options:{...opts,vquality:'480'}}).estimatedCny,no.estimatedCny);
 const unknown=quote('dreamina-seedance-2-0-mini-filter-off',{capability:'video',inputs:{video:1},options:opts});
 assert.ok(unknown.notes.some(x=>x.includes('累计上限 15 秒')));
});
test('Pro image pixel boundary, references and Lite account discount',()=>{
 const lower=quote('dola-seedream-5-0-pro-260628',{capability:'image',inputs:{image:2},options:{size:'1024x1024',count:1}},1);
 const higher=quote('dola-seedream-5-0-pro-260628',{capability:'image',inputs:{image:2},options:{size:'2048x2048',count:1}},1);
 assert.ok(Math.abs(lower.estimatedCny-.051*6.77)<1e-12);assert.ok(Math.abs(higher.estimatedCny-.096*6.77)<1e-12);
 assert.ok(Math.abs(quote('seedream-5-0-lite-260128',{capability:'image',options:{count:1}},.95).estimatedCny-.03325*6.77)<1e-12);
});
test('unknown discounts and unresolved provider units never produce zero prices',()=>{
 assert.equal(quote('wan3.0-video',{capability:'video',options:{}},null).estimatedCny,null);
 assert.equal(quote('wan3.0-video',{capability:'video',options:{}},null).discount,null);
 assert.equal(quote('happyhorse-1.1-t2v',{capability:'video',options:{vquality:'720P',videoSeconds:3}},.45).estimatedCny,null);
 const g=quote('gpt-image-2',{capability:'image',options:{size:'1024x1024'}});assert.equal(g.estimatedCny,null);assert.ok(g.lines.length);
});

test('Wan invoice discrepancy uses exact observed size, never public price as actual',()=>{
 const p={enabled:true,discount:.55,quota_type:1,model_price:.075,priceConflict:true,observedImagePrices:[{size:'1024x1024',usd:.20625,referenceId:'verified-task'}]};
 const known=priceQuote('wan2.7-image-pro',p,{capability:'image',options:{size:'1024x1024',count:1}},6.77);
 assert.ok(Math.abs(known.estimatedCny-.20625*6.77)<1e-12);
 assert.equal(priceQuote('wan2.7-image-pro',p,{capability:'image',options:{size:'2048x2048'}},6.77).estimatedCny,null);
});
