import fs from 'node:fs';
import {capabilities} from './fg-model-capabilities.mjs';

const specs=JSON.parse(fs.readFileSync(new URL('./model-specs.json',import.meta.url),'utf8'));
const aliases={'doubao-seedream-5-0-lite-260128':'seedream-5-0-lite-260128','doubao-seedance-2-0-fast-260128':'doubao-seedance-2-0-fast-filter-off'};
export const billingModel=id=>aliases[id]||id;
const nativeModel=id=>Object.keys(aliases).find(key=>aliases[key]===id)||id;
const names={
 'claude-opus-5-5-t3a':'Claude Opus 5.5','claude-sonnet-5-5-t3a':'Claude Sonnet 5.5','deepseek-v4-pro':'DeepSeek V4 Pro','gpt-6-astra':'GPT 6 Astra','gpt-5.6-sol-t1a':'GPT 5.6',
 'dola-seedream-5-0-pro-260628':'Seedream Pro','seedream-5-0-lite-260128':'Seedream Lite','gemini-3.1-flash-image-preview':'Gemini Flash Image','gemini-3-pro-image-preview':'Gemini Pro Image','gpt-image-2':'GPT Image 2','gpt-image-2.5-flare':'GPT Image Flare','gpt-image-2.5-sunburst':'GPT Image Sunburst','wan2.7-image-pro':'Wan 2.7 Image',
 'doubao-seedance-2-0-fast-filter-off':'SD2-fast','doubao-seedance-2-0-filter-off':'SD2','dreamina-seedance-2-0-mini-filter-off':'SD2-mini','dreamina-seedance-2-5-filter-off':'SD2.5','happyhorse-1.1-i2v':'HappyHorse 图生视频','happyhorse-1.1-r2v':'HappyHorse 参考生视频','happyhorse-1.1-t2v':'HappyHorse 文生视频','MiniMax-H3':'MiniMax H3','wan3.0-video':'Wan 3.0',
};
export async function advertisingModels(pool){
 const rows=(await pool.query(`SELECT DISTINCT p.model,p.snapshot FROM fg_model_prices p JOIN channel_models cm ON cm.model_key=p.model JOIN model_channels c ON c.id=cm.channel_id WHERE c.name LIKE 'WeToken%' AND c.enabled AND cm.enabled AND c.deleted_at IS NULL AND cm.deleted_at IS NULL`)).rows;
 return rows.flatMap(row=>{const spec=specs.find(s=>s.id===row.model);if(!spec||row.snapshot?.enabled!==true)return [];
  return [{id:nativeModel(spec.id),billingId:spec.id,name:(names[spec.id]||spec.id)+' · WeToken',capability:spec.capability,profile:capabilities({...spec,price:row.snapshot})}];
 });
}
export async function selectedAdvertisingModel(pool,mode,id){
 const selected=(await advertisingModels(pool)).find(m=>m.capability===mode&&billingModel(m.id)===billingModel(id));
 if(!selected)throw Error('FG 中未启用此模型或当前模型没有相应能力');return selected;
}
