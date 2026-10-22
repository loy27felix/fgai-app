type Speech = { speaker: string; text: string };

const comparable = (value: string) => value
    .replace(/[\s"'“”‘’「」『』]/g, "")
    .replace(/。/g, ".").replace(/？/g, "?").replace(/！/g, "!").replace(/，/g, ",");

function speech(line: string, removeDirections = false): Speech | undefined {
    const cue = line.trim().replace(/^(?:[-*]\s+)?(?:\*\*)?/, "")
        .replace(/^[（(]?约?\s*\d+(?:\.\d+)?\s*[—–\-~～至]\s*\d+(?:\.\d+)?\s*秒[）)]?\s*[，,｜|]?\s*/, "");
    const match = cue.match(/^([^：:\n]{1,60})[：:]\s*(.+)$/);
    if (!match) return undefined;
    const speaker = match[1].replace(/[（(][^）)]*[）)]/g, "").replace(/[\s*]/g, "").toLowerCase();
    const text = removeDirections ? match[2].replace(/(?:[（(][^）)\n]*[）)]\s*)+$/u, "") : match[2];
    return speaker && comparable(text) ? { speaker, text: comparable(text) } : undefined;
}

function grouped(lines: Speech[]): Speech[] {
    const groups: Speech[] = [];
    for (const line of lines) {
        const last = groups.at(-1);
        if (last?.speaker === line.speaker) last.text += line.text;
        else groups.push({ ...line });
    }
    return groups;
}

export function dramaDialoguePreserved(dialogue: string, prompt: string): boolean {
    const lines = dialogue.split(/\r?\n/).flatMap(line => {
        const parsed = speech(line);
        return parsed ? [parsed] : [];
    });
    if (!lines.length) return true;
    const sound = prompt.split("【声音设计】")[1]?.split(/【[^】]+】/)[0];
    if (sound === undefined) {
        // Historical prompts have no sound section or separate speaker cues.
        return lines.every(line => comparable(prompt).includes(line.text));
    }
    const expected = grouped(lines);
    const dialogueHeader = sound.match(/(?:^|\n)\s*对白(?:[（(][^）)\n]*[）)])?\s*[：:]/);
    const body = dialogueHeader ? sound.slice(dialogueHeader.index! + dialogueHeader[0].length) : sound;
    // Voice profiles often repeat character names. They cannot satisfy a missing
    // line in the performance schedule, even if the quoted words appear there.
    const cues = body.split(/\r?\n[ \t]*声线[^\n]*/)[0];
    const actual = grouped(cues.split(/\r?\n/).flatMap(line => {
        const raw = speech(line);
        // Preserve parentheses that belong to the actual script. Only remove a
        // trailing performance note when the unmodified cue is not in the script.
        const parsed = raw && expected.some(item => item.speaker === raw.speaker && item.text.includes(raw.text)) ? raw : speech(line, true);
        if (!parsed || /^[\d约]/.test(parsed.speaker)) return [];
        return dialogueHeader || expected.some(item => item.speaker === parsed.speaker) ? [parsed] : [];
    }));
    return actual.length === expected.length && expected.every((line, index) =>
        line.speaker === actual[index].speaker && (dialogueHeader ? line.text === actual[index].text : actual[index].text.startsWith(line.text)),
    );
}
