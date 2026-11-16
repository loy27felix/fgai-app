import test from 'node:test';import assert from 'node:assert/strict';import {extendObservedSeedPrices} from './fg-observed-seed-prices.mjs';
const snapshot=()=>({discount:.85,pricing_rules:{rules:[{resolution:'480P/720P',scenario:'without_video_input',price:10.7}]}});
test('infer only missing resolution from exact usage and positive receipt',()=>{
 const p=extendObservedSeedPrices(snapshot(),[{request_body:'{"resolution":"1080p","content":[]}',output_tokens:'196425',usage_available:true,usd:'1.953447',reference_id:'matched-1080'}]);
 assert.equal(p.pricing_rules.rules.length,2);assert.equal(p.pricing_rules.rules[1].price,11.7);assert.equal(p.pricing_rules.rules[1].priceOrigin,'matched_receipt_inference');
 assert.equal(p.pricing_rules.rules.filter(x=>x.scenario==='with_video_input').length,0);
});
test('zero fees and unknown usage cannot establish a unit price',()=>{
 const rows=[{request_body:'{"resolution":"1080p"}',output_tokens:196425,usage_available:true,usd:0},{request_body:'{"resolution":"1080p"}',output_tokens:196425,usage_available:false,usd:1.953447}];
 assert.equal(extendObservedSeedPrices(snapshot(),rows).pricing_rules.rules.length,1);
});
