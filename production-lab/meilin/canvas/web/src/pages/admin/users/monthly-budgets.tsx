import {useEffect,useRef,useState} from 'react';
import {App,Button,DatePicker,InputNumber,Space,Table,Tag} from 'antd';
import dayjs from 'dayjs';
import {http} from '@/services/api/request';
type Row={id:string;name:string;email:string;monthly_cny:string|null;actual:number;pending:number;unknown:number;used:number};
type Summary={users:Row[];month:string;historical:boolean;canManage:boolean};
const currentMonth=()=>dayjs().format('YYYY-MM');
export function MonthlyBudgets(){
 const {message}=App.useApp();
 const [rows,setRows]=useState<Row[]>([]),[month,setMonth]=useState(currentMonth),[canManage,setCanManage]=useState(false),[loading,setLoading]=useState(false),[editing,setEditing]=useState<Record<string,number>>({}),[saving,setSaving]=useState('');
 const requestId=useRef(0);const historical=month!==currentMonth();
 async function load(){const id=++requestId.current;setLoading(true);try{const result=await http.get<Summary>('/fg/budgets/users',{params:{month}});if(id!==requestId.current)return;setRows(result.users);setCanManage(result.canManage);}catch(e){if(id===requestId.current)message.error(e instanceof Error?e.message:'月额度读取失败');}finally{if(id===requestId.current)setLoading(false);}}
 useEffect(()=>{setRows([]);setCanManage(false);setEditing({});void load();return()=>{requestId.current++;};},[month]);
 const money=(n:number)=>'¥'+n.toLocaleString('zh-CN',{maximumFractionDigits:4});
 return <section className="mt-6"><div className="flex flex-wrap items-center justify-between gap-4 mb-4"><div><h2 className="text-base font-semibold">用户每月制作额度</h2><p className="text-sm opacity-60">按北京时间自然月计数，历史消费长期保留。0 为不限额；待出账预留与已核销费用共同占用额度。</p>{historical&&<p className="text-sm opacity-60">历史月份只读；费用按请求发生月份归集，后续核销会更新金额。限额显示该月最后一次已记录设置。</p>}</div><Space wrap><DatePicker aria-label="消费月份" picker="month" value={dayjs(month+'-01')} allowClear={false} disabledDate={d=>d.isAfter(dayjs(),'month')||d.year()<2000} onChange={d=>{if(d)setMonth(d.format('YYYY-MM'));}}/><Button disabled={!historical} onClick={()=>setMonth(currentMonth())}>回到本月</Button><Button loading={loading} onClick={()=>void load()}>刷新</Button></Space></div><Table<Row> rowKey="id" loading={loading} dataSource={rows} pagination={{pageSize:15}} scroll={{x:900}} columns={[
 {title:'成员',render:(_,r)=><><strong>{r.name}</strong><div className="text-xs opacity-60">{r.email}</div></>},
 {title:month+' 已核销',render:(_,r)=>money(r.actual)},
 {title:'待出账预留',render:(_,r)=><>{money(r.pending)}{r.unknown>0&&<Tag color="gold">{r.unknown} 笔金额待确认</Tag>}</>},
 {title:historical?'当月限额记录':'每月人民币限额',render:(_,r)=>historical?(r.monthly_cny===null?'未记录':Number(r.monthly_cny)===0?'不限额':money(Number(r.monthly_cny))):<InputNumber disabled={!canManage||loading} min={0} max={10000000} precision={2} prefix="¥" value={editing[r.id]??Number(r.monthly_cny)} onChange={n=>setEditing(e=>({...e,[r.id]:Number(n)||0}))}/>},
 {title:'额度状态',render:(_,r)=>r.monthly_cny===null?<Tag>历史限额未记录</Tag>:Number(r.monthly_cny)===0?<Tag>不限额</Tag>:<Tag color={r.used>=Number(r.monthly_cny)?'red':'blue'}>{historical?'未用额度 ':'剩余 '}{money(Math.max(0,Number(r.monthly_cny)-r.used))}</Tag>},
 ...(!historical?[{title:'操作',render:(_:unknown,r:Row)=><Button loading={saving===r.id} disabled={!canManage||loading||editing[r.id]===undefined||editing[r.id]===Number(r.monthly_cny)} onClick={async()=>{setSaving(r.id);try{await http.patch('/fg/budgets/users',{userId:r.id,monthlyCny:editing[r.id]});await load();setEditing(e=>{const next={...e};delete next[r.id];return next;});message.success('每月限额已更新');}catch(e){message.error(e instanceof Error?e.message:'保存失败');}finally{setSaving('');}}}>保存</Button>}]:[]),
 ]}/></section>;
}
