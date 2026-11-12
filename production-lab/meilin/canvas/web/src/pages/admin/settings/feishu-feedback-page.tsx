import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Alert, Button, Card, Form, Input, InputNumber, Space, Switch, Typography } from "antd";
import { getFeishuFeedbackSettings, saveFeishuFeedbackSettings, previewFeishuFeedbackDigest, type FeishuFeedbackInput } from "@/services/api/feishu-feedback";

export default function FeishuFeedbackPage() {
    const { message } = App.useApp();
    const client = useQueryClient();
    const query = useQuery({ queryKey: ["admin", "feishu-feedback"], queryFn: getFeishuFeedbackSettings });
    const [saving, setSaving] = useState(false);
    const [previewing, setPreviewing] = useState(false);
    const [preview, setPreview] = useState("");
    const [error, setError] = useState("");
    async function save(values: FeishuFeedbackInput) {
        setSaving(true); setError("");
        try {
            const result = await saveFeishuFeedbackSettings(values);
            client.setQueryData(["admin", "feishu-feedback"], result);
            message.success(result.enabled ? "飞书配置已保存，自动发送已开启" : "飞书配置已保存，自动发送保持关闭");
        } catch (e) { setError(e instanceof Error ? e.message : "保存失败"); }
        finally { setSaving(false); }
    }
    async function loadPreview() {
        setPreviewing(true); setError("");
        try { setPreview((await previewFeishuFeedbackDigest()).text); }
        catch (e) { setError(e instanceof Error ? e.message : "预览失败"); }
        finally { setPreviewing(false); }
    }
    return <div className="mx-auto max-w-4xl space-y-5 p-5">
        <header><Typography.Title level={3}>飞书反馈与日报</Typography.Title><p>配置反馈接入和每日汇总。与现有自助排查机器人、余额通知分别管理。</p></header>
        <Alert type="info" showIcon title="默认不自动发送" description="可以先保存配置和预览日报。只有明确开启下方开关并保存，才会按设定时间向接收群发送；预览不会发送消息。" />
        {error && <Alert type="error" showIcon title={error} />}
        {query.isError && <Alert type="error" title="配置读取失败" action={<Button onClick={() => query.refetch()}>重试</Button>} />}
        <Card loading={query.isPending}>
            {query.data && <Form<FeishuFeedbackInput> key={query.data.appId + String(query.data.enabled)} layout="vertical" initialValues={query.data} onFinish={save}>
                <Form.Item name="enabled" label="接入与自动日报" valuePropName="checked" extra="关闭时不接收飞书反馈，也不自动发送日报；仍可保存凭据和预览。"><Switch checkedChildren="开启" unCheckedChildren="关闭" /></Form.Item>
                <Form.Item name="appId" label="飞书应用 App ID"><Input autoComplete="off" /></Form.Item>
                <Form.Item name="appSecret" label="App Secret" extra={query.data.appSecretSet ? "已配置，留空保留原值" : "尚未配置"}><Input.Password autoComplete="new-password" /></Form.Item>
                <Form.Item name="verificationToken" label="Verification Token" extra={query.data.verificationTokenSet ? "已配置，留空保留原值" : "用于校验事件回调"}><Input.Password autoComplete="new-password" /></Form.Item>
                <Form.Item name="encryptKey" label="Encrypt Key" extra={query.data.encryptKeySet ? "已配置，留空保留原值" : "事件加密密钥（可选）"}><Input.Password autoComplete="new-password" /></Form.Item>
                <Form.Item name="adminChatId" label="日报接收群 Chat ID"><Input autoComplete="off" placeholder="oc_…" /></Form.Item>
                <Form.Item name="baseUrl" label="服务地址" extra="通常留空使用飞书官方服务。"><Input placeholder="https://open.feishu.cn" /></Form.Item>
                <Form.Item name="timezone" label="时区" rules={[{required:true}]}><Input placeholder="Asia/Shanghai" /></Form.Item>
                <Space><Form.Item name="digestHour" label="发送小时"><InputNumber min={0} max={23} /></Form.Item><Form.Item name="digestMinute" label="发送分钟"><InputNumber min={0} max={59} /></Form.Item></Space>
                <p className="mb-4 text-sm opacity-70">事件回调路径：<code>/fg-six/api/integrations/feishu/events</code>。需填写平台的公网 HTTPS 地址及此路径。</p>
                <Space><Button type="primary" htmlType="submit" loading={saving}>保存配置</Button><Button loading={previewing} onClick={() => void loadPreview()}>预览今日日报（不发送）</Button></Space>
            </Form>}
        </Card>
        {preview && <Card title="日报预览"><pre className="whitespace-pre-wrap break-words text-sm">{preview}</pre></Card>}
    </div>;
}
