import { useEffect, useState } from "react";
import { Alert, App, Button, Input, Popconfirm } from "antd";
import { http } from "@/services/api/request";

type PersonalGPT = { baseUrl: string; configured: boolean; model: string; reasoningEffort: string };
const defaultURL = "https://api.ten-rings.adtensor.com/llm/v1";

export function PersonalGPTPane() {
    const { message } = App.useApp();
    const [status, setStatus] = useState<PersonalGPT | null>(null);
    const [baseUrl, setBaseUrl] = useState(defaultURL);
    const [key, setKey] = useState("");
    const [busy, setBusy] = useState(true);
    const [error, setError] = useState("");
    useEffect(() => {
        let active = true;
        void http.get<PersonalGPT>("/settings/personal-gpt").then(value => { if (active) { setStatus(value); setBaseUrl(value.baseUrl); } }).catch(e => { if (active) setError(e instanceof Error ? e.message : "配置读取失败"); }).finally(() => { if (active) setBusy(false); });
        return () => { active = false; };
    }, []);
    const save = async () => {
        setBusy(true); setError("");
        try { const value = await http.put<PersonalGPT>("/settings/personal-gpt", { baseUrl, apiKey: key }); setStatus(value); setBaseUrl(value.baseUrl); setKey(""); message.success("个人 GPT 配置已加密保存"); }
        catch (e) { setError(e instanceof Error ? e.message : "保存失败，输入已保留"); }
        finally { setBusy(false); }
    };
    const remove = async () => {
        setBusy(true); setError("");
        try { await http.delete("/settings/personal-gpt"); setStatus(null); setBaseUrl(defaultURL); setKey(""); message.success("个人 GPT Key 已移除"); }
        catch (e) { setError(e instanceof Error ? e.message : "移除失败"); }
        finally { setBusy(false); }
    };
    return <>
        <div className="settings-pane-header"><div><h2>GPT 接入</h2><p>短剧 Agent 和画布等文本创作使用你自己的 Trings 账户。</p></div></div>
        <div className="settings-section space-y-5">
            <Alert type={status?.configured ? "success" : "info"} showIcon message={status?.configured ? "已配置个人 Key · GPT6.1 Sol · 默认 high 思考" : "请先填写自己的 API Key，再使用 GPT 文本功能"} />
            {error ? <Alert role="alert" type="error" showIcon message={error} /> : null}
            <label className="grid gap-2 text-sm"><span>API URL</span><Input value={baseUrl} disabled={busy} onChange={e => setBaseUrl(e.target.value)} placeholder={defaultURL} /></label>
            <label className="grid gap-2 text-sm"><span>API Key</span><Input.Password autoComplete="new-password" value={key} disabled={busy} onChange={e => setKey(e.target.value)} placeholder={status?.configured ? "已加密保存；留空保留当前 Key，填写新值则更新" : "粘贴你自己的 Trings API Key"} /></label>
            <p className="text-sm leading-6 text-foreground/60">Key 按账号在服务端加密保存，不会回显或共享给其他成员。更换 API URL 时需重新填写 Key。GPT 使用量记录在任务中，FG 不扣内部额度；Trings 侧费用与额度以你自己的账户为准。图片生成继续使用 WeToken。</p>
            <div className="flex gap-3"><Button type="primary" loading={busy} onClick={() => void save()}>保存 GPT 配置</Button><Popconfirm title="移除自己的 GPT Key？" description="移除后无法提交新的 GPT 文本任务，已有作品保留。" onConfirm={remove} okText="移除" cancelText="保留"><Button danger disabled={busy || !status?.configured}>移除 Key</Button></Popconfirm></div>
        </div>
    </>;
}
