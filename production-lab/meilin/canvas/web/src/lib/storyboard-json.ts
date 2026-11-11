/** Recover controls inside strings and trailing commas only. Never finish a row. */
export function parseStoryboardJSON(raw:string): unknown {
 const start=raw.indexOf("{"),end=raw.lastIndexOf("}");
 const text=start>=0&&end>start?raw.slice(start,end+1):raw;
 try{return JSON.parse(text);}catch{}
 let result="",quoted=false,escaped=false;
 for(let i=0;i<text.length;i++){
  const char=text[i];
  if(quoted){
   if(escaped){result+=char;escaped=false;continue;}
   if(char==='\\'){result+=char;escaped=true;continue;}
   if(char==='"')quoted=false;
   result+=char.charCodeAt(0)<32?JSON.stringify(char).slice(1,-1):char;
  }else{
   if(char==='"')quoted=true;
   if(char===','&&/^\s*[}\]]/.test(text.slice(i+1)))continue;
   result+=char;
  }
 }
 return JSON.parse(result);
}
