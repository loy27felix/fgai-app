import test from 'node:test';
import assert from 'node:assert/strict';
import {companyTextPrice,COMPANY_TEXT_MODEL,isCompanyText} from './fg-company-text.mjs';
import {admissionPrice} from './fg-budgets.mjs';
import {priceQuote} from './fg-quotes.mjs';
import {estimateCNY} from './fg-prices.mjs';
import {advertisingModels} from './fg-adcraft-models.mjs';
test('company subscription is a server-owned zero personal cost policy, including multimodal input',()=>{
  assert.equal(admissionPrice(COMPANY_TEXT_MODEL,'text',{messages:[{content:[{type:'image_url'}]}]},companyTextPrice,7),0);
  assert.equal(priceQuote(COMPANY_TEXT_MODEL,companyTextPrice,{capability:'text'},7).estimatedCny,0);
  assert.equal(estimateCNY({model:COMPANY_TEXT_MODEL,status:'succeeded'},companyTextPrice,7),0);
  assert.equal(isCompanyText('gpt-6-astra',companyTextPrice),false);
  assert.equal(isCompanyText(COMPANY_TEXT_MODEL,{...companyTextPrice,provider:'wetoken'}),false);
});
test('catalog retains GPT Image but removes WeToken GPT text and adds only Sol subscription',async()=>{
  const pool={query:async sql=>({rows:sql.includes('SELECT DISTINCT')?[
    {model:COMPANY_TEXT_MODEL,snapshot:companyTextPrice},{model:'gpt-6-astra',snapshot:{enabled:true}},{model:'gpt-image-2',snapshot:{enabled:true}}
  ]:[]})};
  const models=await advertisingModels(pool);
  assert.ok(models.some(m=>m.id===COMPANY_TEXT_MODEL));assert.ok(models.some(m=>m.id==='gpt-image-2'));assert.ok(!models.some(m=>m.id==='gpt-6-astra'));
});
