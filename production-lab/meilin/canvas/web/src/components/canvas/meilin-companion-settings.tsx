import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Input, Radio, Select, Slider } from "antd";
import { Upload, RotateCcw } from "lucide-react";
import { useMeilinCompanion } from "@/hooks/use-meilin-companion";
import { useUserStore } from "@/stores/use-user-store";
import { companionAssetURL, updateMeilinCompanion, uploadCompanionPackage, type MeilinCompanion } from "@/services/api/meilin-companion";
import { uploadResourceFile } from "@/services/api/resources";
import { AGENT_AVATAR_STATES, isAgentAvatarBundleManifest, suggestedAgentAvatarClipStates } from "@/lib/canvas/agent-appearance";
import { Live2DAvatar } from "./live2d-avatar";
import { AgentAvatarVideo } from "./agent-avatar-video";
import { FluidOrb } from "@/components/ui/fluid-orb";
import { useLive2DImport } from "@/hooks/use-live2d-import";

export function MeilinCompanionSettings() {
    const companion = useMeilinCompanion();
    const queryClient = useQueryClient();
    const { message } = App.useApp();
    const prepareLive2D = useLive2DImport();
    const input = useRef<HTMLInputElement>(null);
    const packageInput = useRef<HTMLInputElement>(null);
    const userId = useUserStore((state) => state.user?.id);
    const [draft, setDraft] = useState<MeilinCompanion>();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [previewClip, setPreviewClip] = useState("");
    useEffect(() => { setDraft(companion.data); }, [companion.data]);
    const manifest = useQuery({
        queryKey: [...companion.queryKey, "bundle-manifest", draft?.avatarBundleResourceId],
        enabled: draft?.avatarType === "bundle" && !!draft.avatarBundleResourceId,
        queryFn: async ({signal}) => {
            const response = await fetch(companionAssetURL("bundle", draft!.avatarBundleResourceId!, "avatar.json"), {credentials:"include", signal});
            if (!response.ok) throw new Error(`动画包读取失败（HTTP ${response.status}）`);
            const value: unknown = await response.json();
            if (!isAgentAvatarBundleManifest(value)) throw new Error("动画包格式无效");
            return value;
        },
    });
    const clip = manifest.data && (manifest.data.clips[previewClip] ? previewClip : Object.keys(manifest.data.clips)[0]);

    const save = async (file?: File, reset = false, packageKind?: "live2d" | "bundle") => {
        if (!draft || busy) return;
        const owner = userId;
        setBusy(true);
        setError("");
        try {
            let value = { ...draft, ...(reset ? { name: "美林", resourceId: "", height: 160, avatarType: "site" as const, live2dResourceId:"", live2dEntry:"", avatarBundleResourceId:"", avatarClipStates: {}, orbColor:"#7164f6" } : {}) };
            if (file && packageKind) {
                if (!file.name.toLowerCase().endsWith(".zip") || file.size > 128 * 1024 * 1024) throw new Error("请选择 128 MiB 以内的完整 ZIP 资源包");
                const prepared = packageKind === "live2d" ? await prepareLive2D(file) : file;
                if (!prepared || useUserStore.getState().user?.id !== owner) return;
                const resource = await uploadCompanionPackage(prepared, packageKind);
                value = packageKind === "live2d" ? { ...value, avatarType:"live2d", live2dResourceId:resource.resourceId, live2dEntry:resource.entry || "" } : { ...value, avatarType:"bundle", avatarBundleResourceId:resource.resourceId, avatarClipStates:resource.manifest ? suggestedAgentAvatarClipStates(resource.manifest) : {} };
            } else if (file) {
                if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type) || file.size > 10 * 1024 * 1024) throw new Error("请选择 10 MB 以内的 PNG、JPEG、WebP 或 GIF");
                const resource = await uploadResourceFile(file, "image");
                value = { ...value, avatarType:"image", resourceId: resource.id };
            }
            if (useUserStore.getState().user?.id !== owner) return;
            value = await updateMeilinCompanion(value);
            if (useUserStore.getState().user?.id !== owner) return;
            queryClient.setQueryData(companion.queryKey, value);
            setDraft(value);
            message.success("助手形象已保存到你的账号");
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="thin-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
            <p className="text-sm opacity-70">给你的助手起个名字，上传喜欢的形象。账号内保存，进入画布后会跟随当前画布工作。</p>
            {companion.isLoading ? <p role="status">正在读取形象…</p> : null}
            {companion.isError ? <div role="alert"><p>形象设置读取失败</p><Button onClick={() => companion.refetch()}>重新读取</Button></div> : null}
            {draft ? <>
                <label className="block space-y-2"><span>助手名字</span><Input maxLength={24} value={draft.name} disabled={busy} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
                <Radio.Group aria-label="助手形象类型" disabled={busy} value={draft.avatarType || (draft.resourceId ? "image" : "site")} onChange={(event) => setDraft({...draft, avatarType:event.target.value})} options={[{value:"site",label:"跟随平台"},{value:"orb",label:"动态球"},{value:"image",label:"图片 / GIF"},{value:"live2d",label:"Live2D"},{value:"bundle",label:"状态动画包"}]} />
                {draft.avatarType === "orb" ? <div className="space-y-3"><FluidOrb size={80} color={draft.orbColor || "#7164f6"} /><label>动态球颜色 <input aria-label="动态球颜色" type="color" value={draft.orbColor || "#7164f6"} onChange={(e) => setDraft({...draft, orbColor:e.target.value})} /></label></div> : draft.avatarType === "live2d" && draft.live2dResourceId && draft.live2dEntry ? <Live2DAvatar url={companionAssetURL("live2d", draft.live2dResourceId, draft.live2dEntry)} width={200} height={240} reducedMotion={false} onError={setError} /> : draft.avatarType === "bundle" && clip && manifest.data ? <AgentAvatarVideo src={companionAssetURL("bundle", draft.avatarBundleResourceId!, manifest.data.clips[clip])} className="mx-auto h-48 w-48" onError={() => setError("动画文件预览失败，请检查包内视频")} /> : (!draft.avatarType || draft.avatarType === "image") && companion.imageUrl ? <img src={companion.imageUrl} alt="我的助手形象" className="mx-auto h-40 max-w-full object-contain" /> : <p className="text-sm opacity-60">{draft.avatarType === "site" ? "使用平台默认形象" : "请上传对应形象资源"}</p>}
                {manifest.isError && draft.avatarType === "bundle" && <p role="alert">{manifest.error.message}<Button onClick={() => manifest.refetch()}>重试</Button></p>}
                {companion.imageError ? <p role="alert" className="text-sm">形象图片暂时无法显示，可重新上传或恢复默认。</p> : null}
                <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void save(file); }} />
                <input ref={packageInput} type="file" accept=".zip,application/zip" hidden onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value=""; if (file && (draft.avatarType === "live2d" || draft.avatarType === "bundle")) void save(file, false, draft.avatarType); }} />
                {draft.avatarType === "live2d" || draft.avatarType === "bundle" ? <><Button icon={<Upload className="size-4" />} loading={busy} onClick={() => packageInput.current?.click()}>上传我的{draft.avatarType === "live2d" ? " Live2D" : "状态动画"} ZIP</Button><p className="text-xs opacity-60">最大 128 MiB。Live2D 包需包含 model3.json、moc3 和纹理；含多套模型时可选择，系统自动整理运行文件。状态动画包根目录包含 avatar.json 和对应 MP4。上传后立即保存到本人账号，不改变其他用户。状态动画支持绿幕抠像。请使用有权使用的素材。</p></> : <><Button icon={<Upload className="size-4" />} loading={busy} onClick={() => input.current?.click()}>上传图片 / GIF</Button><p className="text-xs opacity-60">支持透明 PNG、JPEG、WebP、GIF，最大 10 MB。上传后立即保存；保留原始比例，透明背景效果更好。</p></>}
                {draft.avatarType === "bundle" && manifest.data && <div className="space-y-2"><label>预览片段 <Select className="w-48" value={clip} onChange={setPreviewClip} options={Object.keys(manifest.data.clips).map((value) => ({value,label:value}))} /></label>{AGENT_AVATAR_STATES.map((state) => <label key={state.id} className="flex items-center justify-between gap-3"><span>{state.label}</span><Select className="w-48" value={draft.avatarClipStates?.[state.id] || suggestedAgentAvatarClipStates(manifest.data!)[state.id]} onChange={(value) => setDraft({...draft,avatarClipStates:{...draft.avatarClipStates,[state.id]:value}})} options={Object.keys(manifest.data!.clips).map((value) => ({value,label:value}))} /></label>)}</div>}
                <label className="block"><span>形象大小</span><Slider min={80} max={280} value={draft.height} disabled={busy} onChange={(height) => setDraft({ ...draft, height })} /></label>
                {error ? <div role="alert" className="space-y-2 text-sm"><p>{error}</p><Button disabled={busy} onClick={() => companion.refetch()}>重新读取设置</Button></div> : null}
                <div className="flex flex-wrap gap-2"><Button type="primary" loading={busy} onClick={() => void save()}>保存助手设置</Button><Button disabled={busy} icon={<RotateCcw className="size-4" />} onClick={() => void save(undefined, true)}>恢复默认</Button></div>
            </> : null}
        </div>
    );
}
