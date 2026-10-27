import { useState } from "react";
import { Alert, Button, Image, InputNumber, Select, Space } from "antd";
import { AppModal } from "@/components/ui/product/app-modal";
import type { ProjectAsset, ShotAssetReference } from "@/services/api/projects";
import { resourceFileUrl } from "@/services/api/resources";
import { costumeImage, shotCostumeTimelines, validateShotCostumeTimeline, type CostumeSegment, type ShotCostumeTimeline } from "./shot-costume-timeline";

export function ShotCostumeTimelineModal({asset, reference, durationMs, actionBeatsJson, onClose, onSave}: {
    asset: ProjectAsset; reference: ShotAssetReference; durationMs: number; actionBeatsJson?: string;
    onClose: () => void; onSave: (timeline?: ShotCostumeTimeline) => Promise<void>;
}) {
    const representations = reference.referencedVersion?.representations || asset.character?.representations || [];
    const options = [{value:"reference",label:"默认形象"}, ...representations.filter(item=>item.role.startsWith("costume:")).map(item=>({value:item.role,label:item.metadata?.name || "服装造型"}))].filter(item=>Boolean(costumeImage(representations,item.value)));
    const existing = (()=>{try{return shotCostumeTimelines(actionBeatsJson).find(item=>item.assetId===asset.id);}catch{return undefined;}})();
    const makeSegment = (startMs: number, endMs: number, role: string): CostumeSegment => ({startMs,endMs,role,resourceId:costumeImage(representations,role)?.resourceId || ""});
    const [segments,setSegments] = useState<CostumeSegment[]>(()=>existing?.segments || [makeSegment(0,Math.floor(durationMs/2),options[0]?.value || "reference"),makeSegment(Math.floor(durationMs/2),durationMs,options[1]?.value || "reference")]);
    const [busy,setBusy] = useState(false), [error,setError] = useState("");
    const save = async (clear = false) => {
        setBusy(true);setError("");
        try {
            const plan: ShotCostumeTimeline = {kind:"character_costume_timeline",assetId:asset.id,assetVersionId:reference.assetVersionId,segments};
            if (!clear) validateShotCostumeTimeline(plan,durationMs,reference.assetVersionId,representations);
            await onSave(clear ? undefined : plan);
            onClose();
        } catch (e) { setError(e instanceof Error ? e.message : "换装时间轴保存失败"); }
        finally { setBusy(false); }
    };
    return <AppModal open title={`${asset.title} · 本镜头内换装`} width={760} onCancel={busy?undefined:onClose} footer={<><Button disabled={busy} onClick={onClose}>取消</Button>{existing&&<Button disabled={busy} onClick={()=>void save(true)}>取消分段换装</Button>}<Button type="primary" loading={busy} disabled={options.length<2} onClick={()=>void save()}>保存换装时间轴</Button></>}>
        <p className="mb-3 text-sm">当前镜头 {durationMs/1000} 秒。按剧情填写每套服装的使用时段，支持换装、回忆与现实交替；同一角色保留身份和声音。保存后可预览完整 Prompt，再确认生成视频。</p>
        {error&&<Alert type="error" showIcon title={error}/>}
        {options.length<2&&<Alert type="info" showIcon title="此角色版本还没有多套服装" description="关闭后点击“选择服装 / 参考图”添加造型；若角色库已有新版本，先更新本镜头的角色参考，再设置换装。"/>}
        <Space orientation="vertical" className="w-full mt-3">
            {segments.map((segment,index)=>{
                const image=costumeImage(representations,segment.role);
                return <div key={index} className="rounded-lg border border-border p-3 flex flex-wrap gap-3 items-center">
                    {image&&<Image src={resourceFileUrl(image.resourceId)} alt={`第${index+1}段实际服装参考图`} width={64} height={80} style={{objectFit:"contain"}}/>}
                    <div className="flex-1 min-w-48"><label className="block mb-2">第 {index+1} 段服装</label><Select aria-label={`第${index+1}段服装`} className="w-full" value={segment.role} options={options} onChange={role=>setSegments(rows=>rows.map((row,i)=>i===index?makeSegment(row.startMs,row.endMs,role):row))}/></div>
                    <div><label className="block mb-2">时间范围（秒）</label><InputNumber aria-label={`第${index+1}段开始秒数`} min={0} max={durationMs/1000} step={0.1} precision={3} value={segment.startMs/1000} onChange={value=>setSegments(rows=>rows.map((row,i)=>i===index?{...row,startMs:Math.round(Number(value)*1000)}:row))}/><span className="mx-2">至</span><InputNumber aria-label={`第${index+1}段结束秒数`} min={0} max={durationMs/1000} step={0.1} precision={3} value={segment.endMs/1000} onChange={value=>setSegments(rows=>rows.map((row,i)=>i===index?{...row,endMs:Math.round(Number(value)*1000)}:row))}/></div>
                    <Button disabled={segments.length<=2||busy} onClick={()=>setSegments(rows=>rows.filter((_,i)=>i!==index))}>移除</Button>
                </div>;
            })}
            <Button disabled={segments.length>=12||busy} onClick={()=>setSegments(rows=>{const last=rows[rows.length-1];const mid=Math.floor((last.startMs+last.endMs)/2);return [...rows.slice(0,-1),{...last,endMs:mid},makeSegment(mid,last.endMs,options.find(item=>item.value!==last.role)?.value||last.role)];})}>＋ 增加一个换装时段</Button>
        </Space>
        <Alert className="mt-3" type="info" title="每套造型占用一张参考图，仍受所选模型的参考数量限制" description="切换时机需与原提示词的剧情和动作时间轴一致。实拍换衣请留足动作时间；瞬间换装请在提示词中说明切镜或转场方式。"/>
    </AppModal>;
}
