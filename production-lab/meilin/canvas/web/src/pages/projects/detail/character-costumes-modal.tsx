import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, App, Button, Image, Input, Space, Upload } from "antd";
import { AppModal } from "@/components/ui/product/app-modal";
import { ModelPicker } from "@/components/model-picker";
import { ImageSettingsPanel } from "@/components/image-settings-panel";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { shortDramaMediaDefault } from "@/lib/short-drama-models";
import { getProjectCharacter, replaceProjectCharacterRepresentations, type ProjectAsset, type CharacterRepresentation } from "@/services/api/projects";
import { resourceFileUrl, resourceStorageKey, uploadResourceFile } from "@/services/api/resources";
import { submitBackendGenerationTask } from "@/services/api/generation-task";
import { queryGenerationTask } from "@/services/api/task-center";
import { characterTurnaroundConfig } from "./project-character-media";
import { canvasThemes } from "@/lib/canvas-theme";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import { projectCharacterCover } from "./project-character-cover";

export function CharacterCostumesModal({projectId, asset, onClose, onRefresh, onSelect, initialRole="reference"}: {
    projectId:string; asset:ProjectAsset; onClose:()=>void; onRefresh:()=>void;
    initialRole?:string;
    onSelect?:(versionId:string,role:string)=>Promise<void>;
}) {
    const {message}=App.useApp(), effective=useEffectiveConfig();
    const theme=canvasThemes[useActiveTheme()];
    const character=useQuery({queryKey:["project",projectId,"character-costumes",asset.id],queryFn:()=>getProjectCharacter(projectId,asset.id)});
    const [selected,setSelected]=useState(initialRole), [name,setName]=useState(""), [clothing,setClothing]=useState("");
    const [file,setFile]=useState<File>(), [busy,setBusy]=useState(false),[error,setError]=useState("");
    const [taskId,setTaskId]=useState("");
    const [config,setConfig]=useState(()=>{const model=shortDramaMediaDefault(effective,"image");return characterTurnaroundConfig({...effective,model,imageModel:model});});
    const task=useQuery({queryKey:["character-costume-task",taskId],queryFn:()=>queryGenerationTask(taskId),enabled:Boolean(taskId),refetchInterval:q=>q.state.data && ["succeeded","failed","cancelled"].includes(q.state.data.status)?false:2000});
    const generating=Boolean(taskId && (!task.data || ["queued","running"].includes(task.data.status)));
    useEffect(()=>{if(task.data?.status==="succeeded"){void character.refetch();onRefresh();}},[task.data?.status]);
    const card=character.data?.character;
    const cover=projectCharacterCover(card?.representations);
    const looks=card?.representations.filter(r=>r.role.startsWith("costume:"))||[];
    const selectedImage=selected==="reference"?cover:looks.find(r=>r.role===selected);
    const prompt=[`为角色“${asset.title}”制作同一身份的新服装三视图。严格参考图片1的脸、发型、物种、年龄和体型，不换演员、不改变性别。`,
        `新造型名称：${name}。服装与配饰：${clothing}。只替换服装、鞋和明确指定的配饰，人物身份保持一致。`,
        "正面、侧面、背面全身，统一中性背景，自然站姿，服装结构与材质清晰。无文字、标签、水印和额外人物。"].join("\n\n");
    const refresh=async()=>{await character.refetch();onRefresh();};
    const save=async(generate:boolean)=>{
        setBusy(true);setError("");
        try {
            const latest=await getProjectCharacter(projectId,asset.id), base=projectCharacterCover(latest.character.representations);
            if(!name.trim()||!clothing.trim())throw new Error("请填写造型名称和服装描述");
            if(generate){
                if(!base)throw new Error("请先给角色绑定默认参考图，用于锁定同一张脸");
                const created=await submitBackendGenerationTask({projectId,mode:"image",prompt,config,referenceImages:[{id:asset.id,name:asset.title,type:"image/*",dataUrl:"",url:resourceFileUrl(base.resourceId),storageKey:resourceStorageKey(base.resourceId)}],clientOperationId:crypto.randomUUID(),metadata:{source:"project-character-costume",operation:"character_costume",assetId:asset.id,characterAssetId:asset.id,costumeName:name.trim(),costumeClothing:clothing.trim(),costumeBaseResourceId:base.resourceId}});
                setTaskId(created.id);message.success("换装任务已提交，完成后自动加入该角色；关闭窗口不影响任务");
            }else{
                if(!file)throw new Error("请选择该造型的图片");
                const resource=await uploadResourceFile(file,"image");
                await replaceProjectCharacterRepresentations(projectId,asset.id,[...latest.character.representations.map(r=>({role:r.role,resourceId:r.resourceId,metadata:r.metadata})),{role:`costume:${crypto.randomUUID().replaceAll("-","").slice(0,24)}`,resourceId:resource.id,metadata:{name:name.trim(),clothing:clothing.trim()}}],latest.character.versionId);
                setFile(undefined);await refresh();message.success("服装造型已加入，默认形象和声音保留");
            }
        }catch(e){setError(e instanceof Error?e.message:"保存造型失败");}finally{setBusy(false);}
    };
    const tile=(role:string,label:string,image?:CharacterRepresentation)=><button type="button" key={role} aria-pressed={selected===role} className={`rounded-lg border p-2 text-left ${selected===role?"border-blue-500 bg-blue-500/10":"border-border"}`} onClick={()=>setSelected(role)}>{image&&<img className="h-24 w-full object-contain" src={resourceFileUrl(image.resourceId)} alt={label}/>}<span className="block text-sm">{label}</span></button>;
    return <AppModal open title={`${asset.title} · 服装与造型`} width={880} onCancel={onClose} footer={<><Button onClick={onClose}>关闭</Button>{onSelect&&<Button type="primary" loading={busy} disabled={!selectedImage} onClick={async()=>{setBusy(true);try{await onSelect(card!.versionId,selected);onClose();}catch(e){setError(e instanceof Error?e.message:"选择失败");}finally{setBusy(false);}}}>本镜头使用此造型</Button>}</>}>
        <p className="mb-3 text-sm text-foreground/60">同一角色保留一张脸和声音，按镜头选择服装。切换只影响当前镜头；生成过的视频保留，可手动重新生成。一个镜头需要多套服装时，关闭本窗口，在镜头资产中点击“本镜头内换装”按时间段安排。</p>
        {(error||character.error)&&<Alert type="error" showIcon title={error||"角色读取失败，请重试"}/>}
        <div className="grid grid-cols-3 gap-3">{tile("reference","默认形象",cover)}{looks.map(r=>tile(r.role,r.metadata?.name||"服装造型",r))}</div>
        {selectedImage&&<div className="my-3"><Image src={resourceFileUrl(selectedImage.resourceId)} alt="当前选择的实际参考图" width="100%" height={180} style={{objectFit:"contain"}}/><p className="text-sm">{selectedImage.metadata?.clothing||"默认服装"}</p></div>}
        <details className="mt-4 rounded-lg border border-border p-3"><summary>新增服装造型 · 上传或生成</summary><Space orientation="vertical" className="mt-3 w-full">
            <Input aria-label="造型名称" placeholder="造型名称，例如：办公室正装、雨夜外套" value={name} onChange={e=>setName(e.target.value)}/>
            <Input.TextArea aria-label="服装描述" placeholder="说明衣服、鞋、配饰和材质；脸和声音保持一致" value={clothing} onChange={e=>setClothing(e.target.value)}/>
            <Upload accept="image/*" maxCount={1} fileList={file?[{uid:"costume",name:file.name,status:"done"}]:[]} beforeUpload={f=>{setFile(f);return false;}} onRemove={()=>setFile(undefined)}><Button>选择本地造型图片</Button></Upload>
            <Button disabled={!file||busy||!card} loading={busy} onClick={()=>void save(false)}>上传并保存造型</Button>
            <ModelPicker config={config} capability="image" value={config.imageModel||config.model} onChange={model=>setConfig(c=>characterTurnaroundConfig({...c,model,imageModel:model}))}/>
            <ImageSettingsPanel theme={theme} showCount={false} config={config} onConfigChange={(key,value)=>setConfig(c=>({...c,[key]:value}))}/>
            <Input.TextArea readOnly value={prompt} autoSize={{minRows:4,maxRows:8}} aria-label="换装图片生成提示词"/>
            <Button disabled={busy||generating||!card||!name.trim()||!clothing.trim()} loading={busy} onClick={()=>void save(true)}>确认提示词并生成造型（按模型计费）</Button>
            {taskId&&<Alert type={task.data?.status==="failed"?"error":"info"} title={task.data?.status==="succeeded"?"造型已生成并保存":task.data?.status==="failed"?task.data.error||"造型生成失败":task.error?"状态读取暂时失败，任务不会因此取消":"造型生成中，可关闭窗口后稍后查看"}/>}
        </Space></details>
    </AppModal>;
}
