import {useState} from 'react';
import {App,Button,Form,Input,Select,Tag} from 'antd';
import {Plus,BookOpenText} from 'lucide-react';
import {AppModal} from '@/components/ui/product/app-modal';
import {submitFGStory,resubmitFGStory,reviewFGStory,type FGTopic,type FGStory} from '@/services/api/fg-production';

export function StoryDetails({story,onClose,onProject}:{story:FGTopic|null;onClose:()=>void;onProject:(s:FGTopic)=>void}){
 return <AppModal open={!!story} onCancel={onClose} title={story?.title} width={760} footer={<Button type="primary" disabled={story?.blocked} onClick={()=>story&&onProject(story)}>以此建立项目</Button>}>
  {story&&<dl className="fg-story-details">{[['原作与人物原型',story.original],['主要人物',story.characters],['故事梗概',story.plot],['现代冲突与改编方向',story.conflict],['视觉风格',story.style],['制作形式',story.form],['市场与发行',[story.markets,story.language,story.channel].filter(Boolean).join(' · ')],['来源备注',story.source_rights]].map(([label,value])=>value?<div key={label}><dt>{label}</dt><dd>{value}</dd></div>:null)}</dl>}
 </AppModal>;
}
export function StorySubmissions({stories,canReview,onRefresh}:{stories:FGStory[];canReview:boolean;onRefresh:()=>Promise<void>}){
 const {message}=App.useApp(),[form]=Form.useForm();
 const [editing,setEditing]=useState<FGStory|null|undefined>(undefined),[reviewing,setReviewing]=useState<FGStory|null>(null),[note,setNote]=useState(''),[busy,setBusy]=useState(false);
 const start=(s:FGStory|null)=>{form.resetFields();form.setFieldsValue(s||{form:'2D 动画',markets:'北美',style:'待选择'});setEditing(s);};
 const submit=async()=>{try{const v=await form.validateFields();setBusy(true);if(editing)await resubmitFGStory({...editing,...v});else await submitFGStory(v);void message.success('已提交，审核通过后进入故事库');setEditing(undefined);await onRefresh();}catch(e){if(e instanceof Error)void message.error(e.message);}finally{setBusy(false);}};
 const review=async(status:'approved'|'rejected')=>{if(!reviewing)return;setBusy(true);try{await reviewFGStory(reviewing.id,reviewing.revision,status,note);void message.success(status==='approved'?'已加入故事库':'已退回作者');setReviewing(null);await onRefresh();}catch(e){void message.error(e instanceof Error?e.message:'审核失败');}finally{setBusy(false);}};
 return <><div className="fg-section-heading"><div><h3>{canReview?'故事投稿与审核':'我的故事投稿'}</h3><p>补齐原作、人物和制作方向，通过审核后大家都能选用。</p></div><Button type="primary" icon={<Plus size={16}/>} onClick={()=>start(null)}>提交故事</Button></div>
  <div className="fg-project-grid">{stories.length?stories.map(s=><article className="fg-story-card" key={s.id}><div className="fg-card-kicker"><Tag color={s.status==='pending'?'gold':s.status==='approved'?'blue':undefined}>{s.status==='pending'?'待审核':s.status==='approved'?'已入库':'已退回'}</Tag><span>{s.submitted_name}</span></div><h3>{s.title}</h3><p>{s.original}</p><p>{s.conflict}</p>{s.review_note&&<p className="fg-review-note">审核意见：{s.review_note}</p>}<div className="fg-card-action">{canReview&&s.status==='pending'?<Button type="primary" onClick={()=>{setNote('');setReviewing(s);}}>审阅故事</Button>:null}{!canReview&&s.status!=='approved'?<Button onClick={()=>start(s)}>修改并提交</Button>:null}</div></article>):<div className="fg-story-empty"><BookOpenText size={28}/><h3>把你的故事带到团队里</h3><p>提交后先审核，通过后即可立项并创建分集画布。</p><Button onClick={()=>start(null)}>开始填写</Button></div>}</div>
  <AppModal title={editing?'修改故事投稿':'提交新故事'} open={editing!==undefined} onCancel={()=>setEditing(undefined)} onOk={()=>void submit()} confirmLoading={busy} okText="提交审核" width={760}>
   <Form form={form} layout="vertical" className="fg-story-form">
    <Form.Item name="title" label="故事名称" rules={[{required:true}]}><Input maxLength={120}/></Form.Item>
    <Form.Item name="original" label="原作 / 神话原型" rules={[{required:true}]}><Input placeholder="例如：美杜莎 · 希腊神话；或原创故事" maxLength={500}/></Form.Item>
    <Form.Item name="characters" label="人物与关系" rules={[{required:true}]}><Input.TextArea rows={2} placeholder="主角、对手、关系与各自目标" maxLength={1000}/></Form.Item>
    <Form.Item name="plot" label="故事梗概" rules={[{required:true}]}><Input.TextArea rows={4} maxLength={6000}/></Form.Item>
    <Form.Item name="conflict" label="改编方向 / 核心冲突" rules={[{required:true}]}><Input.TextArea rows={3} placeholder="原型如何变成现代冲突？每集如何推进？" maxLength={3000}/></Form.Item>
    <div className="fg-form-columns"><Form.Item name="form" label="制作形式" rules={[{required:true}]}><Select options={['2D 动画','3D 动画','AI 真人','混合媒介'].map(value=>({value,label:value}))}/></Form.Item><Form.Item name="style" label="视觉风格" rules={[{required:true}]}><Select showSearch options={['电影写实','2D 手绘','日系动画','羊毛毡','剪纸拼贴','暗黑童话','待选择'].map(value=>({value,label:value}))}/></Form.Item></div>
    <Form.Item name="markets" label="目标市场" rules={[{required:true}]}><Select showSearch options={['北美','拉美','北美 / 拉美','欧洲','东南亚','中国','全球'].map(value=>({value,label:value}))}/></Form.Item>
    <div className="fg-form-columns"><Form.Item name="language" label="语言"><Input placeholder="例如：英语 / 西班牙语" maxLength={200}/></Form.Item><Form.Item name="channel" label="发行渠道"><Input placeholder="例如：YouTube / 短剧平台" maxLength={200}/></Form.Item></div>
    <Form.Item name="source_rights" label="来源与改编备注"><Input.TextArea rows={2} maxLength={1000}/></Form.Item>
   </Form>
  </AppModal>
  <AppModal title={`审核 · ${reviewing?.title||''}`} open={!!reviewing} onCancel={()=>setReviewing(null)} width={760} footer={<><Button disabled={busy||!note.trim()} onClick={()=>void review('rejected')}>退回修改</Button><Button type="primary" loading={busy} onClick={()=>void review('approved')}>通过并加入故事库</Button></>}>
   {reviewing&&<dl className="fg-story-details">{[['原作',reviewing.original],['人物',reviewing.characters],['梗概',reviewing.plot],['冲突',reviewing.conflict],['制作方向',`${reviewing.form} · ${reviewing.style} · ${reviewing.markets}`]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}<Input.TextArea aria-label="审核意见" placeholder="退回时请填写修改意见" value={note} onChange={e=>setNote(e.target.value)} maxLength={1000}/>
  </AppModal>
 </>;
}
