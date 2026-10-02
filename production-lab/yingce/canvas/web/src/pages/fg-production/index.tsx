import {useEffect,useMemo,useState} from 'react';
import {App,Button,Form,Input,InputNumber,Modal,Select,Tag,Tabs,Alert} from 'antd';
import {ArrowUpRight,BookOpenText,Clapperboard,Search} from 'lucide-react';
import {Link,useNavigate} from 'react-router';
import {WorkspacePage,PageHeader} from '@/components/layout/workspace-page';
import {WorkspaceLoadingState} from '@/components/layout/workspace-state';
import {getFGTopics,getFGProjects,createFGProject,type FGTopic,type FGProject} from '@/services/api/fg-production';
import './production.css';
export default function FGProductionPage(){
 const [topics,setTopics]=useState<FGTopic[]>([]),[projects,setProjects]=useState<FGProject[]>([]),[groups,setGroups]=useState<Array<{id:string;name:string}>>([]);
 const [error,setError]=useState(''),[loading,setLoading]=useState(true),[keyword,setKeyword]=useState(''),[tab,setTab]=useState('projects'),[filter,setFilter]=useState('all'),[selected,setSelected]=useState<FGTopic|null>(null),[saving,setSaving]=useState(false);
 const [form]=Form.useForm();const {message}=App.useApp();const navigate=useNavigate();
 const load=async()=>{setLoading(true);try{const [t,p]=await Promise.all([getFGTopics(),getFGProjects()]);setTopics(t.topics);setProjects(p.projects);setGroups(p.groups);setError('');}catch(e){setError(e instanceof Error?e.message:'读取失败');}finally{setLoading(false);}};
 useEffect(()=>{void load();},[]);
 const visible=useMemo(()=>topics.filter(t=>(filter==='all'||t.selection_group===filter)&&(t.title+t.original+(t.selected_by||'')+(t.selection_group||'')+(t.selected_by_email||'')).toLowerCase().includes(keyword.toLowerCase())),[topics,keyword,filter]);
 const open=(topic:FGTopic)=>{setSelected(topic);form.setFieldsValue({tier:'A',budgetCny:0,groupName:groups.find(g=>g.name===topic.selection_group)?.name||''});};
 return <WorkspacePage className="fg-production-page">
  <PageHeader title="故事与项目" description="选定故事，进入独立项目；剧本、资产、画布与生成费用沿同一项目推进。" actions={<Button onClick={()=>void load()} loading={loading}>刷新</Button>}/>
  <section className="fg-story-intro"><div><span className="fg-eyebrow">FG / STORY PRODUCTION</span><h2>从一个故事，走到一部作品。</h2><p>选题 → 剧本与分集 → 项目画布 → 媒体生成 → 费用核销</p></div><Link to="/admin/fg-finance">项目费用 <ArrowUpRight size={17}/></Link></section>
  {error?<Alert type="error" showIcon title={error} action={<Button onClick={()=>void load()}>重试</Button>}/>:null}
  <Tabs activeKey={tab} onChange={setTab} items={[{key:'projects',label:`制作项目 · ${projects.length}`},{key:'topics',label:`故事选题 · ${topics.length}`}]} />
  {loading?<WorkspaceLoadingState/>:tab==='projects'?<div className="fg-project-grid">
   {!projects.length?<div className="fg-story-empty"><BookOpenText size={28}/><h3>先选一个故事，建立制作项目</h3><p>每个项目保存独立画布，创作费用自动按所属项目归集。</p><Button type="primary" onClick={()=>setTab('topics')}>浏览已选题</Button></div>:projects.map(p=><article key={p.id} className="fg-story-card"><div className="fg-card-kicker"><Clapperboard size={16}/><span>{p.topic_id?`选题 #${p.topic_id}`:'原创项目'}</span>{p.tier?<Tag>{p.tier} 级</Tag>:null}</div><h3>{p.name}</h3><p>{p.topic_snapshot?.conflict||p.topic_snapshot?.plot||'在项目里确定剧本、分集与视觉方向。'}</p><div className="fg-story-meta"><span>{p.group_name||'待分组'} · {p.owner_name}</span><span>{p.canvas_count} 张项目画布</span><span>计划预算 ¥{Number(p.budget_cny||0).toLocaleString('zh-CN')}</span></div><div className="fg-card-action"><Button type="primary" onClick={()=>navigate(`/projects/${p.id}`)}>进入项目 <ArrowUpRight size={15}/></Button><Link to={`/admin/fg-finance?project=${p.id}`}>费用明细</Link></div></article>)}
  </div>:<><div className="fg-story-filters"><Input prefix={<Search size={16}/>} placeholder="搜索选题、选择人、账号或小组" value={keyword} onChange={e=>setKeyword(e.target.value)} allowClear/><Select aria-label="筛选原选择小组" value={filter} onChange={setFilter} options={[{value:'all',label:'全部选题'},...[...new Set(topics.map(t=>t.selection_group).filter(Boolean))].map(x=>({value:x!,label:x!}))]}/></div><div className="fg-project-grid">{visible.map(t=><article className="fg-story-card" key={t.id}><div className="fg-card-kicker"><span>#{String(t.id).padStart(3,'0')}</span>{t.selected_by?<Tag color="blue">团队已选题</Tag>:<Tag>故事种子</Tag>}</div><h3>{t.title}</h3><p>{t.conflict||t.plot}</p><div className="fg-story-meta"><span>{t.form} · {t.style}</span><span>市场：{t.markets}</span>{t.selected_by?<span>{t.selection_group} · {t.selected_by}<br/>{t.selected_by_email} · {t.selected_at}</span>:null}</div><Button block disabled={t.blocked} onClick={()=>open(t)}>以此建立项目 <ArrowUpRight size={15}/></Button></article>)}</div></>}
  <Modal title="从选题建立制作项目" open={!!selected} onCancel={()=>setSelected(null)} okText="建立并进入项目" confirmLoading={saving} onOk={async()=>{try{const v=await form.validateFields();setSaving(true);const result=await createFGProject({topicId:selected!.id,...v});message.success(result.reused?'已打开已有项目':'制作项目已建立');navigate(`/projects/${result.projectId}`);}catch(e){if(e instanceof Error)message.error(e.message);}finally{setSaving(false);}}}>
   <p className="fg-modal-story-title">{selected?.title}</p><Form form={form} layout="vertical"><Form.Item name="tier" label="投入档位" rules={[{required:true}]}><Select options={['S','A','B','C'].map(x=>({value:x,label:x+' 级'}))}/></Form.Item><Form.Item name="groupName" label="制作小组"><Select options={[{value:'',label:'暂不分组'},...groups.map(g=>({value:g.name,label:g.name}))]}/></Form.Item><Form.Item name="budgetCny" label="计划预算（人民币）" rules={[{required:true}]}><InputNumber min={0} max={10000000} precision={2} style={{width:'100%'}}/></Form.Item></Form><p>保留选择人及原小组记录；每个故事关联到独立项目，进入项目后创建分集和画布。</p>
  </Modal>
 </WorkspacePage>;
}
