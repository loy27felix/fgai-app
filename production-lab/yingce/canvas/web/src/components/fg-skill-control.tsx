import {useState} from 'react';
import {Button,Popover,Select} from 'antd';
import {BookOpen,Library} from 'lucide-react';
import {Link} from 'react-router';
import {canvasResourceMentionToken,type CanvasResourceReference} from '@/lib/canvas/canvas-resource-references';
import './fg-controls.css';
export function FGSkillControl({references,prompt,onChange,disabled}:{references:CanvasResourceReference[];prompt:string;onChange:(value:string)=>void;disabled?:boolean}){
 const [open,setOpen]=useState(false);
 const skills=references.filter(r=>r.kind==='skill'&&r.active);
 const selected=skills.filter(r=>prompt.includes(canvasResourceMentionToken(r))||prompt.includes('@'+r.label));
 return <Popover open={open} onOpenChange={setOpen} trigger="click" placement="topLeft" content={<div className="fg-skill-popover" data-canvas-no-zoom>
  <div className="fg-skill-popover-heading"><BookOpen size={17}/><strong>制作 Skills</strong><Link to="/skills" onClick={()=>setOpen(false)}><Library size={14}/>技能库</Link></div>
  <Select style={{width:'100%'}} mode="multiple" maxCount={4} showSearch optionFilterProp="label" placeholder="选择本次使用的 Skill" aria-label="选择制作 Skill" value={selected.map(r=>r.id)} options={skills.map(r=>({value:r.id,label:r.label}))} onChange={(ids:string[])=>{
   let next=prompt;
   for(const r of selected)if(!ids.includes(r.id))next=next.split(canvasResourceMentionToken(r)).join('').split('@'+r.label).join('');
   for(const r of skills)if(ids.includes(r.id)&&!selected.some(s=>s.id===r.id))next=canvasResourceMentionToken(r)+' '+next;
   onChange(next.trim());
  }}/>
  {!skills.length?<p>先在技能库将制作 Skill 加入“我的技能”。</p>:null}
 </div>}><Button className="creation-chat-control" type="text" disabled={disabled} icon={<BookOpen size={16}/>} aria-label="加载制作 Skill">Skill{selected.length?` · ${selected.length}`:''}</Button></Popover>;
}
