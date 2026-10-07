import {useEffect,useRef,useState} from 'react';
import {Button,Popover,Select} from 'antd';
import {BookOpen,Library} from 'lucide-react';
import {Link} from 'react-router';
import {canvasResourceMentionToken,type CanvasResourceReference} from '@/lib/canvas/canvas-resource-references';
import {buildSkillMentionReferences} from '@/services/skill-runtime';
import {fgSkillCatalog} from '@/services/fg-skill-catalog';
import type {Skill} from '@/services/api/skills';
import {fgImageStyle} from '@/services/fg-image-styles';
import './fg-controls.css';
export function FGSkillControl({references,prompt,onChange,disabled,capability}:{references:CanvasResourceReference[];prompt:string;onChange:(value:string)=>void;disabled?:boolean;capability?:string}){
 const [open,setOpen]=useState(false);
 const [catalog,setCatalog]=useState<Skill[]>([]);
 const [loading,setLoading]=useState(false);
 const [pending,setPending]=useState(false);
 const [error,setError]=useState('');
 const [category,setCategory]=useState('recommended');
 const promptRef=useRef(prompt);promptRef.current=prompt;
 const selecting=useRef(false);
 useEffect(()=>{
  if(!open)return;
  let cancelled=false;
  setLoading(true);setError('');
  void fgSkillCatalog.list().then(result=>{if(!cancelled)setCatalog(result);}).catch(cause=>{if(!cancelled)setError(cause instanceof Error?cause.message:'读取技能库失败');}).finally(()=>{if(!cancelled)setLoading(false);});
  return ()=>{cancelled=true;};
 },[open]);
 const skills=[...new Map([...references.filter(r=>r.kind==='skill'&&r.active&&r.skill),...buildSkillMentionReferences(catalog.map(skill=>({...skill,isAdded:true})))].map(r=>[r.id,r])).values()];
 const selected=skills.filter(r=>prompt.includes(canvasResourceMentionToken(r))||prompt.includes('@'+r.label));
 const filtered=skills.filter(r=>category==='all'||selected.includes(r)||(category==='recommended'?(capability==='image'?!!fgImageStyle(r.skill!.skillId)?.direct:capability==='video'?r.skill?.tag==='drama':true):r.skill?.tag===category));
 async function select(ids:string[]){
  if(selecting.current)return;
  selecting.current=true;setPending(true);setError('');
  try{
   const chosen=ids.map(id=>skills.find(r=>r.id===id)!).filter(Boolean);
   const activated=await fgSkillCatalog.activate(chosen.map(r=>r.skill!.skillId),catalog.length?catalog:skills.map(r=>r.skill!));
   setCatalog(current=>{const map=new Map(current.map(s=>[s.skillId,s]));for(const s of activated)map.set(s.skillId,s);return [...map.values()];});
   let next=promptRef.current;
   for(const r of skills)if(!ids.includes(r.id))next=next.split(canvasResourceMentionToken(r)).join('').split('@'+r.label).join('');
   for(const r of chosen)if(!next.includes(canvasResourceMentionToken(r))&&!next.includes('@'+r.label))next=canvasResourceMentionToken(r)+' '+next;
   onChange(next.trim());
  }catch(cause){setError(cause instanceof Error?cause.message:'加载技能失败，请重试');}
  finally{selecting.current=false;setPending(false);}
 }
 return <Popover open={open} onOpenChange={setOpen} trigger="click" placement="topLeft" content={<div className="fg-skill-popover" data-canvas-no-zoom onPointerDown={event=>event.stopPropagation()}>
  <div className="fg-skill-popover-heading"><BookOpen size={17}/><strong>制作 Skills</strong><Link to="/skills" onClick={()=>setOpen(false)}><Library size={14}/>技能库</Link></div>
  <div className="fg-skill-scopes" aria-label="技能用途">{[['recommended',capability==='image'?'图片风格':'推荐'],['drama','剧本 / 分镜'],['creative','视觉设计'],['ecommerce','广告'],['all','全部']].map(([value,label])=><button key={value} type="button" aria-pressed={category===value} onClick={()=>setCategory(value)}>{label}</button>)}</div>
  <Select getPopupContainer={trigger=>trigger.parentElement!} style={{width:'100%'}} mode="multiple" maxCount={4} maxTagCount="responsive" showSearch optionFilterProp="label" placeholder={capability==='image'?'选择图片风格，例如电影写实、极简 Logo':'搜索并选择制作 Skill'} aria-label="选择制作 Skill" value={selected.map(r=>r.id)} options={filtered.map(r=>{const style=fgImageStyle(r.skill!.skillId);return {value:r.id,label:style?`${style.label} · ${r.label}${style.direct?'':' · Agent 分层制作'}`:r.label,title:r.text};})} loading={loading||pending} disabled={loading||pending||disabled} notFoundContent={loading?'正在读取技能库':'没有匹配的制作技能'} onChange={ids=>void select(ids)}/>
  {capability==='image'&&<p>填写画面内容并选择风格，由当前图片模型生成。照片双联画、记忆拼贴与交互卡请在 Agent 中分层制作。</p>}
  {error?<p role="alert">{error}</p>:<p>{pending?'正在加载所选技能…':`${skills.length} 个可用技能 · 本次最多选择 4 个`}</p>}
 </div>}><Button className="creation-chat-control" type="text" disabled={disabled} icon={<BookOpen size={16}/>} aria-label="加载制作 Skill">Skill{selected.length?` · ${selected.length}`:''}</Button></Popover>;
}
