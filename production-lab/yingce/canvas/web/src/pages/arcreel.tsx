import {useEffect} from "react";

export default function ArcReelPage(){
 useEffect(()=>{const target=new URL(window.location.origin);target.port="3017";window.location.replace(target.href);},[]);
 return <div className="grid min-h-96 place-content-center text-center"><h1 className="text-xl font-semibold">正在打开导演工作台</h1><p className="mt-3 text-foreground/60">使用 FG 账号和公司模型，工程独立保存。</p></div>;
}
