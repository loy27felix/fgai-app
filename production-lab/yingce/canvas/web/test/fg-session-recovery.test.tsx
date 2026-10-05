import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FGSessionRecovery } from "@/components/auth/fg-session-recovery";

test("expired FG sessions offer the main platform without a second account form", () => {
    const html = renderToStaticMarkup(<FGSessionRecovery />);
    expect(html).toContain("请恢复 FG 账号连接");
    expect(html).toContain("https://192.168.0.99:3000/workspace");
    expect(html).not.toContain("<input");
});

test("service interruption is distinct from an expired session", () => {
    const html = renderToStaticMarkup(<FGSessionRecovery unavailable />);
    expect(html).toContain("工作区连接暂时中断");
    expect(html).toContain("重新连接");
    expect(html).not.toContain("<input");
});
