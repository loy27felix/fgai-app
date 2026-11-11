import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { App, Button, Input, Slider } from "antd";
import { Upload, RotateCcw } from "lucide-react";
import { useMeilinCompanion } from "@/hooks/use-meilin-companion";
import { useUserStore } from "@/stores/use-user-store";
import { updateMeilinCompanion, type MeilinCompanion } from "@/services/api/meilin-companion";
import { uploadResourceFile } from "@/services/api/resources";

export function MeilinCompanionSettings() {
    const companion = useMeilinCompanion();
    const queryClient = useQueryClient();
    const { message } = App.useApp();
    const input = useRef<HTMLInputElement>(null);
    const userId = useUserStore((state) => state.user?.id);
    const [draft, setDraft] = useState<MeilinCompanion>();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    useEffect(() => { setDraft(companion.data); }, [companion.data]);

    const save = async (file?: File, reset = false) => {
        if (!draft || busy) return;
        const owner = userId;
        setBusy(true);
        setError("");
        try {
            let value = { ...draft, ...(reset ? { name: "美林", resourceId: "", height: 160 } : {}) };
            if (file) {
                if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type) || file.size > 10 * 1024 * 1024) throw new Error("请选择 10 MB 以内的 PNG、JPEG、WebP 或 GIF");
                const resource = await uploadResourceFile(file, "image");
                value = { ...value, resourceId: resource.id };
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
                {companion.imageUrl ? <img src={companion.imageUrl} alt="我的助手形象" className="mx-auto h-40 w-40 object-contain" /> : <p className="text-sm opacity-60">{draft.resourceId ? "正在读取形象图片" : "使用平台默认形象"}</p>}
                {companion.imageError ? <p role="alert" className="text-sm">形象图片暂时无法显示，可重新上传或恢复默认。</p> : null}
                <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void save(file); }} />
                <Button icon={<Upload className="size-4" />} loading={busy} onClick={() => input.current?.click()}>上传我的形象</Button>
                <p className="text-xs opacity-60">支持透明 PNG、JPEG、WebP、GIF，最大 10 MB。上传后立即保存。</p>
                <label className="block"><span>形象大小</span><Slider min={80} max={280} value={draft.height} disabled={busy} onChange={(height) => setDraft({ ...draft, height })} /></label>
                {error ? <div role="alert" className="space-y-2 text-sm"><p>{error}</p><Button disabled={busy} onClick={() => companion.refetch()}>重新读取设置</Button></div> : null}
                <div className="flex flex-wrap gap-2"><Button type="primary" loading={busy} onClick={() => void save()}>保存名字与大小</Button><Button disabled={busy} icon={<RotateCcw className="size-4" />} onClick={() => void save(undefined, true)}>恢复默认</Button></div>
            </> : null}
        </div>
    );
}
