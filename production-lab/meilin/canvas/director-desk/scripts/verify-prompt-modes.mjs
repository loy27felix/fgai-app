import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

const folder = 'tmp/prompt-modes';
await fs.mkdir(folder, { recursive: true });
const server = await createServer({ server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/tmp/**', '**/.local/**'] } } });
await server.listen(); let browser;
try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, acceptDownloads: true });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
    await page.waitForFunction(() => window.__director);
    const video = '参考 @视频1\n旧参考视频成稿原样保留。';
    const prose = 'cut1:\nA 单人中景。\nA：“等等。（切至 B 特写，A 的声音画外连续）你还没回答。”';
    await page.evaluate(async video => {
        const { createScene } = await import('/src/scenes.ts');
        const project = createScene('blank');
        project.production = { fixedPrompt: '风格不能丢', sceneReferenceIds: [], notes: [], promptText: video };
        await window.__director.replaceProject(project);
    }, video);
    await page.locator('#scene-prompt-toggle').click();
    const reference = page.locator('[data-act="production-prompt-mode"][data-mode="reference-video"]');
    const text = page.locator('[data-act="production-prompt-mode"][data-mode="text-only"]');
    const input = page.locator('#production-prompt-text');
    assert.equal(await input.inputValue(), video);
    await text.click(); assert.equal(await input.inputValue(), '');
    await input.fill(prose);
    await reference.click(); assert.equal(await input.inputValue(), video);
    await text.click(); assert.equal(await input.inputValue(), prose);
    assert.equal(await text.getAttribute('aria-pressed'), 'true');
    const stored = await page.evaluate(() => window.__director.getProject().production);
    assert.deepEqual(stored, { fixedPrompt: '风格不能丢', sceneReferenceIds: [], notes: [], promptText: video, promptMode: 'text-only', textOnlyPrompt: prose });
    const downloading = page.waitForEvent('download');
    await page.locator('[data-act="production-download-prompt"]').click();
    const downloaded = await downloading;
    assert.ok(downloaded.suggestedFilename().endsWith('-纯文本提示词.txt'));
    const file = folder + '/prompt.txt'; await downloaded.saveAs(file);
    assert.equal((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''), prose);
    await page.locator('[data-act="production-delivery"]').click();
    await page.locator('.modal-back').click();
    assert.equal(await input.inputValue(), prose, 'Returning from delivery retains the text-only draft and mode');
    for (const size of [{ width: 1280, height: 720 }, { width: 960, height: 640 }]) {
        await page.setViewportSize(size);
        const overflow = await page.locator('.production-modal').evaluate(root => {
            const r = root.getBoundingClientRect();
            return [...root.querySelectorAll('button,textarea')].filter(e => e.getClientRects().length).filter(e => {
                const b = e.getBoundingClientRect(); return b.left < r.left || b.right > r.right + 1 || b.bottom > innerHeight || b.top < 0;
            }).map(e => e.id || e.textContent);
        });
        assert.deepEqual(overflow, []);
    }
    await page.screenshot({ path: folder + '/text-mode.png' });
    await page.locator('.modal [data-act="close-modal"]').first().click();
    await page.locator('#scene-prompt-toggle').click();
    assert.equal(await input.inputValue(), prose);
    assert.equal(await text.getAttribute('aria-pressed'), 'true');
    // Saved projects remain portable, and continuation clears drafts instead of repeating the previous scene.
    await page.evaluate(async () => {
        const { continueScene } = await import('/src/scenes/continue-scene.ts');
        const next = await continueScene(window.__director.getEngine(), window.__director.getDocument(), '下一段', 'next');
        const data = next.scenes.find(s => s.id === 'next').state.production;
        if (data.promptText !== undefined || data.textOnlyPrompt !== undefined || data.promptMode !== 'text-only' || data.fixedPrompt !== '风格不能丢') throw Error('Continuation copied drafts or lost mode/style');
    });
    assert.deepEqual(errors, []);
    console.log('Prompt modes: legacy draft, switch/save/reopen, nested return, exact TXT, compact layout and continuation passed.');
} finally { await browser?.close(); await server.close(); }
