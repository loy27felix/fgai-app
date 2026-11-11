import {useMemo,useState} from 'react';
import {Alert,App,Input,Select,Table} from 'antd';
import {AppModal} from '@/components/ui/product/app-modal';
import {http} from '@/services/api/request';
import type {FGCall,FGReceipt} from '@/services/api/fg-production';

export function FinanceBatchMatches({calls,receipts,open,onClose,onSaved}:{calls:FGCall[];receipts:FGReceipt[];open:boolean;onClose:()=>void;onSaved:()=>Promise<void>}){
 const {message}=App.useApp();
 const [pairs,setPairs]=useState<Record<string,string>>({});
 const [note,setNote]=useState('');
 const [saving,setSaving]=useState(false);
 const chosen=useMemo(()=>new Set(Object.values(pairs)),[pairs]);
 const ready=calls.length>0&&calls.every(c=>pairs[c.id]);
 async function save(){
  if(!ready||note.trim().length<8){message.info('请为每条请求选择经核实的流水，并填写至少 8 字的核对依据');return;}
  setSaving(true);
  try{
   await http.post('/fg/finance/batch-matches',{pairs:calls.map(c=>({callId:c.id,referenceId:pairs[c.id]})),note});
   await onSaved();message.success(`已核销 ${calls.length} 条请求，每条均保留处理记录`);onClose();
  }catch(e){message.error(e instanceof Error?e.message:'本批未保存，请刷新后重新核对');}
  finally{setSaving(false);}
 }
 return <AppModal open={open} width={1100} title={`批量核对账单 · ${calls.length} 条请求`} onCancel={onClose} okText={`确认核销 ${calls.length} 条`} confirmLoading={saving} okButtonProps={{disabled:!ready||note.trim().length<8}} onOk={()=>void save()}>
  <Alert type="info" showIcon message="核实关联后，一次提交整批" description="仅显示同模型的未归属流水，已选流水不能重复使用。任意一条发生冲突时，整批不保存。原始金额和每条核对依据均保留。"/>
  <Table<FGCall> className="fg-finance-batch-table" rowKey="id" dataSource={calls} pagination={false} scroll={{x:860,y:360}} columns={[
   {title:'制作请求',width:330,render:(_,c)=><><strong>{c.model}</strong><div>{c.user_name} · {new Date(c.created_at).toLocaleString('zh-CN')}</div><div className="fg-finance-reference">{c.fg_fee_reference_id||c.provider_request_id||c.id}</div></>},
   {title:'供应商账单流水',render:(_,c)=><Select className="w-full" showSearch allowClear optionFilterProp="label" value={pairs[c.id]} placeholder="搜索原始账单编号，核实后选择" onChange={value=>setPairs(old=>{const next={...old};if(value)next[c.id]=value;else delete next[c.id];return next;})} options={receipts.filter(f=>f.model===c.model&&!f.classification).map(f=>({value:f.reference_id,disabled:chosen.has(f.reference_id)&&pairs[c.id]!==f.reference_id,label:`${new Date(f.occurred_at).toLocaleString('zh-CN')} · ¥${f.cny.toFixed(4)} · ${f.reference_id}`}))}/>},
  ]}/>
  <Input.TextArea className="mt-4" rows={3} value={note} onChange={e=>setNote(e.target.value)} maxLength={2000} placeholder="本批核对依据：例如已逐条核对供应商请求详情与原始账单编号。"/>
 </AppModal>;
}
