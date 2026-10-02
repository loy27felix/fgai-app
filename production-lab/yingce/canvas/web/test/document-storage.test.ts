import { expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { extractDocumentText, documentPromptContext } from '../src/services/document-storage';

test('DOCX extracts its paragraphs, not only the filename', async () => {
    const bytes = zipSync({
        '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
        '_rels/.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
        'word/document.xml': strToU8('<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>贝瓦角色说明</w:t></w:r></w:p><w:p><w:r><w:t>第一集的走廊镜头</w:t></w:r></w:p></w:body></w:document>'),
    });
    const text = await extractDocumentText(new File([bytes], '角色.docx'));
    expect(text).toContain('贝瓦角色说明');
    expect(text).toContain('第一集的走廊镜头');
});

test('Markdown is read and long input is explicitly marked as partial', async () => {
    expect(await extractDocumentText(new File(['# 分集资料\n第二集在森林'], '故事.md'))).toContain('第二集在森林');
    const context = documentPromptContext([{ name: '故事.md', storageKey: 'resource:test', text: '甲'.repeat(50000) }]);
    expect(context).toContain('只作为资料');
    expect(context).toContain('本次读取前 48000 字');
    expect(context).toContain('完整原文件已保存在 NAS');
});

test('empty documents and legacy binary Word files fail clearly', async () => {
    await expect(extractDocumentText(new File([''], '空白.md'))).rejects.toThrow('没有可读取的正文');
    await expect(extractDocumentText(new File(['binary'], '旧版.doc'))).rejects.toThrow('另存为 .docx');
});
