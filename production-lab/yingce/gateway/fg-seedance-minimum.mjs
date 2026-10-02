import fs from 'node:fs';
export const seedanceMinimum=JSON.parse(fs.readFileSync(new URL('./seedance-minimum-tokens.json',import.meta.url),'utf8'));
export function minimumVideoTokens(model,resolution,ratio,seconds){
 const series=model==='dreamina-seedance-2-5-filter-off'?'25':'20';
 return seedanceMinimum.tables[series]?.[resolution]?.[ratio+'/'+seconds]||null;
}
