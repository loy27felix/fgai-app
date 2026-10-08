import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';

// Exercise the actual composition contract: its canvas, complete shot timeline,
// image, audio and captions, rather than an empty synthetic composition.
const release=JSON.parse(readFileSync('/app/apps/daemon/runtime/remotion-component.json','utf8'));
const root=join('/app/.runtime/fg-remotion-installed',release.manifestSha256);
const manifest=JSON.parse(readFileSync(join(root,'manifest.json'),'utf8'));
const renderer=createRequire(join(root,'package.json'))(join(root,manifest.rendererEntry));
const wav=execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','anullsrc=r=22050:cl=mono','-t','0.2','-f','wav','pipe:1']);
const imagePath='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#b8d2e8"/><circle cx="640" cy="320" r="120" fill="#517aa7"/></svg>');
const inputProps={ratio:'16:9',fps:30,width:1280,height:720,totalFrames:6,
 shots:[{shotId:'fg-smoke',startFrame:0,endFrame:6,imageArtifactId:'fg-smoke-image',audioArtifactId:'fg-smoke-audio',motion:'push-in',imageSha256:'',audioSha256:'',imagePath,audioPath:'data:audio/wav;base64,'+wav.toString('base64')}],
 captions:[{segmentId:'fg-smoke-caption',startFrame:0,endFrame:6,text:'FG 共享视频渲染验收'}]};
const options={serveUrl:join(root,manifest.bundlePath),browserExecutable:join(root,manifest.browserExecutable),inputProps,chromiumOptions:{gl:'swiftshader',disableWebSecurity:false}};
const composition=await renderer.selectComposition({...options,id:'StickmanLandscape'});
await renderer.renderStill({...options,composition,output:'/app/.runtime/fg-remotion-smoke.png',frame:0});
await renderer.renderMedia({...options,composition,codec:'h264',outputLocation:'/app/.runtime/fg-remotion-smoke.mp4',concurrency:1});
const stream=JSON.parse(execFileSync('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=codec_name,width,height,nb_frames','-of','json','/app/.runtime/fg-remotion-smoke.mp4'],{encoding:'utf8'})).streams[0];
if(stream.codec_name!=='h264'||stream.width!==1280||stream.height!==720||Number(stream.nb_frames)!==6)throw Error('Shared Remotion render validation failed');
console.log(JSON.stringify({remotionReady:true,remotionVersion:manifest.remotionVersion,resources:manifest.resources.length,render:stream}));
