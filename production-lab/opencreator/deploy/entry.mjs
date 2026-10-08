import http from 'node:http';
import {spawn,execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import {pipeline} from 'node:stream';
import {trashRoute} from './fg-trash.mjs';
import {companyMediaFetch} from './company-media.mjs';
import {managedTextDefault} from './company-config.mjs';

const capability=process.env.FG_CREATOR_CAPABILITY;
const actor=process.env.FG_CREATOR_ACTOR;
if(!capability||!/^[0-9a-f-]{36}$/.test(actor||''))throw Error('FG creator identity missing');
globalThis.fetch=companyMediaFetch(globalThis.fetch,`http://fg-gateway:3010/internal/creator/${actor}`,capability);
await fs.access('/workspace/.fg-creator-ready');
await fs.mkdir('/state/codex',{recursive:true});
// Company packages are namespaced; personal skills in this private volume remain intact.
try{
 const marker=await fs.readFile('/opt/fg-skills/version','utf8');
 const installed=await fs.readFile('/state/codex/fg-skills-version','utf8').catch(()=>null);
 if(installed!==marker){
  await fs.mkdir('/state/codex/skills',{recursive:true});
  for(const item of await fs.readdir('/opt/fg-skills',{withFileTypes:true}))if(item.isDirectory()&&item.name.startsWith('fg-'))await fs.cp('/opt/fg-skills/'+item.name,'/state/codex/skills/'+item.name,{recursive:true});
  await fs.writeFile('/state/codex/fg-skills-version',marker);
 }
}catch(error){if(error.code!=='ENOENT')throw error;}
await fs.mkdir('/state/opencreator',{recursive:true});
await fs.mkdir('/state/catalog-seed',{recursive:true});
const bundled=JSON.parse(execFileSync('/usr/local/bin/codex',['debug','models'],{env:{...process.env,CODEX_HOME:'/state/catalog-seed'},encoding:'utf8',stdio:['ignore','pipe','ignore'],maxBuffer:16<<20}));
const template=bundled.models.find(m=>m.slug==='gpt-5.4');if(!template)throw Error('Creator tool protocol template missing');
let catalog;
for(let attempt=0;attempt<60;attempt++){
 try{const response=await fetch(`http://fg-gateway:3010/internal/creator/${actor}/models`,{headers:{authorization:'Bearer '+capability},signal:AbortSignal.timeout(3000)});if(response.ok){catalog=await response.json();break;}}catch{}
 await new Promise(resolve=>setTimeout(resolve,1000));
}
if(!catalog?.models?.length)throw Error('Company model catalog unavailable');
// Company model IDs retain their actual billing names. Explicit function-tool
// metadata avoids the Codex code-mode default for newer, unrecognised names.
await fs.writeFile('/state/codex/models.json',JSON.stringify({models:catalog.models.map(m=>({...template,slug:m.id,display_name:m.name,supports_search_tool:false,tool_mode:null}))}));
// The only model credential in this isolated container authorises this FG user.
// No provider account key, platform cookie, host home or Docker socket is mounted.
const {createDefaultCreatorServicesConfig}=await import('/app/packages/protocol/dist/index.js');
const {readOpenCreatorConfig,updateOpenCreatorConfig}=await import('/app/packages/config/dist/index.js');
// The native config package normalizes legacy camelCase and canonical snake_case
// TOML keys. Writing raw camelCase left an older creator_services table active.
const document=readOpenCreatorConfig('/state/opencreator/config.toml').document;
const defaultsMarker='/state/opencreator/fg-defaults-v1212';
let initialized=false;
try{await fs.access(defaultsMarker);initialized=true;}catch(error){if(error.code!=='ENOENT')throw error;}
const textModel=managedTextDefault(document,catalog,initialized);
const config=`model = "${textModel}"\nmodel_provider = "fg"\nmodel_catalog_json = "/state/codex/models.json"\nweb_search = "disabled"\n[features]\nmulti_agent = false\nmulti_agent_v1 = false\n[model_providers.fg]\nname = "FG WeToken"\nbase_url = "http://fg-gateway:3010/internal/creator/${actor}/v1"\nenv_key = "FG_CREATOR_CAPABILITY"\nwire_api = "responses"\nrequires_openai_auth = false\nsupports_websockets = false\n`;
await fs.writeFile('/state/codex/config.toml',config,{mode:0o600});
const services={...createDefaultCreatorServicesConfig(),...document.creatorServices};
// Docker is the external boundary: only this user's NAS directory and private
// state volume are mounted, all Linux capabilities and privilege escalation
// are disabled. Nested bubblewrap namespaces are unavailable in Docker.
document.ui={...document.ui,language:!document.ui?.language||document.ui.language==='system'?'zh-CN':document.ui.language,defaultPermission:'danger-full-access'};
services.llm={baseUrl:`http://fg-gateway:3010/internal/creator/${actor}/v1`,apiKey:'',model:textModel,source:'custom',jsonMode:false};
services.image={...services.image,provider:'openai',openai:{baseUrl:services.llm.baseUrl,apiKey:'',model:catalog.allModels?.some(m=>m.capability==='image'&&m.billingId===services.image?.openai?.model)?services.image.openai.model:'gpt-image-2'}};
services.video={...services.video,provider:'seedance',seedance:{baseUrl:services.llm.baseUrl,apiKey:'',model:catalog.allModels?.some(m=>m.capability==='video'&&m.billingId===services.video?.seedance?.model)?services.video.seedance.model:'doubao-seedance-2-0-fast-filter-off'}};
if(catalog.allModels?.some(m=>m.billingId==='seed-tts-2.0')){
 const audioModel=catalog.allModels.some(m=>m.capability==='audio'&&m.billingId===services.tts?.openai?.model)?services.tts.openai.model:'seed-tts-2.0';
 services.tts={...services.tts,provider:'openai',openai:{baseUrl:services.llm.baseUrl,apiKey:'',model:audioModel,defaultVoiceId:audioModel==='seed-audio-1.0'?'prompt':services.tts?.openai?.defaultVoiceId||'zh_female_gaolengyujie_uranus_bigtts'}};
 services.transcription={...services.transcription,provider:'openai',openai:{baseUrl:services.llm.baseUrl,apiKey:'',model:'volc.seedasr.auc'}};
}
updateOpenCreatorConfig('/state/opencreator/config.toml',()=>({...document,creatorServices:services}));
await fs.chmod('/state/opencreator/config.toml',0o600);
await fs.writeFile(defaultsMarker,'v1\n',{mode:0o600});
let credentials={version:1};
try{credentials=JSON.parse(await fs.readFile('/state/opencreator/credentials.json','utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
credentials.creatorServices={...credentials.creatorServices,'llm.apiKey':capability,'image.openai.apiKey':capability,'video.seedance.apiKey':capability};
if(catalog.allModels?.some(m=>m.billingId==='seed-tts-2.0'))Object.assign(credentials.creatorServices,{'tts.openai.apiKey':capability,'transcription.openai.apiKey':capability});
await fs.writeFile('/state/opencreator/credentials.json',JSON.stringify(credentials),{mode:0o600});
let connection;
// PIDs are reused when an isolated container is recreated. An old lock PID
// may now identify the new bootstrap process rather than an old daemon.
const lock='/state/opencreator/data/opencreator-runtime.lock';
try{
 const pid=Number((await fs.readFile(lock,'utf8')).trim());
 let command='';
 if(Number.isInteger(pid)&&pid>0)try{command=await fs.readFile(`/proc/${pid}/cmdline`,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
 if(command.includes('apps/daemon/dist/main.js'))throw Error('An existing creator daemon owns the private state');
 await fs.unlink(lock);
}catch(error){if(error.code!=='ENOENT')throw error;}
const child=spawn(process.execPath,['--import','/app/company-media-preload.mjs','apps/daemon/dist/main.js'],{cwd:'/app',env:process.env,stdio:['ignore','pipe','pipe']});
let buffer='';
child.stdout.on('data',chunk=>{buffer=(buffer+chunk).slice(-1048576);let index;while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);try{const parsed=JSON.parse(line);if(parsed.address&&parsed.token)connection=parsed;else if(parsed.type==='opencreator_daemon_bootstrap_error')console.error('Creator bootstrap failed',/^[A-Z_]+$/.test(parsed.code||'')?parsed.code:'UNKNOWN');}catch{}}});
// Upstream output may contain provider URLs or prompts. Keep runtime logs private.
child.stderr.on('data',()=>{});
child.on('exit',code=>process.exit(code||1));
http.createServer(async(req,res)=>{
 // Status/configuration reads use the private state volume and remain available
 // during a stale SMB bind, so host recovery can detect idle runtimes safely.
 const stateRead=req.method==='GET'&&['/runs','/creator-services/config'].includes(req.url?.split('?')[0]);
 if(!stateRead)try{if((await fs.readFile('/workspace/.fg-creator-ready','utf8')).trim()!=='FG private creator workspace')throw Error('NAS marker mismatch');}catch{res.writeHead(503);res.end('NAS unavailable');return;}
 if(req.url==='/healthz'){res.writeHead(connection?200:503,{'content-type':'application/json'});res.end(JSON.stringify({ok:!!connection}));return;}
 if(req.headers['x-fg-runtime']!==capability){res.writeHead(403);res.end('Forbidden');return;}
 if(!connection){res.writeHead(503);res.end('Creator starting');return;}
 try{if(await trashRoute(req,res,connection))return;}catch{res.writeHead(503);res.end('Creator cleanup unavailable');return;}
 const headers={...req.headers,authorization:'Bearer '+connection.token};for(const k of ['host','origin','referer','cookie','x-fg-runtime'])delete headers[k];
 const upstream=http.request(new URL(req.url,connection.address),{method:req.method,headers},remote=>{res.writeHead(remote.statusCode||502,remote.headers);pipeline(remote,res,()=>{});});
 upstream.on('error',()=>{if(!res.headersSent){res.writeHead(503);res.end('Creator unavailable');}else res.destroy();});
 req.on('aborted',()=>upstream.destroy());res.on('close',()=>{if(!res.writableEnded)upstream.destroy();});pipeline(req,upstream,()=>{});
}).listen(8060,'0.0.0.0');
process.on('SIGTERM',()=>child.kill('SIGTERM'));
