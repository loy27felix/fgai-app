import {useEffect,useState} from 'react';
import {Alert,Button,Table,Tag} from 'antd';
import {http} from '@/services/api/request';
import type {ModelCapabilityConfig} from '@/lib/model-capabilities';
type Row={model:string;capability:string;enabled:boolean;collectedAt:string;profile:ModelCapabilityConfig;quote:{estimatedCny:number|null;discount:number|null;fx:number;lines:string[];notes:string[]};evidence:Array<{operation:string;status:string;error:string;updatedAt:string}>};

function ModelParameters({profile}:{profile:ModelCapabilityConfig}){
 const image=profile.image,video=profile.video;
 const operations:Record<string,string>={text_to_video:'文生视频',image_to_video:'首帧图生视频',reference_to_video:'参考素材生成'};
 return <div>
 {image&&<><div>尺寸 / 比例：{image.size.presets?.length?[...new Set(image.size.presets.map(x=>`${x.tier.toUpperCase()} · ${x.ratio}`))].join('，'):image.size.values.join('，')} · {image.size.allowCustom?'允许自定义尺寸':'从模型支持比例中选择'}</div><div>质量：{image.quality.supported?image.quality.values.join('，'):'模型固定'} · 参考图片最多 {image.references.maxImages} 张 · {image.references.maxImageBytes?'单图上限 '+image.references.maxImageBytes/1024/1024+' MB':'未设置未经核实的单图上限'}</div>{image.size.constraints&&<div>自定义总像素：{image.size.constraints.minPixels}–{image.size.constraints.maxPixels}，宽高比 1:{image.size.constraints.maxRatio}–{image.size.constraints.maxRatio}:1</div>}</>}
 {video&&<><div>生成方式：{video.operations.map(x=>operations[x]||x).join('，')}</div><div>比例：{video.ratios.join('，')} · 分辨率：{video.resolutions.join('，')} · 时长：{video.duration.values?.join('、')||`${video.duration.min}–${video.duration.max}`} 秒</div><div>参考图片 {video.references.minImages}–{video.references.maxImages} 张 · 视频最多 {video.references.maxVideos} 段 · 音频最多 {video.references.maxAudios} 段 · 声音生成：{video.generateAudio.supported?'支持':'不支持'}</div></>}
 <small>以上为当前开放参数；单次生成测试不代表全部组合均已实测。</small>
 {video?.references.maxTotalVideoDurationSeconds&&<div>参考图小于 {video.references.maxImageBytes/1024/1024} MB；单视频 ≤ {video.references.maxVideoBytes/1024/1024} MB，{video.references.minVideoDurationSeconds}–{video.references.maxVideoDurationSeconds} 秒，累计 ≤ {video.references.maxTotalVideoDurationSeconds} 秒；单音频 ≤ {video.references.maxAudioBytes/1024/1024} MB，{video.references.minAudioDurationSeconds}–{video.references.maxAudioDurationSeconds} 秒，累计 ≤ {video.references.maxTotalAudioDurationSeconds} 秒。</div>}
 </div>;
}
export function FGModelPrices(){
 const [rows,setRows]=useState<Row[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function load(){setBusy(true);try{setRows((await http.get<{models:Row[]}>('/fg/models/prices')).models);setError('');}catch(e){setError(e instanceof Error?e.message:'读取费率失败');}finally{setBusy(false);}}
 useEffect(()=>{void load();},[]);
 return <section><h2 className="fg-finance-title">模型能力、账户折扣与人民币费率 <Button size="small" loading={busy} onClick={()=>void load()}>刷新列表</Button></h2>
 {error&&<Alert type="error" message={error}/>}
 <Table<Row> rowKey="model" dataSource={rows} pagination={{pageSize:8}} scroll={{x:900}} loading={busy} expandable={{expandedRowRender:row=><div style={{lineHeight:1.9}}><ModelParameters profile={row.profile}/>{row.quote.lines.map((x,i)=><div key={'p'+i}>{x}</div>)}{row.quote.notes.map((x,i)=><div key={'n'+i}>{x}</div>)}<div>采集 {new Date(row.collectedAt).toLocaleString('zh-CN')} · 人民币换算系数 {row.quote.fx}</div>{row.evidence.map((e,i)=><div key={'e'+i}>{e.operation} · {e.status==='succeeded'?'实际生成成功':e.status==='failed'?'失败：'+e.error:e.status} · {new Date(e.updatedAt).toLocaleString('zh-CN')}</div>)}</div>}} columns={[
 {title:'模型',dataIndex:'model',width:290},
 {title:'类型',dataIndex:'capability',render:(v:string)=>(({text:'文本',image:'图片',video:'视频'} as Record<string,string>)[v]||v)},
 {title:'可用性',render:(_,r)=>!r.enabled?<Tag color="red">供应商路由待恢复</Tag>:r.evidence.some(e=>e.status==='succeeded')?<Tag color="green">实际生成已验证</Tag>:<Tag color="gold">待生成验证</Tag>},
 {title:'账户折扣',render:(_,r)=>r.quote.discount===null?'待核验':(r.quote.discount*100).toLocaleString()+'%'},
 {title:'费率 / 默认参数预估',width:300,render:(_,r)=><>{r.quote.estimatedCny!==null&&<strong>预计 ¥{r.quote.estimatedCny.toLocaleString('zh-CN',{maximumFractionDigits:4})}<br/></strong>}<small>{r.quote.lines[0]||'详细费率待确认'}<br/>展开查看不同参数价格与测试记录</small></>},
 ]}/></section>;
}
