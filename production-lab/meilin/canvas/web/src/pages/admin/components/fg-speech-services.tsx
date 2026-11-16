import {useEffect,useState} from 'react';
import {Alert,Button,Table,Tag} from 'antd';
import {http} from '@/services/api/request';
type SpeechService={id:string;name:string;capability:string;description:string;enabled:boolean};
export function FGSpeechServices(){
 const [data,setData]=useState<{credentialConfigured:boolean;services:SpeechService[]}>(),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 async function load(signal?:AbortSignal){setLoading(true);try{const d=await http.get<{credentialConfigured:boolean;services:SpeechService[]}>('/fg/speech/services',{signal});if(!signal?.aborted){setData(d);setError('');}}catch(e){if(!signal?.aborted)setError(e instanceof Error?e.message:'专用服务读取失败');}finally{if(!signal?.aborted)setLoading(false);}}
 useEffect(()=>{const controller=new AbortController();void load(controller.signal);return()=>controller.abort();},[]);
 return <section className="mt-5" aria-label="火山引擎识别与翻译服务"><h3 className="font-semibold mb-2">识别与翻译服务</h3><Alert showIcon className="mb-3" type="info" message="火山引擎共接入 5 项能力：2 个音频生成模型，以及以下 3 项专用服务" description="上方模型列表用于生成音频。以下服务用于实时转写、录音识别与文本翻译，走各自的专用接口，因此不会出现在音频生成模型选择器中。"/>{error&&<Alert type="error" message={error} action={<Button onClick={()=>void load()}>重试</Button>}/>}<Table<SpeechService> rowKey="id" loading={loading} pagination={false} dataSource={data?.services||[]} columns={[{title:'服务',dataIndex:'name'},{title:'型号',dataIndex:'id'},{title:'用途',dataIndex:'description'},{title:'状态',render:(_,service)=><Tag color={service.enabled?'green':'default'}>{service.enabled?'已启用':data?.credentialConfigured?'未启用':'凭证未配置'}</Tag>}]} /></section>;
}
