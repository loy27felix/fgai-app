import { App, Alert, Button, Radio, Select, Space } from "antd";
import { useEffect, useState } from "react";
import { getPersonalAppearance, savePersonalAppearance } from "@/services/api/personal-appearance";
import { usePersonalAppearanceStore, type PersonalAppearance } from "@/stores/use-personal-appearance-store";
import { useUserStore } from "@/stores/use-user-store";

export function PersonalAppearancePane() {
    const { message } = App.useApp();
    const userId = useUserStore((s) => s.user?.id);
    const [draft, setDraft] = useState<PersonalAppearance | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    useEffect(() => {
        const controller = new AbortController();
        setDraft(null);
        setError("");
        if (userId) void getPersonalAppearance(controller.signal).then((value) => {
            if (!controller.signal.aborted && useUserStore.getState().user?.id === userId) setDraft(value);
        }).catch((e) => { if (!controller.signal.aborted) setError(String(e)); });
        return () => controller.abort();
    }, [userId]);
    async function save() {
        if (!draft || busy) return;
        setBusy(true); setError("");
        try {
            const value = await savePersonalAppearance(draft);
            if (useUserStore.getState().user?.id !== userId || value.userId !== userId) return;
            setDraft(value);
            usePersonalAppearanceStore.getState().setValue(value);
            message.success("个人外观已保存，将随账号在其他设备恢复");
        } catch (e) { setError(e instanceof Error ? e.message : "保存失败，请重试"); }
        finally { setBusy(false); }
    }
    return <section aria-label="个人外观" className="space-y-6">
        <header><h2 className="text-lg font-semibold">把工作区，换成你喜欢的样子。</h2><p className="mt-2 text-sm text-foreground/60">仅改变你看到的主题和字体，不影响其他成员、工程内容或已保存的画布布局。</p></header>
        {error && <Alert type="error" title={error} action={<Button onClick={() => { setError(""); void getPersonalAppearance().then((v) => { if (v.userId === useUserStore.getState().user?.id) setDraft(v); }).catch((e) => setError(String(e))); }}>重新读取</Button>} />}
        {!draft ? <p role="status">正在读取个人外观…</p> : <>
            <div><h3 className="mb-3 font-medium">主题</h3><Radio.Group className="flex flex-wrap gap-3" aria-label="个人主题" value={draft.skinId} onChange={(e) => setDraft({ ...draft, skinId: e.target.value })} options={[{value:"site",label:"跟随平台默认"},{value:"classic",label:"FG 经典"},{value:"longying-ink",label:"龙影水墨"},{value:"yunhe-xianguan",label:"云鹤仙观"},{value:"sea-salt",label:"海盐蓝"},{value:"forest",label:"森林绿"},{value:"warm-paper",label:"暖纸"},{value:"rose",label:"玫瑰"},{value:"graphite",label:"石墨"}]} /></div>
            <div><h3 className="mb-3 font-medium">明暗模式</h3><Radio.Group aria-label="个人明暗模式" value={draft.mode} onChange={(e) => setDraft({ ...draft, mode: e.target.value })} options={[{value:"system",label:"跟随系统"},{value:"light",label:"浅色"},{value:"dark",label:"深色"}]} /></div>
            <div><h3 className="mb-3 font-medium">界面字体</h3><Select aria-label="界面字体" className="w-full sm:!w-72" value={draft.font} onChange={(font) => setDraft({ ...draft, font })} options={[{value:"theme",label:"跟随主题"},{value:"system",label:"系统字体"},{value:"sans",label:"无衬线 · 清晰简洁"},{value:"serif",label:"衬线 · 宋体风格"},{value:"wenkai",label:"文楷 · 温润阅读"},{value:"mono",label:"等宽 · 规整排版"},{value:"rounded",label:"圆体 · 系统圆体优先"}]} /><p className="mt-2 text-xs text-foreground/55">正文、菜单和标题使用所选字体；代码保持原来的等宽字体。圆体是否显示取决于设备已安装字体。</p><div className="mt-3 rounded-lg border p-4" style={{fontFamily: {theme:"inherit",system:"system-ui",sans:"Inter Variable, Microsoft YaHei, sans-serif",serif:"Longying Serif, SimSun, serif",wenkai:"Yunhe Display, KaiTi, serif",mono:"JetBrains Mono Variable, monospace",rounded:"ui-rounded, YouYuan, sans-serif"}[draft.font]}}>预览：把灵感，变成下一部作品。Meilin Creative Studio · 0123456789</div></div>
            <Space><Button type="primary" loading={busy} onClick={() => void save()}>保存个人外观</Button><Button disabled={busy} onClick={() => setDraft({ ...draft, skinId:"site", font:"theme", mode:"system" })}>恢复默认选项</Button></Space>
        </>}
    </section>;
}
