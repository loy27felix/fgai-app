import {createHash} from 'node:crypto';

const upstream='https://raw.githubusercontent.com/ddcat-ai/open-ai-canvas/main/web/public/inspirations/';
export const catalogSources=[
 {id:'catalog-seedance',name:'awesome-seedance · CC BY 4.0',kind:'video',format:'catalog',url:upstream+'seedance.json',homepage:'https://github.com/LearnPrompt/awesome-seedance',license:'CC BY 4.0'},
 {id:'catalog-haohaoxue',name:'好好学 AI · 公开提示词',kind:'image',format:'catalog',url:upstream+'haohaoxue.json',homepage:'https://www.haohaoxue.com/prompts/',license:'站点公开数据'},
 {id:'catalog-youmind',name:'YouMind · CC BY 4.0',kind:'image',format:'catalog',url:upstream+'youmind.json',homepage:'https://github.com/YouMind-OpenLab/awesome-nano-banana-pro-prompts',license:'CC BY 4.0'},
];
export function safeInspirationURL(value){
 try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port?u.href:'';}catch{return '';}
}
export function catalogCoverURL(value){
 if(typeof value==='string'&&/^\/inspiration-thumbs\/[a-zA-Z0-9_./-]+\.(webp|png|jpe?g|avif)$/.test(value)&&!value.includes('..'))return 'https://raw.githubusercontent.com/ddcat-ai/open-ai-canvas/main/web/public'+value;
 return safeInspirationURL(value);
}
export function normalizeCatalog(data,source){
 if(!Array.isArray(data?.entries))throw Error('来源目录格式无效');
 return data.entries.slice(0,4000).map(e=>({
  id:createHash('sha256').update(source.id+'\0'+String(e.id||e.title)).digest('hex').slice(0,24),
  title:String(e.title||'').slice(0,240),prompt:String(e.prompt||'').slice(0,60000),promptZh:String(e.promptZh||'').slice(0,60000),description:String(e.description||'').slice(0,2000),
  kind:e.mode==='video'?'video':e.mode==='text'?'text':'image',cover:catalogCoverURL(e.image),media:catalogCoverURL(e.image)?[{kind:'image',url:catalogCoverURL(e.image)}]:[],playable:false,
  tags:Array.isArray(e.tags)?e.tags.slice(0,24).map(x=>String(x).slice(0,80)):[],category:String(e.category||'').slice(0,100),categoryName:String(data.categories?.[e.category]||e.category||'').slice(0,100),
  author:String(e.credit||'').slice(0,120),sourceId:source.id,sourceName:source.name,sourceUrl:safeInspirationURL(e.sourceUrl)||source.homepage,license:source.license,
  model:source.kind==='video'?'Seedance':/gpt.image.2/i.test(e.sourceUrl||'')?'GPT Image 2':source.id==='catalog-youmind'?'Nano Banana Pro':'公开提示词',updatedAt:String(data.revision||'')
 })).filter(e=>e.title&&e.prompt);
}
