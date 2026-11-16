import {expect,test} from "bun:test";
import {isCanvasProjectPreviewURL} from "../src/lib/canvas/canvas-project-preview-url";

test("画布摘要的FG挂载资源可进入媒体预览分支",()=>{
    for(const url of ["/fg-six/api/resources/afec9f4f4e1c7e7be26b2636ef6dcd12/file","/api/resources/owned-image/file","https://cdn.example.com/image.png","blob:https://example.com/a","data:image/png;base64,AAAA"]){
        expect(isCanvasProjectPreviewURL(url)).toBe(true);
    }
});
test("没有媒体的节点和非媒体协议不能当作封面",()=>{
    for(const url of [undefined,"","prompt text","javascript:alert(1)","data:text/html,hi","//remote.example/image.png","/fg-six/arbitrary"]){
        expect(isCanvasProjectPreviewURL(url)).toBe(false);
    }
});
