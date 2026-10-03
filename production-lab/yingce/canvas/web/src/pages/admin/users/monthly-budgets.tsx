import {useEffect,useState} from 'react';
import {App,Button,InputNumber,Table,Tag} from 'antd';
import {http} from '@/services/api/request';
type Row={id:string;name:string;email:string;monthly_cny:string;actual:number;pending:number;unknown:number;used:number};
export function MonthlyBudgets(){
 const {message}=App.useApp();const [rows,setRows]=useState<Row[]>([]),[month,setMonth]=useState(''),[editing,setEditing]=useState<Record<string,number>>({}),[saving,setSaving]=useState('');
 async function load(){try{const result=await http.get<{users:Row[];month:string}>('/fg/budgets/users');setRows(result.users);setMonth(result.month);}catch(e){message.error(e instanceof Error?e.message:'月限额读取失败');}}
 useEffect(()=>{void load();},[]);
 const money=(n:number)=>'¥'+n.toLocaleString('zh-CN',{maximumFractionDigits:4});
 return <section className="mt-6"><div className="flex items-center justify-between mb-3"><div><h2 className="text-base font-semibold">用户每月制作额度 · {month}</h2><p className="text-sm opacity-60">按北京时间自然月重新计数。0 为不限额；已核销费用和未出账请求的预留金额共同占用额度。</p></div><Button onClick={()=>void load()}>刷新额度</Button></div><Table<Row> rowKey="id" dataSource={rows} pagination={{pageSize:15}} scroll={{x:900}} columns={[
 {title:'成员',render:(_,r)=><><strong>{r.name}</strong><div className="text-xs opacity-60">{r.email}</div></>},
 {title:'本月已核销',render:(_,r)=>money(r.actual)},
 {title:'待出账预留',render:(_,r)=><>{money(r.pending)}{r.unknown>0&&<Tag color="gold">{r.unknown} 笔金额待确认</Tag>}</>},
 {title:'每月人民币限额',render:(_,r)=><InputNumber min={0} max={10000000} precision={2} prefix="¥" value={editing[r.id]??Number(r.monthly_cny)} onChange={n=>setEditing(e=>({...e,[r.id]:Number(n)||0}))}/>},
 {title:'额度状态',render:(_,r)=>Number(r.monthly_cny)===0?<Tag>不限额</Tag>:<Tag color={r.used>=Number(r.monthly_cny)?'red':'blue'}>剩余 {money(Math.max(0,Number(r.monthly_cny)-r.used))}</Tag>},
 {title:'操作',render:(_,r)=><Button loading={saving===r.id} disabled={editing[r.id]===undefined||editing[r.id]===Number(r.monthly_cny)} onClick={async()=>{setSaving(r.id);try{await http.patch('/fg/budgets/users',{userId:r.id,monthlyCny:editing[r.id]});await load();setEditing(e=>{const next={...e};delete next[r.id];return next;});message.success('每月限额已更新');}catch(e){message.error(e instanceof Error?e.message:'保存失败');}finally{setSaving('');}}}>保存</Button>},
 ]}/></section>;
}
