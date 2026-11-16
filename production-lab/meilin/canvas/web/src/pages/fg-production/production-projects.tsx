import {useState} from 'react';
import {App,Button,Input,Select,Tag} from 'antd';
import {ArrowUpRight,Clapperboard,Search} from 'lucide-react';
import {Link,useNavigate} from 'react-router';
import {DeleteButton} from '@/components/ui/base/buttons/delete-button';
import {deleteProject} from '@/services/api/projects';
import type {FGProject} from '@/services/api/fg-production';

export function ProductionProjects({projects,canManage,onRefresh,onBudget}:{projects:FGProject[];canManage:boolean;onRefresh:()=>Promise<void>;onBudget:(p:FGProject)=>void}){
 const [tier,setTier]=useState('all'),[group,setGroup]=useState('all'),[owner,setOwner]=useState('all'),[query,setQuery]=useState('');
 const navigate=useNavigate(),{message}=App.useApp();
 const rows=projects.filter(p=>(tier==='all'||p.tier===tier)&&(group==='all'||(p.group_name||'')===group)&&(owner==='all'||p.user_id===owner)&&[p.name,p.owner_name,p.topic_snapshot?.original].join(' ').toLowerCase().includes(query.trim().toLowerCase()));
 return <><div className="fg-story-filters" role="search" aria-label="筛选制作项目"><Input prefix={<Search size={16}/>} placeholder="搜索制作项目" value={query} onChange={e=>setQuery(e.target.value)} allowClear/><Select aria-label="制作级别" value={tier} onChange={setTier} options={[{value:'all',label:'全部级别'},...['S','A','B','C'].map(value=>({value,label:value+' 级'}))]}/><Select aria-label="制作小组" value={group} onChange={setGroup} options={[{value:'all',label:'全部小组'},...[...new Set(projects.map(p=>p.group_name||''))].map(value=>({value,label:value||'未分组'}))]}/><Select aria-label="项目负责人" value={owner} onChange={setOwner} options={[{value:'all',label:'全部负责人'},...[...new Map(projects.map(p=>[p.user_id,p.owner_name])).entries()].map(([value,label])=>({value,label}))]}/></div><div className="fg-project-grid">
 {rows.map(p=><article key={p.id} className="fg-story-card"><div className="fg-card-kicker"><Clapperboard size={16}/><span>故事 #{p.topic_id}</span><Tag>{p.tier} 级</Tag><Tag color="blue">团队共享</Tag></div><h3>{p.name}</h3><p className="fg-story-original">{p.topic_snapshot?.original}</p><p className="fg-story-clamp">{p.topic_snapshot?.conflict||p.topic_snapshot?.plot}</p><div className="fg-story-meta"><span>{p.group_name||'未分组'} · {p.owner_name}</span><span>{p.canvas_count} 张画布 · {Number(p.budget_cny)>0?'预算 ¥'+Number(p.budget_cny).toLocaleString('zh-CN'):'无预算上限'}</span></div><div className="fg-card-action"><Button type="primary" onClick={()=>navigate('/projects/'+p.id+'/canvases')}>打开画布 <ArrowUpRight size={15}/></Button><Link to={'/projects/'+p.id}>项目内容</Link><Link to={'/fg-finance?project='+p.id}>费用</Link>{canManage&&<><Button size="small" onClick={()=>onBudget(p)}>调整预算</Button><DeleteButton label={'删除制作项目 '+p.name} description="完整项目先归档到 NAS recycle/projects；项目与关联画布从工作区移除，该故事重新开放立项。已发生费用与共用素材保留。" onConfirm={async()=>{await deleteProject(p.id);await onRefresh();message.success('项目已归档，故事可重新立项');}}/></>}</div></article>)}
 {!rows.length&&<div className="fg-story-empty"><h3>{projects.length?'没有匹配的制作项目':'从故事库选择一个故事开始立项'}</h3><p>按级别、小组、负责人和名称查找项目。</p></div>}
 </div></>;
}
