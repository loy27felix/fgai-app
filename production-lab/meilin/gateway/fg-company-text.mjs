export const COMPANY_TEXT_CHANNEL='Trings · 个人 GPT';
export const COMPANY_TEXT_MODEL='gpt-6.1-sol';
export const companyTextSpec={id:COMPANY_TEXT_MODEL,capability:'text',protocol:'openai'};
export const companyTextPrice={enabled:true,provider:'trings-personal',billingMode:'personal-key',discount:1,quota_type:0,tiered_pricing:[{max_input_tokens:-1,max_output_tokens:-1,input_price_per_m:0,output_price_per_m:0,cached_price_per_m:0}]};
export const isCompanyText=(model,snapshot)=>model===COMPANY_TEXT_MODEL&&snapshot?.enabled===true&&snapshot.provider==='trings-personal'&&snapshot.billingMode==='personal-key';
