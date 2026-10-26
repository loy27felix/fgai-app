import {useEffect,useState} from 'react';
import {Alert,Button,DatePicker,Select,Table,Tabs,Tag} from 'antd';
import dayjs from 'dayjs';
import {WorkspacePage,PageHeader} from '@/components/layout/workspace-page';
import {useUserStore} from '@/stores/use-user-store';
import {getPersonalExpenses,type PersonalExpenseRow as Row,type PersonalModelExpense as Model,type PersonalExpensesData as Data} from '@/services/api/personal-expenses';
import './personal-expenses.css';

const money=(n:string|number)=>new Intl.NumberFormat('zh-CN',{style:'currency',currency:'CNY',maximumFractionDigits:4}).format(Number(n));
const thisMonth=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit'}).format(new Date());
const statusLabels:Record<string,string>={succeeded:'成功',failed:'失败',running:'生成中',cancelled:'已取消'};
export default function PersonalExpenses(){
 const userId=useUserStore(s=>s.user?.id);
 const [month,setMonth]=useState(thisMonth),[model,setModel]=useState<string>(),[page,setPage]=useState(1),[tab,setTab]=useState('records'),[epoch,setEpoch]=useState(0);
 const [snapshot,setSnapshot]=useState<{userId:string;data:Data}>(),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const data=snapshot?.userId===userId?snapshot?.data:undefined;
 useEffect(()=>{
  if(!userId){setSnapshot(undefined);return;}
  const controller=new AbortController();setBusy(true);setError('');setSnapshot(undefined);
  void getPersonalExpenses({month,model,page},controller.signal).then(value=>{if(!controller.signal.aborted)setSnapshot({userId,data:value});}).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'费用读取失败');}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});
  return()=>controller.abort();
 },[userId,month,model,page,epoch]);
 return <WorkspacePage><PageHeader title="我的费用" description="查看本人调用的人民币费用，与管理员账单核销记录同步。" actions={<Button loading={busy} onClick={()=>setEpoch(e=>e+1)}>刷新</Button>}/>
  <div className="personal-expenses-summary">
   <article><span>累计已核销</span><strong>{data?money(data.summary.total_cny):'—'}</strong></article>
   <article><span>本月已核销 · {data?.currentMonth||thisMonth()}</span><strong>{data?money(data.summary.month_cny):'—'}</strong></article>
   <article><span>待核对请求</span><strong>{data?data.summary.pending_requests:'—'}<small> 笔</small></strong></article>
  </div>
  <Alert type="info" showIcon title="待核对不代表免费" description="金额以已关联的供应商账单为准；尚未出账或无法唯一匹配的请求显示待核对，费用确认后会同步更新。仅显示你的调用，不包含同事的消费。"/>
  {error&&<Alert className="my-4" type="error" showIcon title={error} action={<Button onClick={()=>setEpoch(e=>e+1)}>重试</Button>}/>}
  <div className="personal-expenses-filters"><DatePicker picker="month" allowClear={false} value={month==='all'?null:dayjs(month)} aria-label="费用月份" onChange={v=>{if(v){setMonth(v.format('YYYY-MM'));setPage(1);}}}/><Button type={month==='all'?'primary':'default'} onClick={()=>{setMonth('all');setPage(1);}}>全部时间</Button><Select aria-label="费用模型" allowClear showSearch placeholder="全部模型" value={model} options={(data?.models||[]).map(m=>({value:m.model,label:m.model}))} onChange={v=>{setModel(v);setPage(1);}}/></div>
  <Tabs activeKey={tab} onChange={setTab} items={[{key:'records',label:'每笔记录'},{key:'models',label:'按模型汇总'}]}/>
  {tab==='records'?<Table<Row> rowKey="id" loading={busy} dataSource={data?.records||[]} scroll={{x:850}} pagination={{current:page,pageSize:20,total:data?.total||0,showSizeChanger:false,onChange:setPage}} columns={[
   {title:'时间',dataIndex:'created_at',render:s=>new Date(s).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})},
   {title:'模型 / 渠道',render:(_,r)=><><div>{r.model}</div><small>{r.channel_name}</small></>},
   {title:'项目',dataIndex:'project_name'},
   {title:'请求结果',dataIndex:'status',render:s=>statusLabels[s]||s},
   {title:'人民币费用',render:(_,r)=>r.settled_cny===null?<Tag color="gold">待核对</Tag>:<strong>{money(r.settled_cny)}</strong>},
   {title:'核销流水',dataIndex:'settled_reference_id',render:s=><span className="personal-expenses-reference">{s||'—'}</span>}
  ]}/>:<Table<Model> rowKey="model" loading={busy} dataSource={(data?.models||[]).filter(m=>!model||m.model===model)} pagination={{pageSize:20}} columns={[{title:'模型',dataIndex:'model'},{title:'请求数',dataIndex:'requests'},{title:'已核销费用',dataIndex:'settled_cny',render:money},{title:'待核对',dataIndex:'pending',render:n=>`${n} 笔`}]}/>}
 </WorkspacePage>;
}
