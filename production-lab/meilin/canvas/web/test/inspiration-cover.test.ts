import {expect,test} from "bun:test";
import {bundledInspirationCover} from "../src/lib/inspiration-cover";
import {createFileUploadPlaceholder} from "../src/lib/canvas/canvas-file-upload";

test("catalog thumbnails use the workspace mount while unrelated sources stay unchanged",()=>{
    const path="/inspiration-thumbs/youmind/13515.webp";
    expect(bundledInspirationCover("https://raw.githubusercontent.com/ddcat-ai/open-ai-canvas/main/web/public"+path,"/fg-six/")).toBe("/fg-six"+path);
    expect(bundledInspirationCover(path,"/")).toBe(path);
    expect(bundledInspirationCover("https://example.com/a.jpg","/fg-six/")).toBe("https://example.com/a.jpg");
    expect(bundledInspirationCover("/inspiration-thumbs/../private.webp","/fg-six/")).toBe("/inspiration-thumbs/../private.webp");
});

test("audio and text upload retain the chosen filename instead of the node default",async()=>{
    for(const [name,type] of [["Evan_声音.wav","audio/wav"],["Shadow_声音.mp3","audio/mpeg"],["剧本.txt","text/plain"]]){
        const node=await createFileUploadPlaceholder("qa",new File(["test"],name,{type}),{x:0,y:0});
        expect(node.title).toBe(name);
    }
});
