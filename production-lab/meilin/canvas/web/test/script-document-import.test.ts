import { expect, test } from "bun:test";
import * as xlsx from "xlsx";
import { strToU8, zipSync } from "fflate";
import { scriptTextToHtml } from "@/lib/script-document";
import { readScriptDocument } from "@/services/script-document-import";
import { splitTextIntoChapters } from "@/lib/canvas/canvas-document";

test("script layout preserves order, dialogue and escapes imported markup", () => {
    const html = scriptTextToHtml('第一集 雨夜\n01-01 EXT. 街道\nEVAN: Ignore them.\n<script>alert(1)</script>\n01-02\t书房\tShadow: Already did.');
    expect(html).toContain('<h2>第一集 雨夜</h2>');
    expect(html).toContain('<h3>01-01 EXT. 街道</h3>');
    expect(html).toContain('<strong>EVAN:</strong> Ignore them.');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html.indexOf('01-01')).toBeLessThan(html.indexOf('01-02'));
    expect(html).toContain('Shadow: Already did.');
});

test('old flattened spreadsheet paste separates scene rows without dropping durations or dialogue', () => {
    const source='第1集｜影子知道序号 场景描述 画面内容 台词 时长（秒）01-01 EXT. 街道 EVAN: Ignore them. 401-02 INT. 书房 SHADOW: Already did. 3';
    const html=scriptTextToHtml(source);
    expect(html).toContain('<h3>01-01 EXT. 街道 EVAN: Ignore them. 4</h3>');
    expect(html).toContain('<h3>01-02 INT. 书房 SHADOW: Already did. 3</h3>');
    expect(html.replace(/<[^>]+>/g,'').replace(/\s/g,'')).toBe(source.replace(/\s/g,''));
});

for (const bookType of ['xlsx', 'biff8'] as const) {
    test(`reads actual ${bookType} spreadsheets preserving columns and multiline dialogue`, async () => {
        const book = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(book, xlsx.utils.aoa_to_sheet([['序号','场景','台词','时长'],['01-01','雨夜街道','EVAN: Ignore them.\nSHADOW: Already did.',15]]), '第一集');
        const buffer = xlsx.write(book, {type:'array',bookType});
        const text = await readScriptDocument(new File([buffer], bookType === 'xlsx' ? '剧本.xlsx' : '剧本.xls'));
        expect(text).toContain('序号\t场景\t台词\t时长');
        expect(text).toContain('01-01\t雨夜街道\tEVAN: Ignore them.\u2028SHADOW: Already did.\t15');
        expect(scriptTextToHtml(text)).toContain('Ignore them.<br>SHADOW: Already did.');
    });
}

test('reads a real Word document and splits chapters without losing dialogue', async () => {
    const files = {
        '[Content_Types].xml': strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
        '_rels/.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
        'word/document.xml': strToU8('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>第一章 雨夜</w:t></w:r></w:p><w:p><w:r><w:t>EVAN: Ignore them.</w:t></w:r></w:p></w:body></w:document>'),
    };
    const text = await readScriptDocument(new File([zipSync(files)], '剧本.docx'));
    expect(splitTextIntoChapters(text)).toEqual([{title:'第一章 雨夜',plainText:'EVAN: Ignore them.'}]);
});

test('UTF16 text and CSV have explicit decoding, empty and legacy files report errors', async () => {
    expect(await readScriptDocument(new File([new Uint8Array([255,254,69,0,86,0,65,0,78,0])], 'script.txt'))).toBe('EVAN');
    expect(await readScriptDocument(new File(['序号,场景,时长\n01-01,街道,15'], 'script.csv'))).toContain('01-01\t街道\t15');
    await expect(readScriptDocument(new File([''], 'empty.txt'))).rejects.toThrow('没有可读取');
    await expect(readScriptDocument(new File(['bad'], 'old.doc'))).rejects.toThrow('另存为 .docx');
});
