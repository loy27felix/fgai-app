import { Button } from "antd";
import {fgPlatformURL} from "@/lib/fg-entry-url";

export function FGSessionRecovery({ unavailable = false }: { unavailable?: boolean }) {
    return <main className="flex min-h-dvh items-center justify-center bg-background p-6 text-foreground">
        <section className="max-w-md space-y-4 rounded-2xl border border-border bg-card p-8 shadow-lg" role="alert">
            <h1 className="text-xl font-semibold">{unavailable ? "工作区连接暂时中断" : "请恢复 FG 账号连接"}</h1>
            <p className="text-sm leading-6 text-muted-foreground">{unavailable ? "登录或数据服务暂时未响应。可以重试连接，已保存的工程不会因此删除。" : "制作工作区使用 FG Studio 账号。请返回主平台恢复登录，然后重新打开工作区。"}</p>
            <div className="flex gap-3">
                <Button type="primary" onClick={() => window.location.reload()}>重新连接</Button>
                <Button href={fgPlatformURL(window.location.origin)} target="_top">返回 FG 工作区</Button>
            </div>
        </section>
    </main>;
}
