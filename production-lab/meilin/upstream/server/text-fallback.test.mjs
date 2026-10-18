import {test} from 'node:test';
import assert from 'node:assert/strict';
import {definitiveGPTFallback} from './llm.mjs';
test('only an explicit GPT credential or exhausted supplier quota allows the Sonnet fallback',()=>{
 for(const value of ['insufficient_quota','个人 GPT 额度不足','请先在个人设置 → GPT 接入中填写自己的 Trings API URL 和 API Key'])assert.equal(definitiveGPTFallback(value),true,value);
 for(const value of ['fetch failed','等待上游响应超时','HTTP 429 rate limit','服务暂不可用','本月制作额度不足','monthly budget exceeded','用户预算余额不足'])assert.equal(definitiveGPTFallback(value),false,value);
});
