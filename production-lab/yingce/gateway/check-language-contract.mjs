import fs from 'node:fs';
import assert from 'node:assert/strict';
// Both service images have independent Docker build contexts. Keep the web's
// vendored pure contract byte-equivalent to the gateway's canonical contract.
export function checkLanguageContract(){
 const root=new URL('../canvas/web/src/lib/',import.meta.url);
 if(!fs.existsSync(root))return; // Gateway-only Docker context has no frontend.
 for(const [source,target] of [['project-language.mjs','project-language-contract.mjs'],['project-language.d.mts','project-language-contract.d.mts']]){
  const normalize=value=>value.replace(/\r\n/g,'\n').trimEnd();
  assert.equal(normalize(fs.readFileSync(new URL('./shared/'+source,import.meta.url),'utf8')),normalize(fs.readFileSync(new URL(target,root),'utf8')),'Web and gateway language contracts must be synchronized');
 }
}
checkLanguageContract();
