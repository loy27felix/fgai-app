import { motion, useReducedMotion } from "motion/react";
import { Tabs } from "antd";
import { ArrowLeft, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router";

import { BrandLogo } from "@/components/brand/brand-logo";
import { SiteComplianceFooter } from "@/components/layout/site-compliance-footer";
import { aceternityMotion } from "@/lib/aceternity-motion";
import { brandStudioLabel, useAppearanceStore } from "@/stores/use-appearance-store";
import { useThemeStore } from "@/stores/use-theme-store";

const AUTH_TABS = [
    { key: "login", label: "登录" },
    { key: "register", label: "注册" },
];

const authCopy = {
    login: {
        eyebrow: "WELCOME BACK",
        title: "进入创作现场",
        description: "继续编辑你的画布、素材与生成任务。",
    },
    register: {
        eyebrow: "CREATE ACCOUNT",
        title: "建立你的创作空间",
        description: "一个账号管理画布、素材、技能和模型偏好。",
    },
    recovery: {
        eyebrow: "ACCOUNT RECOVERY",
        title: "重新设置密码",
        description: "验证账号邮箱后，设置一个新的登录密码。",
    },
} as const;

export function LinuxDOIcon() {
    return (
        <span
            aria-hidden
            className="size-5 shrink-0 rounded-full"
            style={{
                background: "linear-gradient(to bottom, #1d1d1f 0 33.333%, #efefef 33.333% 66.666%, #feb005 66.666% 100%)",
                boxShadow: "0 0 0 1px rgba(255,255,255,.14)",
            }}
        />
    );
}

export function AuthScene() {
    const appearance = useAppearanceStore((state) => state.appearance);
    const theme = useThemeStore((state) => state.theme);
    const location = useLocation();
    const navigate = useNavigate();
    const reducedMotion = useReducedMotion();
    const videoRef = useRef<HTMLVideoElement>(null);
    const [manualVideoActive, setManualVideoActive] = useState(false);
    const [videoPlaying, setVideoPlaying] = useState(false);
    const [failedPosterURL, setFailedPosterURL] = useState("");
    const recovery = location.pathname === "/forgot-password";
    const activeTab = location.pathname === "/register" ? "register" : "login";
    const copy = recovery ? authCopy.recovery : activeTab === "register" ? authCopy.register : authCopy.login;
    const automaticVideoActive = appearance.authVideoAutoplay && !reducedMotion;
    const videoActive = Boolean(appearance.authVideoUrl && (automaticVideoActive || manualVideoActive));

    useEffect(() => {
        setManualVideoActive(false);
        setVideoPlaying(false);
    }, [appearance.authVideoUrl, appearance.authVideoAutoplay]);

    const playVideo = () => {
        setManualVideoActive(true);
        requestAnimationFrame(() => {
            void videoRef.current?.play().catch(() => setVideoPlaying(false));
        });
    };

    return (
        <main className="auth-scene relative isolate h-dvh min-h-0 overflow-y-auto">
            <div className="relative min-h-full">
                <section className="auth-scene-hero pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-label={`${appearance.brandName}品牌影片`}>
                    {videoActive && appearance.authVideoUrl ? <video ref={videoRef} className="absolute inset-0 size-full object-cover object-[70%_center]" src={appearance.authVideoUrl} poster={appearance.authVideoPosterUrl || undefined} autoPlay muted loop playsInline preload="metadata" onPlay={() => setVideoPlaying(true)} onPause={() => setVideoPlaying(false)} /> : appearance.authVideoPosterUrl && failedPosterURL !== appearance.authVideoPosterUrl ? <img className="absolute inset-0 size-full object-cover object-[70%_center]" src={appearance.authVideoPosterUrl} alt="" decoding="async" onError={() => setFailedPosterURL(appearance.authVideoPosterUrl)} /> : null}
                    <div aria-hidden className="auth-scene-hero-overlay absolute inset-0" />
                    <motion.div
                        initial={reducedMotion ? false : { opacity: 0, y: 18 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: aceternityMotion.duration.panel, ease: aceternityMotion.easing.enter }}
                        className="absolute bottom-10 right-12 hidden max-w-md text-right lg:block"
                    >
                        <p className="auth-scene-hero-muted text-xs font-semibold tracking-[0.18em]">{brandStudioLabel(appearance)}</p>
                        <h1 className="auth-scene-hero-title mt-3 max-w-xl whitespace-pre-line text-3xl font-medium leading-snug">{appearance.authHeroTitle}</h1>
                        {appearance.authHeroDescription ? <p className="auth-scene-hero-muted mt-4 max-w-xl whitespace-pre-line text-sm leading-6 sm:text-base sm:leading-7">{appearance.authHeroDescription}</p> : null}
                    </motion.div>
                </section>

                <header className="absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-4 p-5 sm:p-8 lg:px-12">
                    <Link to="/" className="auth-scene-brand inline-flex items-center gap-2 text-sm font-semibold drop-shadow-sm transition-opacity hover:opacity-80">
                        <BrandLogo theme={theme} className={`size-7 ${appearance.logoConfigured ? "" : "brightness-0 invert"}`} alt="" fallback={<span className="size-7 bg-current" style={{ mask: "url(/logo.svg) center / contain no-repeat", WebkitMask: "url(/logo.svg) center / contain no-repeat" }} />} />
                        {appearance.brandName}
                    </Link>
                    <div className="flex items-center gap-3">
                        <button type="button" className="auth-scene-hero-control inline-flex items-center gap-2 rounded-full px-3 py-2 text-[var(--fs-label)] backdrop-blur-xl transition disabled:cursor-default" onClick={playVideo} disabled={videoPlaying || !appearance.authVideoUrl} aria-pressed={videoPlaying}>
                            <Play className="size-3 fill-current" />
                            {videoPlaying ? "创作正在发生" : "播放品牌影片"}
                        </button>
                        <Link to="/" className="auth-scene-return inline-flex h-9 items-center gap-2 rounded-full px-4 text-xs backdrop-blur-xl transition">
                            <ArrowLeft className="size-3.5" />
                            返回首页
                        </Link>
                    </div>
                </header>
                <section className="auth-scene-form-pane relative flex min-h-dvh w-full flex-col px-5 pb-5 pt-24 sm:px-8 sm:pt-28 lg:ml-[clamp(24px,5vw,96px)] lg:w-[min(46vw,520px)] lg:px-0 lg:pb-6">
                    <div className="flex w-full flex-1 items-center justify-center">
                        <motion.div
                            initial={reducedMotion ? false : { opacity: 0, y: 14 }}
                            animate={{ opacity: 1, y: 0 }}
                            layout={!reducedMotion}
                            transition={{ duration: aceternityMotion.duration.panel, ease: aceternityMotion.easing.enter }}
                            className="my-4 w-full max-w-[440px]"
                        >
                            <div className="auth-scene-card h-auto overflow-hidden rounded-3xl backdrop-blur-2xl">
                                <section aria-label={copy.title} className="flex flex-col">
                                    <header className="px-6 pb-5 pt-6 sm:px-8 sm:pt-7">
                                        <p className="auth-scene-eyebrow text-xs font-semibold tracking-[0.18em]">{copy.eyebrow}</p>
                                        <h2 className="mt-2 text-3xl font-semibold">{copy.title}</h2>
                                        <p className="auth-scene-muted mt-2 text-sm leading-6">{copy.description}</p>
                                    </header>
                                    {!recovery ? (
                                        <div className="px-6 sm:px-8">
                                            <Tabs className="auth-card-tabs" activeKey={activeTab} items={AUTH_TABS} onChange={(key) => navigate({ pathname: key === "register" ? "/register" : "/login", search: location.search })} />
                                        </div>
                                    ) : null}
                                    <div key={location.pathname} className={`${!recovery && activeTab === "login" ? "" : "flex-1"} px-6 py-6 sm:px-8 sm:py-7`}>
                                        <Outlet />
                                    </div>
                                </section>
                            </div>
                        </motion.div>
                    </div>
                    <SiteComplianceFooter variant="auth" className="relative inset-auto w-full shrink-0" />
                </section>
            </div>
        </main>
    );
}
