"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";
import localforage from "localforage";
import { BellRing, Bot, Camera, Clapperboard, Settings2, Sparkles, WandSparkles, X } from "lucide-react";

import { browserNotificationPermission, requestGenerationCompletionNotifications } from "@/reference/infinite-canvas/src/services/generation-notifications";

type CompanionProfile = {
    name: string;
    mission: string;
};

type Props = {
    status: string;
    busy?: boolean;
    agentLabel: string;
    onTask: (prompt: string, intent?: "chat" | "production") => void;
};

type CompletionDetail = {
    kind?: "image" | "video";
    title?: string;
    body?: string;
};

const PROFILE_KEY = "profile";
const AVATAR_KEY = "avatar";
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const DEFAULT_PROFILE: CompanionProfile = {
    name: "小光",
    mission: "盯住画布进度，在该确认、挑版本或继续出片时提醒我。",
};
const companionStore = localforage.createInstance({ name: "infinite-canvas", storeName: "agent_companion" });

function safeProfile(value: unknown): CompanionProfile {
    if (!value || typeof value !== "object") return DEFAULT_PROFILE;
    const candidate = value as Partial<CompanionProfile>;
    return {
        name: typeof candidate.name === "string" && candidate.name.trim() ? candidate.name.trim().slice(0, 24) : DEFAULT_PROFILE.name,
        mission: typeof candidate.mission === "string" ? candidate.mission.slice(0, 120) : DEFAULT_PROFILE.mission,
    };
}

function completionCopy(detail: CompletionDetail) {
    if (detail.kind === "video") return detail.body || "视频已经出片，去挑一个版本，或继续修改镜头。";
    if (detail.kind === "image") return detail.body || "图片已经生成，可以挑版本、局部修改，或接到下一段视频。";
    return detail.body || "画布有新的进度，来看看下一步。";
}

