import {test,expect,mock} from 'bun:test';
import {apiClient} from '@/services/api/request';
let localWrites=0;
mock.module('localforage',()=>({default:{config:()=>{},setItem:async()=>{localWrites++;},getItem:async()=>null,createInstance:()=>({setItem:async()=>{localWrites++;},getItem:async()=>null})}}));
mock.module('@/lib/image-utils',()=>({readImageMeta:async()=>({width:32,height:32,mimeType:'image/png'})}));
mock.module('@/services/resource-blob-cache',()=>({primeResourceBlobCache:async()=>{},getCachedResourceBlob:async()=>null}));
const {uploadImage}=await import('@/services/image-storage');
const {uploadMediaFile}=await import('@/services/file-storage');
const {applyResourceReference}=await import('@/services/user-data-sync-media');

test('director cloud documents retain readable text while media references resolve to server URLs',()=>{
 const scene={directorDesk:true,content:'1 个戏段 · 工程已保存到 NAS',storageKey:'resource:scene-json'};
 expect(applyResourceReference(scene,scene.storageKey).content).toBe(scene.content);
 expect(scene.content).toBe('1 个戏段 · 工程已保存到 NAS');
 const media=applyResourceReference({content:'blob:temporary'},'resource:video');
 expect(media.content).toBe('/api/resources/video/file');
});
test('FG network upload failure is rejected; no local-only image or media is accepted',async()=>{
 const previous=apiClient.defaults.adapter;
 apiClient.defaults.adapter=async()=>{throw new Error('Network Error');};
 try{
  await expect(uploadImage(new Blob(['png'],{type:'image/png'}))).rejects.toThrow();
  await expect(uploadMediaFile(new Blob(['file'],{type:'application/octet-stream'}))).rejects.toThrow();
  expect(localWrites).toBe(0);
 }finally{apiClient.defaults.adapter=previous;}
});
test('successful uploads return server resource keys, never a blob-only URL',async()=>{
 const previous=apiClient.defaults.adapter;
 apiClient.defaults.adapter=async config=>({data:{code:0,data:{resource:{id:'saved-resource',size:3,publicUrl:'/api/resources/saved-resource/file'}}},status:200,statusText:'OK',headers:{},config});
 try{
  const image=await uploadImage(new Blob(['png'],{type:'image/png'}));
  expect(image.storageKey).toContain('saved-resource');expect(image.url.startsWith('blob:')).toBe(false);
  expect(image.pendingRemoteUpload).not.toBe(true);expect(localWrites).toBe(0);
 }finally{apiClient.defaults.adapter=previous;}
});
