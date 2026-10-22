import { afterAll, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { filesFromTransfer, imageURLFromTransfer, transferHasMedia, transferHasFiles } from '../src/lib/media-transfer';

const previous = globalThis.DOMParser;
globalThis.DOMParser = new Window().DOMParser as typeof DOMParser;
afterAll(() => { globalThis.DOMParser = previous; });
const transfer = (values: Record<string,string>) => ({ getData: (type: string) => values[type] || '' });

test('clipboard files and item fallbacks import each image only once', () => {
    const file = new File(['png'], '复制.png', {type:'image/png'});
    const items = [{kind:'file',type:'image/png',getAsFile:()=>file}];
    expect(filesFromTransfer({files:[file],items} as unknown as DataTransfer)).toEqual([file]);
    expect(filesFromTransfer({files:[],items} as unknown as DataTransfer)).toEqual([file]);
    expect(transferHasMedia({types:['Files'],items:[]} as unknown as DataTransfer)).toBe(true);
});
test('browser images work via HTML and URI while normal copied text stays text', () => {
    expect(imageURLFromTransfer(transfer({'text/html':'<img src="/images/ref.png">'}),'https://example.com/story')).toBe('https://example.com/images/ref.png');
    expect(imageURLFromTransfer(transfer({'text/uri-list':'# image\nhttps://example.com/ref.webp?x=1'}),'https://example.com/')).toBe('https://example.com/ref.webp?x=1');
    expect(imageURLFromTransfer(transfer({'text/plain':'https://example.com/ref.png'}),'https://example.com/')).toBeUndefined();
    expect(imageURLFromTransfer(transfer({'text/html':'<b>人物说明</b>'}),'https://example.com/')).toBeUndefined();
});
test('active URLs, local files and foreign blob URLs never become imports', () => {
    for (const src of ['javascript:alert(1)','file:///C:/private.png','blob:https://other.example/private','data:text/html;base64,PHNjcmlwdD4=']) {
        expect(imageURLFromTransfer(transfer({'text/html':`<img src="${src}">`}), 'https://example.com/')).toBeUndefined();
    }
});

test('drag detection recognizes protected file items, file-only transfers and browser HTML images', () => {
    expect(transferHasFiles({types:[],items:[],files:[new File(['x'],'clip.mp4')]} as unknown as DataTransfer)).toBe(true);
    expect(transferHasFiles({types:['Files'],items:[],files:[]} as unknown as DataTransfer)).toBe(true);
    expect(transferHasFiles({types:[],items:[{kind:'file'}],files:[]} as unknown as DataTransfer)).toBe(true);
    expect(transferHasMedia({types:['text/html'],items:[]} as unknown as DataTransfer)).toBe(true);
    expect(transferHasFiles({types:['application/x-canvas-batch-row'],items:[]} as unknown as DataTransfer)).toBe(false);
});
