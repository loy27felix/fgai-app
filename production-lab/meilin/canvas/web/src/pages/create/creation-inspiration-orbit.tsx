import { lazy, Suspense, useEffect, useState } from "react";
import { Button, Select, Spin } from "antd";
import { Link } from "react-router";
import { http } from "@/services/api/request";
import { AppModal } from "@/components/ui/product/app-modal";
import { useUserStore } from "@/stores/use-user-store";
import type { SphereEntry } from "@/components/inspiration-sphere";
import type { CreationMode } from "./creation-types";
const Sphere = lazy(() => import("@/components/inspiration-sphere").then((module) => ({ default: module.InspirationSphere })));
type Entry = SphereEntry & { prompt?: string; promptZh?: string; description?: string; sourceUrl?: string };
export function CreationInspirationOrbit({ mode, onStartPrompt }: { mode: CreationMode; onStartPrompt: (mode: CreationMode, prompt: string) => void }) {
    const [category, setCategory] = useState("");
    const accountId = useUserStore((state) => state.user?.id);
    const [data, setData] = useState<{ items: Entry[]; categories: { id: string; name: string; count: number }[] }>();
    const [selected, setSelected] = useState<Entry>();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    useEffect(() => {
        const controller = new AbortController();
        setData(undefined);
        setSelected(undefined);
        setError("");
        const query = `/fg/inspiration?kind=${mode === "video" ? "video" : "image"}&category=${encodeURIComponent(category)}`;
        void Promise.all([1, 2, 3].map((page) => http.get<NonNullable<typeof data>>(`${query}&page=${page}`, { signal: controller.signal })))
            .then((pages) => setData({ ...pages[0], items: [...new Map(pages.flatMap((page) => page.items).map((item) => [item.id, item])).values()] }))
            .catch((error) => {
                if (!controller.signal.aborted) setError(error.message || "灵感读取失败");
            });
        return () => controller.abort();
    }, [mode, category, accountId]);
    async function open(item: Entry) {
        setSelected(item);
        setBusy(true);
        try {
            const result = await http.get<Entry>(`/fg/inspiration/items/${item.id}`);
            setSelected((current) => (current?.id === item.id ? result : current));
        } catch {
            setError("提示词暂时无法读取，请重试");
        } finally {
            setBusy(false);
        }
    }
    return (
        <div className="creation-orbit" style={{ width: "min(1120px,100%)", margin: "20px auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
                <Select
                    aria-label="首页灵感分类"
                    value={category}
                    onChange={setCategory}
                    style={{ minWidth: 170 }}
                    options={[{ value: "", label: "精选 · 全部用途" }, ...(data?.categories.filter((c) => c.count).map((c) => ({ value: c.id, label: c.name })) || [])]}
                />
                <Link to="/fg-inspiration">浏览完整灵感库 ↗</Link>
            </div>
            {error ? <p role="alert">{error}</p> : null}
            <Suspense fallback={<Spin />}>
                {data ? (
                    <Sphere items={data.items} onSelect={(item) => void open(item)} compact />
                ) : (
                    <div style={{ minHeight: 400, display: "grid", placeItems: "center" }}>
                        <Spin />
                    </div>
                )}
            </Suspense>
            <AppModal open={!!selected} title={selected?.title || "灵感详情"} onCancel={() => setSelected(undefined)} footer={null} width={760} destroyOnHidden>
                <Spin spinning={busy}>
                    <p>{selected?.description}</p>
                    <pre style={{ whiteSpace: "pre-wrap", maxHeight: "45dvh", overflowY: "auto", padding: 16 }}>{selected?.promptZh || selected?.prompt || "正在读取完整提示词…"}</pre>
                </Spin>
                <p style={{ fontSize: 12, opacity: 0.6 }}>{selected?.sourceName}</p>
                <Button
                    type="primary"
                    disabled={busy || !(selected?.promptZh || selected?.prompt)}
                    onClick={() => {
                        const prompt = selected?.promptZh || selected?.prompt;
                        if (prompt) {
                            onStartPrompt(mode, prompt);
                            setSelected(undefined);
                        }
                    }}
                >
                    带入创作
                </Button>
            </AppModal>
        </div>
    );
}
