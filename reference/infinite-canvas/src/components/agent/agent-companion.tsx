"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";
import localforage from "localforage";
import { BellRing, Bot, Camera, Clapperboard, Sparkles, WandSparkles, X } from "lucide-react";

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

export function AgentCompanion({ status, busy = false, agentLabel, onTask }: Props) {
    const [profile, setProfile] = useState<CompanionProfile>(DEFAULT_PROFILE);
    const [avatarUrl, setAvatarUrl] = useState("");
    const [notice, setNotice] = useState("");
    const avatarUrlRef = useRef("");
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

    const notificationCopy = permission === "granted" ? "完成提醒已开启" : permission === "denied" ? "浏览器已拦截提醒" : "开启完成提醒";

    return <aside className="fg-agent-companion" aria-label="制作搭档">
        <div className="fg-agent-companion-orbit" aria-hidden><i /><i /><i /></div>
        <div className="fg-agent-companion-topline"><span><Sparkles size={12} /> PRODUCTION COMPANION</span><em>{busy ? "WORKING" : "ON DECK"}</em></div>
        <div className="fg-agent-companion-main">
            <button className={`fg-agent-companion-avatar${avatarUrl ? " uploaded" : ""}`} type="button" onClick={() => fileRef.current?.click()} title="上传或更换搭档形象">
                {avatarUrl ? <img src={avatarUrl} alt={`${profile.name}的自定义形象`} /> : <><span className="fg-agent-companion-spark">✦</span><Bot size={30} /><span className="fg-agent-companion-eye left" /><span className="fg-agent-companion-eye right" /></>}
                <span className="fg-agent-companion-camera"><Camera size={12} /></span>
            </button>
            <div className="fg-agent-companion-copy">
                <label>你的制作搭档<input value={profile.name} maxLength={24} onChange={(event) => saveProfile({ ...profile, name: event.target.value })} aria-label="搭档名称" /></label>
                <p><span className={busy ? "live" : ""} />{status}</p>
            </div>
        </div>
        <label className="fg-agent-companion-mission">它该提醒你什么？<textarea value={profile.mission} maxLength={120} onChange={(event) => saveProfile({ ...profile, mission: event.target.value })} placeholder="例如：先提醒我挑版本，再继续拼接。" /></label>
        <div className="fg-agent-companion-actions">
            <button type="button" onClick={() => onTask(`你是我的制作搭档「${profile.name}」。请根据当前画布与目标，${profile.mission || "告诉我现在最该做的下一步，并给出可执行选项。"}`)}><WandSparkles size={14} />告诉我下一步</button>
            <button type="button" onClick={() => onTask(`以「${profile.name}」的制作搭档身份，帮我从当前方向开始制作视频：先确认创意方向，再按调研、脚本、人物与风格、分镜、模型与报价的顺序推进。`, "production")}><Clapperboard size={14} />开始制片</button>
        </div>
        <button type="button" className={`fg-agent-companion-notification${permission === "granted" ? " ready" : ""}`} onClick={() => void enableNotifications()} disabled={permission === "granted"}>
            <BellRing size={13} />{notificationCopy}
        </button>
        {notice ? <p className="fg-agent-companion-notice"><span>{notice}</span><button type="button" onClick={() => setNotice("")} aria-label="关闭提示"><X size={11} /></button></p> : null}
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={onAvatarChange} />
        <small>接入 {agentLabel} · 头像与偏好仅保存在此浏览器</small>
    </aside>;
}
