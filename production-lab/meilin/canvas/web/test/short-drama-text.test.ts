import { describe, expect, test } from "bun:test";
import { defaultConfig } from "@/stores/use-config-store";
import { GenerationTaskFailure, type GenerationTask } from "@/services/api/task-center";
import { confirmedPersonalGPTQuotaFailure, runShortDramaText, shortDramaDefaultTextModel } from "@/services/short-drama-text";

const config = { ...defaultConfig, textModel: "gpt-6.1-sol", channels: [{ id: "test", name: "test", baseUrl: "https://example.com", apiKey: "", apiFormat: "openai" as const, enabled: true, models: ["gpt-6.1-sol", "claude-sonnet-5-5-t3a"] }] };
const failure = (patch: Partial<GenerationTask> = {}) => new GenerationTaskFailure({ id: "failed-gpt", type: "canvas_text", status: "failed", prompt: "", attempts: 1, createdAt: "", updatedAt: "", error: "模型服务额度不足，请检查渠道余额或配额", billing: { status: "refunded", amountMicrocredits: 0 }, ...patch });

describe("短剧个人 GPT 与 Sonnet 回退", () => {
    test("绑定用 Sol，未绑定用 Sonnet；不选其他 GPT 文本模型", () => {
        expect(shortDramaDefaultTextModel(config, true)).toContain("gpt-6.1-sol");
        expect(shortDramaDefaultTextModel(config, false)).toContain("claude-sonnet-5-5");
    });
    test("未绑定直接提交 Sonnet，不先提交失败的 GPT 任务", async () => {
        const models: string[] = [];
        await runShortDramaText(config, async value => { models.push(value.model); }, undefined, async () => ({ configured: false }));
        expect(models).toHaveLength(1);
        expect(models[0]).toContain("claude-sonnet-5-5");
    });
    test("明确额度失败才创建独立 Sonnet 任务，且只回退一次", async () => {
        const models: string[] = [];
        const notices: string[] = [];
        const result = await runShortDramaText(config, async value => {
            models.push(value.model);
            if (models.length === 1) throw failure();
            return "ok";
        }, notice => notices.push(notice), async () => ({ configured: true }));
        expect(result).toBe("ok");
        expect(models).toHaveLength(2);
        expect(models[0]).toContain("gpt-6.1-sol");
        expect(models[1]).toContain("claude-sonnet-5-5");
        expect(notices).toHaveLength(1);
    });
    test("超时、通用429、计费不确定、部分输出均不回退", async () => {
        for (const error of [new Error("额度不足"), failure({ error: "模型服务请求过于频繁或额度不足，请稍后重试" }), failure({ billing: { status: "uncertain", amountMicrocredits: 0 } }), failure({ textDraft: "已经生成一部分" }), failure({ status: "running" })]) {
            expect(confirmedPersonalGPTQuotaFailure(error)).toBeFalsy();
            let count = 0;
            await expect(runShortDramaText(config, async () => { count++; throw error; }, undefined, async () => ({ configured: true }))).rejects.toThrow();
            expect(count).toBe(1);
        }
    });
    test("Sonnet 再失败不会循环；个人配置读取失败不提交任何任务", async () => {
        let count = 0;
        await expect(runShortDramaText(config, async () => { count++; throw failure(); }, undefined, async () => ({ configured: true }))).rejects.toThrow();
        expect(count).toBe(2);
        count = 0;
        await expect(runShortDramaText(config, async () => { count++; }, undefined, async () => { throw new Error("offline"); })).rejects.toThrow("offline");
        expect(count).toBe(0);
    });
});
