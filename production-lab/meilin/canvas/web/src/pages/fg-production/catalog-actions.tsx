import {useState} from 'react';
import {App,Button,Form,Input} from 'antd';
import {AppModal} from '@/components/ui/product/app-modal';
import {DeleteButton} from '@/components/ui/base/buttons/delete-button';
import {http} from '@/services/api/request';
import type {FGTopic} from '@/services/api/fg-production';

export function StoryCatalogActions({story,onRefresh}:{story:FGTopic;onRefresh:()=>Promise<void>}){
 const [editing,setEditing]=useState(false);
 return <><Button size="small" onClick={()=>setEditing(true)}>编辑故事</Button><DeleteButton label={'删除故事 '+story.title} description="仅未立项故事可删除。完整内容先归档到 NAS recycle/stories，再从故事库移除。" onConfirm={async()=>{await http.delete('/fg/topics/'+story.id,{params:{revision:story.revision||0}});await onRefresh();}}/>{editing&&<StoryCatalogEditor story={story} onClose={()=>setEditing(false)} onRefresh={onRefresh}/>}</>;
}
function StoryCatalogEditor({story,onClose,onRefresh}:{story:FGTopic;onClose:()=>void;onRefresh:()=>Promise<void>}){
 const [form]=Form.useForm(),[busy,setBusy]=useState(false),{message}=App.useApp();
 const save=async()=>{try{const fields=await form.validateFields();setBusy(true);await http.put('/fg/topics/'+story.id,{...fields,revision:story.revision||0});await onRefresh();message.success('故事已更新，已有项目的立项快照保留');onClose();}catch(e){if(e instanceof Error)message.error(e.message);}finally{setBusy(false);}};
 return <AppModal title={'编辑故事 · #'+story.id} open onCancel={onClose} onOk={()=>void save()} confirmLoading={busy} width={760} okText="保存修改"><Form form={form} layout="vertical" initialValues={{...story,characters:story.characters||story.original,conflict:story.conflict||story.plot}}>
  {([['title','故事名称',120],['original','原作与人物原型',500],['characters','人物与关系',1000],['plot','故事梗概',6000],['conflict','改编方向与核心冲突',3000],['style','视觉风格',500],['form','制作形式',100],['markets','目标市场',500],['language','语言',200],['channel','发行渠道',200],['source_rights','来源与改编备注',1000]] as const).map(([name,label,max])=><Form.Item key={name} name={name} label={label} rules={[{required:!['language','channel','source_rights'].includes(name),whitespace:true}]}>{['plot','conflict','characters','source_rights'].includes(name)?<Input.TextArea rows={name==='plot'?4:2} maxLength={max}/>:<Input maxLength={max}/>}</Form.Item>)}
 </Form></AppModal>;
}