export function AgentCompanion({ status, busy = false, agentLabel, onTask }: Props) {
    const [profile, setProfile] = useState<CompanionProfile>(DEFAULT_PROFILE);
    const [avatarUrl, setAvatarUrl] = useState("");
    const [notice, setNotice] = useState("");
    const [open, setOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [wakeNotice, setWakeNotice] = useState("");
    const avatarUrlRef = useRef("");
    const wakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);
    const permission = browserNotificationPermission();

    useEffect(() => {
        let alive = true;
        void Promise.all([companionStore.getItem<CompanionProfile>(PROFILE_KEY), companionStore.getItem<Blob>(AVATAR_KEY)])
            .then(([savedProfile, savedAvatar]) => {
                if (!alive) return;
                setProfile(safeProfile(savedProfile));
                if (savedAvatar instanceof Blob && savedAvatar.size) {
                    const url = URL.createObjectURL(savedAvatar);
                    avatarUrlRef.current = url;
                    setAvatarUrl(url);
                }
            })
            .catch(() => setNotice("本地形象读取失败，已使用默认制作搭档。"));
        return () => {
            alive = false;
            if (avatarUrlRef.current) URL.revokeObjectURL(avatarUrlRef.current);
        };
    }, []);

    useEffect(() => {
        const receiveCompletion = (event: Event) => {
            const detail = (event as CustomEvent<CompletionDetail>).detail || {};
            setWakeNotice(completionCopy(detail));
            setOpen(true);
            setSettingsOpen(false);
            if (wakeTimerRef.current) clearTimeout(wakeTimerRef.current);
            wakeTimerRef.current = setTimeout(() => {
                setWakeNotice("");
                setOpen(false);
            }, 8500);
        };
        window.addEventListener("fg-generation-completed", receiveCompletion);
        return () => {
            window.removeEventListener("fg-generation-completed", receiveCompletion);
            if (wakeTimerRef.current) clearTimeout(wakeTimerRef.current);
        };
    }, []);

    function saveProfile(next: CompanionProfile) {
        const normalized = safeProfile(next);
        setProfile(normalized);
        void companionStore.setItem(PROFILE_KEY, normalized).catch(() => setNotice("名称已更新，但本地保存失败。"));
    }

    function onAvatarChange(event: ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        if (!file.type.startsWith("image/")) {
            setNotice("请上传 PNG、JPG、WebP 等图片作为搭档形象。");
            return;
        }
        if (file.size > MAX_AVATAR_BYTES) {
            setNotice("搭档形象请控制在 5 MB 以内。");
            return;
        }
        if (avatarUrlRef.current) URL.revokeObjectURL(avatarUrlRef.current);
        const url = URL.createObjectURL(file);
        avatarUrlRef.current = url;
        setAvatarUrl(url);
        setNotice("形象已保存到当前浏览器。可随时替换，不会进入画布素材。");
        void companionStore.setItem(AVATAR_KEY, file).catch(() => setNotice("图片预览成功，但本地保存失败。"));
    }

    async function enableNotifications() {
        const result = await requestGenerationCompletionNotifications();
        if (result === "granted") setNotice("已开启：图片和视频完成后会弹出浏览器提醒。");
        else if (result === "denied") setNotice("浏览器已拦截提醒；请在站点权限中允许通知后再试。");
        else setNotice("当前浏览器不支持系统通知，完成结果仍会显示在工作台内。");
    }

    function toggleBubble() {
        if (open) {
            closeBubble();
            return;
        }
        if (wakeTimerRef.current) clearTimeout(wakeTimerRef.current);
        setWakeNotice("");
        setOpen(true);
        setSettingsOpen(false);
    }

    function closeBubble() {
        setOpen(false);
        setSettingsOpen(false);
        setWakeNotice("");
        if (wakeTimerRef.current) clearTimeout(wakeTimerRef.current);
    }

    function openSettings() {
        if (wakeTimerRef.current) clearTimeout(wakeTimerRef.current);
        setWakeNotice("");
        setOpen(true);
        setSettingsOpen(true);
    }

    function requestTask(intent: "chat" | "production") {
        const prompt = intent === "production"
            ? `以「${profile.name}」的制作搭档身份，帮我从当前方向开始制作视频：先确认创意方向，再按调研、脚本、人物与风格、分镜、模型与报价的顺序推进。`
            : `你是我的制作搭档「${profile.name}」。请根据当前画布与目标，${profile.mission || "告诉我现在最该做的下一步，并给出可执行选项。"}`;
        onTask(prompt, intent);
        closeBubble();
    }

    const notificationCopy = permission === "granted" ? "完成提醒已开启" : permission === "denied" ? "浏览器已拦截提醒" : "开启完成提醒";
    const visibleCopy = wakeNotice || status;
    const visualState = wakeNotice ? "alert" : busy ? "working" : "idle";

    return <aside className="fg-agent-companion" data-state={visualState} aria-label="制作搭档">
        {open && !settingsOpen ? <section className="fg-agent-companion-bubble" role="dialog" aria-label={`${profile.name}的任务气泡`}>
            <div className="fg-agent-companion-bubble-head">
                <span><Sparkles size={12} /> {wakeNotice ? "刚刚完成" : busy ? "正在盯场" : "制作搭档"}</span>
                <button type="button" onClick={closeBubble} aria-label="收起制作搭档"><X size={14} /></button>
            </div>
            <strong>{profile.name}</strong>
            <p aria-live="polite">{visibleCopy}</p>
            <div className="fg-agent-companion-actions">
                <button type="button" onClick={() => requestTask("chat")}><WandSparkles size={14} />问下一步</button>
                <button type="button" onClick={() => requestTask("production")}><Clapperboard size={14} />开始制片</button>
            </div>
            <button type="button" className="fg-agent-companion-settings-link" onClick={openSettings}><Settings2 size={13} />外观与提醒</button>
        </section> : null}

        {settingsOpen ? <section className="fg-agent-companion-drawer" role="dialog" aria-label="制作搭档设置">
            <div className="fg-agent-companion-bubble-head">
                <span><Settings2 size={12} /> 制作搭档设置</span>
                <button type="button" onClick={closeBubble} aria-label="关闭制作搭档设置"><X size={14} /></button>
            </div>
            <div className="fg-agent-companion-profile">
                <button className={`fg-agent-companion-avatar${avatarUrl ? " uploaded" : ""}`} type="button" onClick={() => fileRef.current?.click()} title="上传或更换搭档形象">
                    {avatarUrl ? <img src={avatarUrl} alt={`${profile.name}的自定义形象`} /> : <><span className="fg-agent-companion-spark">✦</span><Bot size={28} /><span className="fg-agent-companion-eye left" /><span className="fg-agent-companion-eye right" /></>}
                    <span className="fg-agent-companion-camera"><Camera size={12} /></span>
                </button>
                <label>名字<input value={profile.name} maxLength={24} onChange={(event) => saveProfile({ ...profile, name: event.target.value })} aria-label="搭档名称" /></label>
            </div>
            <label className="fg-agent-companion-mission">它该提醒你什么？<textarea value={profile.mission} maxLength={120} onChange={(event) => saveProfile({ ...profile, mission: event.target.value })} placeholder="例如：先提醒我挑版本，再继续拼接。" /></label>
            <button type="button" className={`fg-agent-companion-notification${permission === "granted" ? " ready" : ""}`} onClick={() => void enableNotifications()} disabled={permission === "granted"}>
                <BellRing size={13} />{notificationCopy}
            </button>
            {notice ? <p className="fg-agent-companion-notice"><span>{notice}</span><button type="button" onClick={() => setNotice("")} aria-label="关闭提示"><X size={11} /></button></p> : null}
            <small>接入 {agentLabel} · 头像与偏好仅保存在此浏览器</small>
        </section> : null}

        <button className={`fg-agent-companion-pet${avatarUrl ? " uploaded" : ""}`} type="button" onClick={toggleBubble} aria-expanded={open} aria-label={`打开${profile.name}制作搭档`}>
            <span className="fg-agent-companion-orbit" aria-hidden><i /><i /><i /></span>
            <span className="fg-agent-companion-face">
                {avatarUrl ? <img src={avatarUrl} alt="" /> : <><span className="fg-agent-companion-spark">✦</span><Bot size={31} /><span className="fg-agent-companion-eye left" /><span className="fg-agent-companion-eye right" /></>}
            </span>
            <span className="fg-agent-companion-status-dot" aria-label={busy ? "正在处理" : wakeNotice ? "已有完成结果" : "待命中"} />
        </button>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={onAvatarChange} />
        <style jsx global>{`
            .fg-agent-companion{position:absolute;right:12px;bottom:14px;z-index:45;isolation:isolate;color:#edfff9;font-family:"JetBrains Mono","Noto Sans SC",monospace;pointer-events:none}.fg-agent-companion *{box-sizing:border-box}.fg-agent-companion button,.fg-agent-companion input,.fg-agent-companion textarea{font:inherit}.fg-agent-companion-bubble,.fg-agent-companion-drawer,.fg-agent-companion-pet{pointer-events:auto}
            .fg-agent-companion-pet{position:relative;display:grid;place-items:center;width:62px;height:62px;padding:0;border:0;border-radius:22px;background:transparent;cursor:pointer;filter:drop-shadow(0 12px 12px rgba(0,0,0,.35));transition:transform .2s cubic-bezier(.2,.8,.2,1),filter .2s ease}.fg-agent-companion-pet:hover{transform:translateY(-3px) rotate(-2deg);filter:drop-shadow(0 16px 16px rgba(0,0,0,.42))}.fg-agent-companion-pet:focus-visible{outline:2px solid #afffe2;outline-offset:4px}.fg-agent-companion-face{position:relative;z-index:1;display:grid;place-items:center;width:52px;height:52px;overflow:hidden;border:1px solid rgba(168,255,222,.65);border-radius:18px;background:radial-gradient(circle at 50% 33%,#ecfff5 0 6%,#7fffe1 7% 10%,transparent 11%),linear-gradient(145deg,#12646a,#111d37 72%);color:#082129;box-shadow:0 0 0 3px rgba(83,250,192,.11),inset 0 -10px 18px rgba(0,11,20,.42)}.fg-agent-companion-pet.uploaded .fg-agent-companion-face{border-radius:50%}.fg-agent-companion-face img,.fg-agent-companion-avatar img{width:100%;height:100%;object-fit:cover}.fg-agent-companion-face svg,.fg-agent-companion-avatar svg{position:absolute;left:10px;bottom:5px;color:#d9fff1}.fg-agent-companion-spark{position:absolute;z-index:2;top:2px;right:5px;color:#f6ffa9;font-size:12px;text-shadow:0 0 12px #f7ffa7}.fg-agent-companion-eye{position:absolute;z-index:2;bottom:21px;width:4px;height:4px;border-radius:50%;background:#071b21;box-shadow:0 0 0 2px rgba(239,255,249,.88)}.fg-agent-companion-eye.left{left:18px}.fg-agent-companion-eye.right{left:28px}.fg-agent-companion-status-dot{position:absolute;z-index:4;right:4px;bottom:5px;width:12px;height:12px;border:2px solid #101625;border-radius:50%;background:#66d9bd;box-shadow:0 0 0 2px rgba(92,239,192,.14)}.fg-agent-companion[data-state="working"] .fg-agent-companion-status-dot{background:#b2ff79;box-shadow:0 0 11px #b2ff79;animation:fg-companion-pulse 1.15s ease-in-out infinite}.fg-agent-companion[data-state="alert"] .fg-agent-companion-face{animation:fg-companion-wake .9s cubic-bezier(.2,.7,.3,1) 2}.fg-agent-companion[data-state="alert"] .fg-agent-companion-status-dot{background:#ffe485;box-shadow:0 0 12px #ffe485;animation:fg-companion-pulse .72s ease-in-out infinite}.fg-agent-companion-orbit{position:absolute;z-index:0;width:61px;height:61px;border:1px solid rgba(116,249,206,.3);border-radius:50%;transform:rotate(-26deg);transition:opacity .2s ease}.fg-agent-companion-orbit:before,.fg-agent-companion-orbit:after{content:"";position:absolute;border:1px solid rgba(122,238,212,.18);border-radius:50%}.fg-agent-companion-orbit:before{inset:-7px 6px}.fg-agent-companion-orbit:after{inset:6px -7px}.fg-agent-companion-orbit i{position:absolute;width:4px;height:4px;border-radius:50%;background:#75ffd5;box-shadow:0 0 10px #65feca}.fg-agent-companion-orbit i:nth-child(1){top:-2px;left:20px}.fg-agent-companion-orbit i:nth-child(2){right:-1px;bottom:15px}.fg-agent-companion-orbit i:nth-child(3){bottom:0;left:14px}.fg-agent-companion[data-state="working"] .fg-agent-companion-orbit{animation:fg-companion-orbit 2.4s linear infinite}
            .fg-agent-companion-bubble,.fg-agent-companion-drawer{position:absolute;right:0;bottom:74px;width:min(294px,calc(100vw - 34px));border:1px solid rgba(116,243,204,.28);border-radius:17px;background:linear-gradient(142deg,rgba(12,28,38,.98),rgba(12,18,29,.985));box-shadow:0 18px 42px rgba(0,0,0,.42),inset 0 1px rgba(255,255,255,.07);backdrop-filter:blur(18px);overflow:hidden}.fg-agent-companion-bubble:before,.fg-agent-companion-drawer:before{content:"";position:absolute;inset:0;pointer-events:none;opacity:.72;background:linear-gradient(120deg,transparent 0 54%,rgba(74,248,191,.07) 54% 55%,transparent 55%),radial-gradient(150px 95px at 96% 0,rgba(54,198,255,.14),transparent 74%)}.fg-agent-companion-bubble{padding:11px 12px 12px;animation:fg-companion-bubble-in .22s cubic-bezier(.2,.8,.2,1)}.fg-agent-companion-bubble>*{position:relative;z-index:1}.fg-agent-companion-bubble-head{display:flex;align-items:center;justify-content:space-between;gap:10px;color:rgba(189,255,235,.72);font-size:9px;letter-spacing:.72px}.fg-agent-companion-bubble-head>span{display:inline-flex;align-items:center;gap:5px}.fg-agent-companion-bubble-head button{display:grid;place-items:center;width:22px;height:22px;padding:0;border:1px solid rgba(179,255,228,.13);border-radius:8px;background:rgba(255,255,255,.025);color:rgba(228,255,247,.7);cursor:pointer}.fg-agent-companion-bubble strong{display:block;margin-top:8px;color:#f1fff9;font-size:15px;letter-spacing:.05em}.fg-agent-companion-bubble p{margin:4px 0 0;color:rgba(223,250,244,.76);font-family:"Noto Sans SC",ui-sans-serif,sans-serif;font-size:11px;line-height:1.58}.fg-agent-companion-actions{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:10px}.fg-agent-companion-actions button,.fg-agent-companion-notification{display:inline-flex;align-items:center;justify-content:center;gap:5px;min-height:31px;border:1px solid rgba(135,255,216,.24);border-radius:9px;background:rgba(60,228,183,.09);color:#cdfceb;font-size:10px;cursor:pointer;transition:background .16s ease,transform .16s ease}.fg-agent-companion-actions button:hover{transform:translateY(-1px);background:rgba(60,228,183,.18)}.fg-agent-companion-actions button:last-child{border-color:rgba(123,210,255,.3);background:rgba(77,150,255,.13);color:#d9efff}.fg-agent-companion-settings-link{display:inline-flex;align-items:center;gap:5px;margin:9px 0 0;padding:0;border:0;background:transparent;color:rgba(192,255,232,.65);font-size:9px;cursor:pointer}.fg-agent-companion-settings-link:hover{color:#b6ffe2}
            .fg-agent-companion-drawer{padding:11px 12px 12px;animation:fg-companion-bubble-in .22s cubic-bezier(.2,.8,.2,1)}.fg-agent-companion-drawer>*{position:relative;z-index:1}.fg-agent-companion-profile{display:flex;align-items:center;gap:10px;margin-top:9px}.fg-agent-companion-avatar{position:relative;flex:0 0 46px;width:46px;height:46px;overflow:hidden;padding:0;border:1px solid rgba(136,255,215,.55);border-radius:15px;background:radial-gradient(circle at 50% 33%,#e8fff6 0 5%,#7effdf 6% 10%,transparent 11%),linear-gradient(145deg,#14676b,#14233e);color:#082129;cursor:pointer;box-shadow:0 0 0 3px rgba(92,245,194,.08),inset 0 -8px 15px rgba(2,13,21,.36)}.fg-agent-companion-avatar.uploaded{border-radius:50%}.fg-agent-companion-camera{position:absolute;right:-2px;bottom:-2px;display:grid;place-items:center;width:20px;height:20px;border:1px solid rgba(223,255,245,.65);border-radius:50%;background:#10313d;color:#c6ffea}.fg-agent-companion-profile label{display:grid;flex:1;gap:3px;color:rgba(201,255,238,.61);font-size:9px}.fg-agent-companion-profile input{width:100%;padding:2px 0 3px;border:0;border-bottom:1px solid rgba(149,255,218,.19);background:transparent;color:#f2fff9;font-size:14px;outline:0}.fg-agent-companion-profile input:focus{border-color:rgba(142,255,212,.68)}.fg-agent-companion-mission{display:grid;gap:5px;margin-top:10px;color:rgba(198,255,238,.65);font-size:9px;letter-spacing:.25px}.fg-agent-companion-mission textarea{min-height:57px;resize:vertical;padding:7px 8px;border:1px solid rgba(145,255,220,.16);border-radius:9px;background:rgba(2,12,20,.52);color:#ddfff3;font-family:"Noto Sans SC",ui-sans-serif,sans-serif;font-size:10.5px;line-height:1.45;outline:0}.fg-agent-companion-mission textarea:focus{border-color:rgba(127,255,208,.58);box-shadow:0 0 0 2px rgba(107,249,196,.08)}.fg-agent-companion-notification{width:100%;margin-top:8px;background:transparent;color:rgba(203,255,237,.75)}.fg-agent-companion-notification.ready{border-color:rgba(169,255,114,.36);color:#b8ff8f;cursor:default}.fg-agent-companion-notification:disabled{opacity:1}.fg-agent-companion-notice{display:flex;align-items:flex-start;justify-content:space-between;gap:6px;margin:8px 1px 0;color:#ffe4a3;font-family:"Noto Sans SC",ui-sans-serif,sans-serif;font-size:9.5px;line-height:1.45}.fg-agent-companion-notice button{padding:0;border:0;background:transparent;color:inherit;cursor:pointer}.fg-agent-companion-drawer small{display:block;margin:8px 1px 0;color:rgba(198,255,238,.43);font-size:8.5px;line-height:1.4}
            @keyframes fg-companion-pulse{50%{transform:scale(.64);opacity:.48}}@keyframes fg-companion-orbit{to{transform:rotate(334deg)}}@keyframes fg-companion-wake{35%{transform:translateY(-5px) rotate(4deg)}65%{transform:translateY(0) rotate(-3deg)}}@keyframes fg-companion-bubble-in{from{opacity:0;transform:translateY(8px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}@media (max-width:640px){.fg-agent-companion{right:10px;bottom:10px}.fg-agent-companion-bubble,.fg-agent-companion-drawer{width:min(286px,calc(100vw - 28px))}}
        `}</style>
    </aside>;
}
