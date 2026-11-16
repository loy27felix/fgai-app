import {useEffect,useState} from "react";
import {Form,Input,Select,message} from "antd";
import {AppModal} from "@/components/ui/product/app-modal";
import {http} from "@/services/api/request";

export function FGInspirationEditor({open,onClose,onSaved}:{open:boolean;onClose:()=>void;onSaved:()=>void}){
 const [form]=Form.useForm();const [saving,setSaving]=useState(false);const [toast,context]=message.useMessage();
 useEffect(()=>{if(open){form.resetFields();form.setFieldsValue({kind:"image"});}},[open,form]);
 async function save(){
  let values;try{values=await form.validateFields();}catch{return;}
  setSaving(true);try{await http.post("/fg/inspiration/custom",{...values,tags:(values.tags||"").split(/[,，]/).map((v:string)=>v.trim()).filter(Boolean)});void toast.success("灵感已保存到我的灵感");onSaved();onClose();}
  catch(error){void toast.error(error instanceof Error?error.message:"保存失败");}finally{setSaving(false);}
 }
 return <>{context}<AppModal open={open} title="新建我的灵感" onCancel={onClose} onOk={()=>void save()} okText="保存灵感" confirmLoading={saving} width={680} destroyOnHidden>
  <p className="fg-inspiration-editor-note">您创建的灵感对全员可见；收藏保存在各自账号下。</p>
  <Form form={form} layout="vertical">
   <Form.Item name="title" label="标题" rules={[{required:true,whitespace:true,message:"请输入标题"},{max:240}]}><Input maxLength={240}/></Form.Item>
   <Form.Item name="kind" label="创作类型" rules={[{required:true}]}><Select options={[{value:"image",label:"图片"},{value:"video",label:"视频"},{value:"text",label:"文本"}]}/></Form.Item>
   <Form.Item name="prompt" label="提示词" rules={[{required:true,whitespace:true,message:"请输入提示词"},{max:60000}]}><Input.TextArea rows={7} maxLength={60000}/></Form.Item>
   <Form.Item name="description" label="说明"><Input.TextArea rows={2} maxLength={2000}/></Form.Item>
   <div className="fg-inspiration-editor-row"><Form.Item name="category" label="分类"><Input maxLength={100} placeholder="例如：手持 UGC Vlog"/></Form.Item><Form.Item name="tags" label="标签"><Input placeholder="用逗号分隔" maxLength={1000}/></Form.Item></div>
   <Form.Item name="cover" label="封面地址（可选）" rules={[{type:"url",message:"请输入 HTTPS 图片地址"},{validator:(_,value)=>!value||value.startsWith("https://")?Promise.resolve():Promise.reject(new Error("请使用 HTTPS 地址"))}]}><Input placeholder="https://…"/></Form.Item>
   <Form.Item name="sourceUrl" label="原始出处（可选）" rules={[{type:"url",message:"请输入有效网址"}]}><Input placeholder="https://…"/></Form.Item>
   <div className="fg-inspiration-editor-row"><Form.Item name="author" label="作者"><Input maxLength={120}/></Form.Item><Form.Item name="license" label="许可 / 使用说明"><Input maxLength={120}/></Form.Item></div>
  </Form>
 </AppModal></>;
}
