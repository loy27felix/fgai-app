import type { AppContext } from './app-context.ts';
import { createToolService } from './automation/service.ts';
import { TOOL_DEFINITIONS, DISCUSSION_TOOLS, isDiscussionToolCall } from './automation/contract.ts';
import { readBuiltinSkill } from './automation/skill.ts';
import { editorSelection } from './editor/timeline-selection.ts';
import { createAIPanel } from './ui/ai-panel-view.ts';
import { mountAISelection } from './ui/ai-selection.ts';
import { fgRequest, fgCloudReady } from './fg-bridge.ts';
import './ui/ai-panel.css';

type Message = {role:'system'|'user'|'assistant'|'tool';content:string;tool_call_id?:string}|{type:'function_call';call_id:string;name:string;arguments:string;thoughtSignature?:string};
type Reply = {content:string;toolCalls:Array<{id:string;function:{name:string;arguments:string};thoughtSignature?:string}>};
export function mountFGAI(ctx: AppContext) {
    const service = createToolService(ctx);
    const {panel, find, open} = createAIPanel(true);
    const scope = mountAISelection(ctx, panel, open);
    const status = (text:string) => { find('ai-status').textContent = text; };
    const skill=readBuiltinSkill();
    const skillText=document.createElement('textarea');skillText.readOnly=true;skillText.value=skill.instructions||'';skillText.setAttribute('aria-label','内置导演 Skill 正文');skillText.style.cssText='width:100%;min-height:300px';
    panel.querySelector('#ai-skills')!.append(skillText);
    for (const id of ['ai-settings-toggle','ai-mcp-toggle']) find(id).hidden = true;
    find('ai-channel').setAttribute('aria-label','导演助手模型');
    find('ai-channel').closest('label')!.firstChild!.textContent = '模型';
    find('ai-scene-prompt').onclick = () => { void ctx.act('production-prompt', find('ai-scene-prompt')); };
    find('ai-changes').onclick = () => { open(false); void ctx.act('ai-changes-open', find('ai-changes')); };
    find('ai-undo').onclick = () => { void ctx.act('undo', find('ai-undo')).then(()=>ctx.saveProject()).catch(e=>status(e.message)); };
    const log = (text:string) => { const box=find<HTMLTextAreaElement>('ai-transcript');box.value+=text;box.scrollTop=box.scrollHeight; };
    let messages:Message[] = [], active=false, stopped=false, runId='';
    const setRunning = (value:boolean) => {
        active=value;panel.dataset.running=String(value);
        for (const id of ['ai-send','ai-new','ai-undo','ai-channel','ai-mode']) find(id).disabled=value;
        find('ai-stop').disabled=!value;
    };
    const price = document.createElement('span');
    price.className = 'ai-status';
    price.setAttribute('aria-label', '导演助手人民币价格');
    find('ai-channel').closest('label')!.append(price);
    const prices = new Map<string,string>();
    find('ai-channel').onchange = () => { price.textContent = prices.get(find('ai-channel').value) || '价格待确认'; };
    void fgRequest<Array<{id:string;name:string;price:string}>>('ai-models').then(models=>{
        models.forEach(model => prices.set(model.id, model.price));
        find('ai-channel').replaceChildren(...models.map(model=>new Option(model.name,model.id)));
        price.textContent = prices.get(find('ai-channel').value) || '价格待确认';
        status(models.length?'模型由 FG 管理 · 费用计入当前项目':'暂无可用文本模型');
    }).catch(e=>status(e.message));
    find('ai-new').onclick=()=>{messages=[];find('ai-transcript').value='';status('已新建对话，工程保持原状');};
    find('ai-stop').onclick=()=>{stopped=true;void fgRequest('ai-stop',{runId}).catch(e=>status(e.message));status('正在停止…');};
    const send=async()=>{
        if(active)return;
        if(!fgCloudReady){status('请等待原工程从 NAS 完成载入');return;}
        const prompt=find('ai-prompt').value.trim(),modelId=find('ai-channel').value;
        if(!prompt||!modelId)return;
        runId=crypto.randomUUID();stopped=false;setRunning(true);
        const selected=scope.useSelection()?editorSelection(ctx.project,ctx.selected):null;
        const mode=find('ai-mode').value;
        const definitions=mode==='discuss'?DISCUSSION_TOOLS:TOOL_DEFINITIONS;
        try{
            if(selected&&!selected.entityIds.length&&!selected.timeRange)throw Error('请先选中人物、片段或时间范围');
            const snapshot=await service.call('director_read',{sections:['entities','selection']});
            const context=`当前场景快照：${JSON.stringify(snapshot)}\n${selected?'本次仅修改以下选区，保留范围之外的安排：'+JSON.stringify(selected):'本次范围为当前戏段。'}`;
            if(!messages.length)messages.push({role:'system',content:'你是 FG 3D 导演助手。用中文与用户沟通，使用真实工具读取并编辑当前工程。先读取必要详情，不猜测工具字段，必要时调用 director_help。每批编辑使用最新 revision 和唯一 requestId。讨论模式不能修改工程。不要导出或生成付费媒体，除非用户明确要求。\n'+readBuiltinSkill().instructions});
            messages.push({role:'user',content:prompt+'\n'+context});log('\n你：'+prompt+'\n');find('ai-prompt').value='';
            for(let round=0;round<16&&!stopped;round++){
                status(`正在处理 · ${round+1}/16`);
                const reply=await fgRequest<Reply>('ai-round',{runId,modelId,prompt,messages,tools:definitions.map(t=>({type:'function',function:{name:t.name,description:t.description,parameters:t.inputSchema}}))});
                if(stopped)break;
                if(reply.content){messages.push({role:'assistant',content:reply.content});log('FG：'+reply.content+'\n');}
                if(!reply.toolCalls.length){status('已完成 · 工程已保存到 NAS');break;}
                for(const call of reply.toolCalls){
                    if(stopped)break;
                    let result:unknown;
                    try{
                        const args=JSON.parse(call.function.arguments);
                        if(!definitions.some(t=>t.name===call.function.name))throw Error('当前模式不允许此工具');
                        if(mode==='discuss'&&!isDiscussionToolCall(call.function.name,args))throw Error('讨论模式不能修改工程');
                        // Reuse the upstream selection semantics: clips and a time-only range
                        // describe the editing intent, rather than blocking all timeline edits.
                        // Entity-only selections can additionally reject unrelated writes.
                        if(selected?.scope==='entities'&&!isDiscussionToolCall(call.function.name,args)){
                            if(call.function.name!=='director_apply'||!Array.isArray(args.operations))throw Error('请用 director_apply 编辑所选对象；全场操作需要取消选中范围');
                            if(args.operations.some((op:{id?:string})=>!op.id||!selected.entityIds.includes(op.id)))throw Error('该操作超出所选对象范围');
                        }
                        result=await service.call(call.function.name,args);
                        if((result as {ok:boolean}).ok&&!isDiscussionToolCall(call.function.name,args)&&!await ctx.saveProject())throw Error('修改尚未保存到 NAS，请点击保存重试');
                    }catch(e){result={ok:false,error:e instanceof Error?e.message:'工具执行失败'};}
                    messages.push({type:'function_call',call_id:call.id,name:call.function.name,arguments:call.function.arguments,...(call.thoughtSignature?{thoughtSignature:call.thoughtSignature}:{})},{role:'tool',tool_call_id:call.id,content:JSON.stringify(result)});
                    log(`工具 ${call.function.name}：${(result as {ok:boolean;error?:string}).ok?'完成':(result as {error?:string}).error||'完成'}\n`);
                }
                if(round===15)status('已达到本轮操作上限，可继续发送要求');
            }
            if(stopped)status('已停止，已完成的修改已保留');
        }catch(e){void fgRequest('ai-stop',{runId}).catch(()=>undefined);status(e instanceof Error?e.message:'导演助手请求失败');log('提示：'+(e instanceof Error?e.message:'请求失败')+'\n');}
        finally{scope.endTask();setRunning(false);}
    };
    find('ai-send').onclick=()=>void send();
    find('ai-prompt').onkeydown=e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)&&!e.isComposing){e.preventDefault();void send();}};
    find('ai-send').title='发送任务 · Ctrl/Cmd+Enter；回车换行';
}
