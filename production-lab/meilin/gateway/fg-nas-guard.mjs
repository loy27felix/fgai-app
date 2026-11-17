import {lstatSync} from 'node:fs';
import {isAbsolute,join} from 'node:path';

// Read only the supervisor's host-local guard, never clear it from a container.
// 仅读取守护进程的宿主本地守卫，容器不得自行解除保护。
export function nasGuardUnavailable(env=process.env){
  const directory=env.CANVAS_NAS_GUARD_DIR;
  if(directory===undefined)return false;
  if(!isAbsolute(directory))return true;
  try{
    const stat=lstatSync(directory);
    if(!stat.isDirectory()||stat.isSymbolicLink())return true;
    try{lstatSync(join(directory,'disabled'));return true;}
    catch(error){return error.code!=='ENOENT';}
  }catch{return true;}
}

export function nasGuardedAPI(pathname){
  return pathname.startsWith('/api/')&&!pathname.startsWith('/api/auth/')&&pathname!=='/api/public/appearance';
}
