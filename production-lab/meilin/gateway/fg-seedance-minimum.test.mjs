import test from 'node:test';import assert from 'node:assert/strict';
import {minimumVideoTokens} from './fg-seedance-minimum.mjs';
import {priceQuote} from './fg-quotes.mjs';
test('official 2.0 / 2.5 reference-video floors cover ratios and duration bounds',()=>{
 assert.equal(minimumVideoTokens('doubao-seedance-2-0-fast-filter-off','480p','16:9',4).tokens,70308);
 assert.equal(minimumVideoTokens('dreamina-seedance-2-5-filter-off','720p','9:16',30).tokens,1080000);
 assert.equal(minimumVideoTokens('dreamina-seedance-2-5-filter-off','1080p','16:9',30).tokens,2430000);
 assert.equal(minimumVideoTokens('doubao-seedance-2-0-filter-off','720p','16:9',16),null);
});
test('short reference source uses floor, long source uses larger formula',()=>{
 const price={enabled:true,discount:.85,pricing_rules:{rules:[{scenario:'with_video_input',resolution:'720p',price:6}]}};
 const make=referenceVideoSeconds=>priceQuote('dreamina-seedance-2-5-filter-off',price,{capability:'video',inputs:{video:1},options:{size:'16:9',vquality:'720p',videoSeconds:4,referenceVideoSeconds}},6.77);
 const short=make(2),long=make(30);
 assert.equal(short.estimatedCny,151200*6/1e6*.85*6.77);
 assert.ok(long.estimatedCny>short.estimatedCny);
 assert.ok(short.notes.some(note=>note.includes('151,200')));
});
