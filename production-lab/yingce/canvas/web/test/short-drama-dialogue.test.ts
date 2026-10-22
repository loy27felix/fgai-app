import { expect, test } from "bun:test";
import { dramaDialoguePreserved } from "@/lib/short-drama-dialogue";

const prompt = (body: string) => `【声音设计】\n对白（英文演出，无字幕）：\n${body}\n【负面约束】\nEvan：I am fine.`;

test("voice-over labels, case, quotation and Chinese punctuation do not change spoken words", () => {
    expect(dramaDialoguePreserved('SHADOW (V.O.)：“You keep saying you’re fine.”\nEvan：I am fine.', prompt(
        "（约0—5秒） Shadow（V.O.）：You keep saying you're fine.\n5—8秒 EVAN：I am fine。",
    ))).toBe(true);
});

test("a line in voice notes or negative constraints cannot replace missing performance dialogue", () => {
    for (const body of ["0—4秒 Shadow：You seem tired.", "0—4秒 Shadow：You seem tired.\n  声线 Evan：I am fine."]) {
        expect(dramaDialoguePreserved("Evan：I am fine.", prompt(body))).toBe(false);
    }
});

test("speaker switches and interruptions cannot be merged into one character's sentence", () => {
    const expected = "Evan：It's fine. I'll handle it.";
    expect(dramaDialoguePreserved(expected, prompt("0—2秒 Evan：It's fine.\n3—5秒 Evan：I'll handle it."))).toBe(true);
    expect(dramaDialoguePreserved(expected, prompt("0—2秒 Evan：It's fine.\n2—3秒 Mia：Wait.\n3—5秒 Evan：I'll handle it."))).toBe(false);
    expect(dramaDialoguePreserved(expected, prompt("0—2秒 Evan：It's fine.\n3—5秒 Mia：I'll handle it."))).toBe(false);
});

test("English parenthetical speech and negation remain substantive", () => {
    const expected = "Evan：I said (no).";
    expect(dramaDialoguePreserved(expected, prompt("0—2秒 Evan：I said (no)."))).toBe(true);
    expect(dramaDialoguePreserved(expected, prompt("0—2秒 Evan：I said no."))).toBe(false);
    expect(dramaDialoguePreserved("Evan：I can't go.", prompt("0—2秒 Evan：I can go."))).toBe(false);
});
