import test from 'node:test';import assert from 'node:assert/strict';import {estimateUSD,estimateCNY} from './fg-prices.mjs';
test('Seedance final usage includes minimum billable tokens and source video rate',()=>{
 const p={enabled:true,discount:.85,pricing_rules:{rules:[{resolution:'480p/720p',scenario:'with_video_input',price:6.4},{resolution:'480p/720p',scenario:'without_video_input',price:10.7}]}};
 const c={model:'dreamina-seedance-2-5-filter-off',capability:'video',status:'succeeded',task_status:'succeeded',usage_available:true,output_tokens:77260,request_body:'{"resolution":"480p","content":[{"type":"video_url"}]}'};
 assert.ok(Math.abs(estimateUSD(c,p)-.4202944)<1e-10);
 assert.ok(Math.abs(estimateCNY(c,p,6.77)-.420295*6.77)<1e-10);
 assert.equal(estimateUSD({...c,task_status:'failed'},p),null);
 assert.equal(estimateUSD({...c,request_body:'{"resolution":"1080p"}'},p),null);
});
test('use real token threshold tiers before generic price rules',()=>{
    const price={enabled:true,discount:1,tiered_pricing:[{max_input_tokens:200000,max_output_tokens:-1,input_price_per_m:4,output_price_per_m:20,cached_price_per_m:.4},{max_input_tokens:-1,max_output_tokens:-1,input_price_per_m:8,output_price_per_m:30,cached_price_per_m:.8}],pricing_rules:{currency:'USD',input_price:5,output_price:30}};
    const call={capability:'text',status:'succeeded',usage_available:true,input_tokens:1000,output_tokens:100,cached_tokens:500};
    assert.equal(estimateUSD(call,price),.0042);
    assert.equal(estimateUSD({...call,usage_available:false},price),null);
    assert.equal(estimateUSD({...call,status:'failed'},price),null);
});
test('unknown cache or image modality is never estimated as free',()=>{
    assert.equal(estimateUSD({capability:'text',status:'succeeded',usage_available:true,input_tokens:100,cached_tokens:10,output_tokens:10},{enabled:true,discount:1,pricing_rules:{currency:'USD',input_price:2,output_price:10}}),null);
    assert.equal(estimateUSD({capability:'image',status:'succeeded',media_count:1},{enabled:true,discount:.8,quota_type:0}),null);
});
test('video price requires known resolution and measured duration',()=>{
    const price={enabled:true,discount:.45,pricing_rules:{type:'per_second',currency:'USD',rules:[{resolution:'720P',price:.14}]}};
    const call={capability:'video',status:'succeeded',video_seconds:5,request_body:'{"parameters":{"resolution":"720p"}}'};
    assert.ok(Math.abs(estimateUSD(call,price)-.315)<1e-12);
    assert.equal(estimateUSD({...call,request_body:'{}'},price),null);
});
test('conflicting provider per-call and per-second rules remain unknown',()=>{
    const call={capability:'video',status:'succeeded',video_seconds:5,request_body:'{"parameters":{"resolution":"720P"}}'};
    const price={enabled:true,discount:.45,billing_doc:{billing_unit:'per_call'},pricing_rules:{type:'per_second',currency:'USD',rules:[{resolution:'720P',price:.14}]}};
    assert.equal(estimateUSD(call,price),null);
    assert.ok(Math.abs(estimateUSD(call,{...price,billing_doc:{billing_unit:'per_second'}})-.315)<1e-12);
});
