import { decodeNovelText } from "@/lib/canvas/canvas-document";
import { spreadsheetRowsToText } from "@/lib/script-document";
import { extractDocumentText } from "./document-storage";

export const SCRIPT_DOCUMENT_ACCEPT = ".docx,.pdf,.xlsx,.xls,.txt,.md,.csv";
export async function readScriptDocument(file: File): Promise<string> {
    if (file.size > 32 * 1024 * 1024) throw new Error("剧本文件请控制在 32 MB 以内，较大的文件可分章导入");
    const extension = file.name.split(".").at(-1)?.toLowerCase();
    let text: string;
    if (extension === "xlsx" || extension === "xls" || extension === "csv") {
        const xlsx = await import("xlsx");
        const input = await file.arrayBuffer();
        const workbook = xlsx.read(extension === "csv" ? decodeNovelText(input) : input, { type: extension === "csv" ? "string" : "array", cellHTML: false });
        text = workbook.SheetNames.map((name) => {
            const rows = xlsx.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, defval: "", raw: false, blankrows: false });
            const body = spreadsheetRowsToText(rows);
            return body ? (workbook.SheetNames.length > 1 ? `【工作表：${name}】\n` : "") + body : "";
        }).filter(Boolean).join("\n\n");
    } else if (extension === "txt" || extension === "md") {
        text = decodeNovelText(await file.arrayBuffer());
    } else {
        text = await extractDocumentText(file);
    }
    if (!text.trim()) throw new Error("文件没有可读取的剧本正文");
    return text.trim();
}
