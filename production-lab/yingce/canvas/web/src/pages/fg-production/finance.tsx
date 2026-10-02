import {useEffect,useMemo,useState,useRef} from 'react';
import {Alert,App,Button,Input,InputNumber,Segmented,Table,Tag,Upload} from 'antd';
import {Download,RefreshCw,UploadCloud} from 'lucide-react';
import {Link,useSearchParams} from 'react-router';
import {WorkspacePage,PageHeader} from '@/components/layout/workspace-page';
import {getFGFinance,importFGFees,updateFGFx,type FGCall,type FGFinance} from '@/services/api/fg-production';
import './production.css';
import {FGModelPrices} from '@/components/fg-model-prices';

const money=(value:number)=>new Intl.NumberFormat('zh-CN',{style:'currency',currency:'CNY',minimumFractionDigits:2,maximumFractionDigits:4}).format(value);
const csvCell=(value:unknown)=>`"${String(value??'').replaceAll('"','""')}"`;
type Summary={id:string;name:string;count:number;settled:number;pending:number;total:number};

export default function FGFinancePage(){
    const {message,modal}=App.useApp();const [params,setParams]=useSearchParams();
    const [data,setData]=useState<FGFinance|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
    const [groupBy,setGroupBy]=useState('项目'),[query,setQuery]=useState(''),[fx,setFx]=useState<number|null>(null);
    const loading=useRef(false),mounted=useRef(false);
    async function load(silent=false){if(loading.current)return;loading.current=true;if(!silent)setBusy(true);try{const result=await getFGFinance();if(!mounted.current)return;setData(result);setError('');if(!silent)setFx(result.fx);}catch(e){if(mounted.current)setError(e instanceof Error?e.message:'读取费用失败');}finally{loading.current=false;if(mounted.current&&!silent)setBusy(false);}}
    useEffect(()=>{mounted.current=true;void load();const timer=setInterval(()=>{if(!document.hidden)void load(true);},15000);return()=>{mounted.current=false;clearInterval(timer);};},[]);
    const calls=useMemo(()=>data?.calls.filter(row=>(!params.get('project')||row.project_id===params.get('project'))&&(!query||[row.project_name,row.user_name,row.group_name,row.model,row.settled_reference_id,row.fg_fee_reference_id,row.provider_request_id].join(' ').toLowerCase().includes(query.toLowerCase())))??[],[data,params,query]);
    const settled=calls.filter(row=>row.settled_cny!==null);
    const total=settled.reduce((sum,row)=>sum+Number(row.settled_cny),0);
    const accountBillTotal=(data?.calls.reduce((sum,row)=>sum+Number(row.settled_cny||0),0)||0)+(data?.unallocated.reduce((sum,row)=>sum+row.cny,0)||0);
    const pending=calls.filter(row=>row.settled_cny===null&&row.rate_estimated_cny!==null),pendingTotal=pending.reduce((sum,row)=>sum+Number(row.rate_estimated_cny),0);
    const summaries=useMemo(()=>{
        const map=new Map<string,Summary>();
        for(const row of calls){
            const id=groupBy==='人员'?row.user_id:groupBy==='小组'?(row.group_name||'未归属小组'):(row.project_id||'未关联项目');
            const name=groupBy==='人员'?row.user_name:groupBy==='小组'?(row.group_name||'未归属小组'):(row.project_name||row.canvas_title||'自由画布 / 未关联项目');
            const item=map.get(id)??{id,name,count:0,settled:0,pending:0,total:0};item.count++;
            if(row.settled_cny===null)item.pending++;else{item.settled++;item.total+=Number(row.settled_cny);}map.set(id,item);
        }return [...map.values()].sort((a,b)=>b.total-a.total);
    },[calls,groupBy]);
    function exportCSV(){
        const rows=[['时间','成员','项目','小组','模型','状态','Reference ID','账单实扣（人民币）','用量估算（人民币，非核销）'],...calls.map(row=>[row.created_at,row.user_name,row.project_name,row.group_name,row.model,row.status,row.settled_reference_id||row.fg_fee_reference_id||row.provider_request_id,row.settled_cny,row.rate_estimated_cny])];
        const url=URL.createObjectURL(new Blob(['\ufeff'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
        const a=document.createElement('a');a.href=url;a.download=`FG-项目费用-${new Date().toISOString().slice(0,10)}.csv`;a.click();URL.revokeObjectURL(url);
    }
    async function importFile(file:File){
        if(file.size>5_000_000){void message.error('费用单最多 5 MB');return;}
        const csv=await file.text();
        modal.confirm({title:'导入 WeToken 实际费用单',content:`以 Reference ID 和模型精确匹配，按当前人民币换算系数 ${data?.fx??'—'} 记账。重复流水不会重复计费；无对应请求的流水会保留为待归属。`,okText:'导入并对账',onOk:async()=>{
            try{const result=await importFGFees(csv);void message.success(result.reused?'费用单已导入，无重复计费':`已处理 ${result.rows} 条消费流水`);await load();}catch(e){void message.error(e instanceof Error?e.message:'导入失败');throw e;}
        }});
    }
    return <WorkspacePage className="fg-production-page">
        <PageHeader title="FG 人民币费用对账" description="每次模型请求保留人员、画布与项目归属。实际金额以 WeToken 消费费用单核销。" actions={<><Button icon={<RefreshCw size={15}/>} loading={busy} onClick={()=>void load()}>刷新</Button><Button icon={<Download size={15}/>} disabled={!calls.length} onClick={exportCSV}>导出明细</Button><Upload accept=".csv,text/csv" showUploadList={false} beforeUpload={file=>{void importFile(file);return false;}}><Button type="primary" icon={<UploadCloud size={15}/>}>导入 WeToken 费用单</Button></Upload></>}/>
        {error&&<Alert type="error" showIcon message={error} action={<Button onClick={()=>void load()}>重试</Button>}/>}
        <Alert type={data?.billingSync?.status==='reauthorization_required'?'warning':'info'} showIcon message="页面每 15 秒刷新 · 供应商账单每分钟同步" description={`${data?.billingSync?.reason||'用量估算自动更新，账单实扣须精确匹配供应商流水。'}${data?.billingSync?.lastSuccess?' 上次成功同步：'+new Date(data.billingSync.lastSuccess).toLocaleString('zh-CN'):''}`}/>
        <div className="fg-finance-stats">
            <section><span>已同步账户账单合计 · 人民币</span><strong>{data?money(accountBillTotal):'—'}</strong><small>含同一 WeToken 账户其他系统的历史消费；不等于本板块项目费用</small></section>
            <section><span>已核销费用 · 人民币折算</span><strong>{data?money(total):'—'}</strong><small>{settled.length} 次精确匹配 · 费用单覆盖部分</small></section>
            <section><span>待核销用量估算 · 人民币</span><strong>{data?money(pendingTotal):'—'}</strong><small>{pending.length} 次有估算，另有 {calls.length-settled.length-pending.length} 次金额待确认；不计入实扣</small></section>
            <section><span>WeToken 请求记录</span><strong>{data?calls.length:'—'}</strong><small>包含失败尝试；轮询与下载不重复计费</small></section>
            <section><span>费用单待归属</span><strong>{data?data.unallocated.length:'—'}</strong><small>未找到唯一对应请求，未计入任何项目</small></section>
        </div>
        <div className="fg-finance-controls"><div><span>人民币记账换算系数</span><InputNumber min={0.000001} max={100} precision={6} value={fx} onChange={setFx}/><Button disabled={!fx||fx===data?.fx} onClick={async()=>{if(fx)try{await updateFGFx(fx);void message.success('已保存；历史核销保留原汇率');await load();}catch(e){void message.error(e instanceof Error?e.message:'保存失败');}}}>保存</Button></div><small>最近导入：{data?.lastImport?new Date(data.lastImport.created_at).toLocaleString('zh-CN')+' · '+data.lastImport.row_count+' 条':'尚未导入'}。预算与模型估算不计入已核销总额。</small></div>
        <div className="fg-topic-toolbar"><Input prefix={<span>搜索</span>} value={query} onChange={e=>setQuery(e.target.value)} placeholder="成员、项目、小组、模型或 Reference ID" allowClear/><Segmented options={['项目','人员','小组']} value={groupBy} onChange={value=>setGroupBy(String(value))}/>{params.get('project')&&<Button onClick={()=>setParams({})}>查看全部项目</Button>}</div>
        <h2 className="fg-finance-title">费用归集</h2>
        <FGModelPrices/>
        <Table rowKey="id" dataSource={summaries} loading={busy} pagination={false} scroll={{x:760}} locale={{emptyText:'尚无模型调用记录。先从故事建立项目，在项目画布中运行模型。'}} columns={[
            {title:groupBy,dataIndex:'name',render:(value:string,row:Summary)=>groupBy==='项目'&&row.id!=='未关联项目'?<Link to={`/projects/${row.id}`}>{value}</Link>:value},
            {title:'模型请求',dataIndex:'count',width:110}, {title:'已核销 / 待核销',render:(_:unknown,row:Summary)=><><Tag>{row.settled} 已核销</Tag><Tag color={row.pending?'gold':undefined}>{row.pending} 待核销</Tag></>},
            {title:'已核销费用',width:170,render:(_:unknown,row:Summary)=><strong>{row.settled?money(row.total):'待核销'}</strong>}
        ]}/>
        <h2 className="fg-finance-title">模型请求明细</h2>
        <Table<FGCall> rowKey="id" dataSource={calls} loading={busy} pagination={{pageSize:20,showSizeChanger:true}} scroll={{x:1250}} columns={[
            {title:'时间 / 成员',width:180,render:(_:unknown,row)=><><div>{row.user_name}</div><small>{new Date(row.created_at).toLocaleString('zh-CN')}</small></>},
            {title:'项目 / 小组',width:190,render:(_:unknown,row)=><><div>{row.project_name||row.canvas_title||'未关联项目'}</div><small>{row.group_name||'未归属小组'}</small></>},
            {title:'模型',dataIndex:'model',width:270}, {title:'请求 / 任务',dataIndex:'status',width:110,render:(value:string,row)=>row.task_status==='failed'?<Tag color="red">任务失败</Tag>:row.task_status==='queued'||row.task_status==='running'?<Tag color="blue">任务处理中</Tag>:value==='succeeded'?<Tag color="green">请求成功</Tag>:value==='failed'?<Tag color="red">请求失败</Tag>:value},
            {title:'人民币费用',width:180,render:(_:unknown,row)=>row.settled_cny!==null?<><strong>{money(Number(row.settled_cny))}</strong><div><Tag color="green">费用单已核销</Tag></div></>:<><Tag color="gold">待费用单核销</Tag>{row.rate_estimated_cny!==null&&<div><small>用量估算 {money(row.rate_estimated_cny)}</small></div>}</>},
            {title:'Reference ID',width:270,render:(_:unknown,row)=><span className="fg-fee-reference">{row.settled_reference_id||row.fg_fee_reference_id||'供应商未返回费用流水号'}</span>}
        ]}/>
        {!!data?.unallocated.length&&<><Alert type="info" showIcon message={`费用单待归属合计 ${money(data.unallocated.reduce((sum,row)=>sum+row.cny,0))}`} description="这些流水缺少唯一匹配的请求，不会根据时间、提示词或金额猜测归属；保留在账户账单中，未计入任何项目。"/><Table rowKey="reference_id" dataSource={data.unallocated} pagination={false} scroll={{x:720}} columns={[{title:'待归属流水号',dataIndex:'reference_id'},{title:'模型',dataIndex:'model'},{title:'费用单实扣（人民币）',dataIndex:'cny',render:(value:number)=>money(value)}]}/></>}
    </WorkspacePage>;
}
