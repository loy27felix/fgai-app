import { describe, expect, test } from "bun:test";
import { dramaDialoguePreserved } from "@/lib/short-drama-dialogue";

const prompt = (body: string) => `【声音设计】\n对白：\n${body}\n【负面约束】\n不得新增台词。`;

describe("分镜对白校验区分台词与声音说明", () => {
    test("声线说明位于对白前后或中间时，不截断、也不冒充演出台词", () => {
        const dialogue = "林默：先走。\n小雨：我等你。";
        for (const note of ["基础声线：年轻男声。", "声线设定：语速平稳。", "林默声线：中低音，语速偏慢。", "小雨的呼救声：仅无词呼喊，没有额外台词。"]) {
            for (const body of [`${note}\n${dialogue}`, `林默：先走。\n${note}\n小雨：我等你。`, `${dialogue}\n${note}`]) {
                expect(dramaDialoguePreserved(dialogue, prompt(body))).toBe(true);
            }
        }
        expect(dramaDialoguePreserved(dialogue, prompt("林默：先走。\n声线 小雨：我等你。"))).toBe(false);
        expect(dramaDialoguePreserved(dialogue, prompt("基础声线：林默：先走。小雨：我等你。"))).toBe(false);
    });

    test("角色后的表演说明与时间范围不属于角色姓名", () => {
        expect(dramaDialoguePreserved("林默：先走。\n小雨：我等你。", prompt("林默（青年男声，压低音量）3—5秒：先走。\n小雨（低声）6—8秒：我等你。"))).toBe(true);
    });

    test("独立声线标题下的角色画像不算演出台词，明确对白标题可恢复演出清单", () => {
        const dialogue = "BOSS：Keep going.\nEVAN：I will.";
        const profiles = "声线：\nBOSS：成年男声，低沉。\nEVAN：青年男声，克制。";
        expect(dramaDialoguePreserved(dialogue, prompt(`${dialogue}\n${profiles}`))).toBe(true);
        expect(dramaDialoguePreserved(dialogue, prompt(`${profiles}\n对白：\n${dialogue}`))).toBe(true);
        expect(dramaDialoguePreserved(dialogue, prompt("声线：\nBOSS：Keep going.\nEVAN：I will."))).toBe(false);
    });

    test("仍拒绝漏词、改词、增词、换人、倒序、重复和没有明确绑定的译名", () => {
        const dialogue = "LIN：Go first.\nYU：I'll wait.";
        for (const body of ["LIN：Go first.", "LIN：Go now.\nYU：I'll wait.", "LIN：Go first. Hurry!\nYU：I'll wait.", "BOSS：Go first.\nYU：I'll wait.", "YU：I'll wait.\nLIN：Go first.", "LIN：Go first.\nLIN：Go first.\nYU：I'll wait.", "林默：Go first.\nYU：I'll wait."]) {
            expect(dramaDialoguePreserved(dialogue, prompt(body))).toBe(false);
        }
    });
});

const historicalPrompt = (body: string) => `【声音设计】\n对白（英文演出，无字幕）：\n${body}\n【负面约束】\nEvan：I am fine.`;

test("voice-over labels, case, quotation and Chinese punctuation do not change spoken words", () => {
    expect(dramaDialoguePreserved('SHADOW (V.O.)：“You keep saying you’re fine.”\nEvan：I am fine.', historicalPrompt(
        "（约0—5秒） Shadow（V.O.）：You keep saying you're fine.\n5—8秒 EVAN：I am fine。",
    ))).toBe(true);
});

test("a line in voice notes or negative constraints cannot replace missing performance dialogue", () => {
    for (const body of ["0—4秒 Shadow：You seem tired.", "0—4秒 Shadow：You seem tired.\n  声线 Evan：I am fine."]) {
        expect(dramaDialoguePreserved("Evan：I am fine.", historicalPrompt(body))).toBe(false);
    }
});

test("speaker switches and interruptions cannot be merged into one character's sentence", () => {
    const expected = "Evan：It's fine. I'll handle it.";
    expect(dramaDialoguePreserved(expected, historicalPrompt("0—2秒 Evan：It's fine.\n3—5秒 Evan：I'll handle it."))).toBe(true);
    expect(dramaDialoguePreserved(expected, historicalPrompt("0—2秒 Evan：It's fine.\n2—3秒 Mia：Wait.\n3—5秒 Evan：I'll handle it."))).toBe(false);
    expect(dramaDialoguePreserved(expected, historicalPrompt("0—2秒 Evan：It's fine.\n3—5秒 Mia：I'll handle it."))).toBe(false);
});

test("English parenthetical speech and negation remain substantive", () => {
    const expected = "Evan：I said (no).";
    expect(dramaDialoguePreserved(expected, historicalPrompt("0—2秒 Evan：I said (no)."))).toBe(true);
    expect(dramaDialoguePreserved(expected, historicalPrompt("0—2秒 Evan：I said no."))).toBe(false);
    expect(dramaDialoguePreserved("Evan：I can't go.", historicalPrompt("0—2秒 Evan：I can go."))).toBe(false);
});

test("parenthetical script words cannot be discarded as performance notes", () => {
    const expected = "Evan：不要（不）";
    expect(dramaDialoguePreserved(expected, historicalPrompt("0—2秒 Evan：不要（不）"))).toBe(true);
    expect(dramaDialoguePreserved(expected, historicalPrompt("0—2秒 Evan：不要"))).toBe(false);
    expect(dramaDialoguePreserved("Evan：I am fine.", historicalPrompt("0—2秒 Evan：I am fine. (quietly)"))).toBe(true);
});
