import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "antd";
import { createPortal } from "react-dom";
import { Maximize2, Minimize2 } from "lucide-react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import "./inspiration-sphere.css";
import { bundledInspirationCover } from "@/lib/inspiration-cover";

export type SphereEntry = { id: string; title: string; cover: string; sourceName?: string };
export function InspirationSphere({ items, onSelect, compact = false, toolbar, collectionName = "灵感星球", exitSignal = 0 }: { items: SphereEntry[]; onSelect: (item: SphereEntry) => void; compact?: boolean; toolbar?: ReactNode; collectionName?: string; exitSignal?: number }) {
    const host = useRef<HTMLDivElement>(null);
    const [fullscreen,setFullscreen] = useState(false);
    useEffect(()=>setFullscreen(false),[exitSignal]);
    const fullButton = useRef<HTMLButtonElement>(null);
    useEffect(()=>{
        if(!fullscreen)return;
        const previous=document.body.style.overflow;document.body.style.overflow="hidden";
        const escape=(event:KeyboardEvent)=>{
            // The detail dialog has its own Escape key and focus trap above this space.
            if(document.querySelector(".fg-inspiration-modal"))return;
            if(document.querySelector(".fg-sphere-filters .ant-select-dropdown:not(.ant-select-dropdown-hidden)"))return;
            if(event.key==="Escape"){setFullscreen(false);return;}
            if(event.key!=="Tab")return;
            const controls=Array.from(document.querySelectorAll<HTMLElement>(".fg-sphere.is-fullscreen button,.fg-sphere.is-fullscreen summary,.fg-sphere.is-fullscreen input")).filter(element=>element.offsetParent!==null);
            const first=controls[0],last=controls.at(-1);
            if(!first||!last)return;
            if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
            else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
        };
        window.requestAnimationFrame(()=>fullButton.current?.focus());
        document.addEventListener("keydown",escape);
        return()=>{document.body.style.overflow=previous;document.removeEventListener("keydown",escape);window.requestAnimationFrame(()=>fullButton.current?.focus());};
    },[fullscreen]);
    const select = useRef(onSelect);
    select.current = onSelect;
    const [failed, setFailed] = useState(false);
    const [active, setActive] = useState<SphereEntry>();
    const [paused, setPaused] = useState(false);
    const pausedRef = useRef(false);
    pausedRef.current = paused;
    const available = items.filter((item) => item.cover).map((item) => ({ ...item, cover: bundledInspirationCover(item.cover, import.meta.env.BASE_URL) }));
    const bundled = available.filter((item) => !item.cover.startsWith("https:"));
    // Prefer the locally shipped selection for a dependable first view; smaller or personal
    // collections can still use their external covers through the authenticated proxy.
    const entries = (bundled.length >= 8 ? bundled : available).slice(0, 180);
    const key = entries.map((item) => item.id + item.cover).join("|");
    useEffect(() => {
        const element = host.current;
        if (!element || !entries.length) return;
        setFailed(false);
        setActive(undefined);
        let renderer: THREE.WebGLRenderer;
        try {
            renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
        } catch {
            setFailed(true);
            return;
        }
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        element.appendChild(renderer.domElement);
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 60);
        camera.position.set(0, 0, 0.5);
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.075;
        controls.enablePan = false;
        controls.minDistance = 0.5;
        controls.maxDistance = 0.5;
        controls.enableZoom = false;
        controls.rotateSpeed = 0.4;
        controls.zoomSpeed = 0.65;
        // Scrolling moves from an external globe into its interior; double-sided cards remain visible inside.
        controls.autoRotateSpeed = 0.25;
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
        const group = new THREE.Group();
        scene.add(group);
        const geometry = new THREE.PlaneGeometry(1.58, 1.02, 8, 1);
        const positions=geometry.attributes.position;
        for(let i=0;i<positions.count;i++) {const x=positions.getX(i);positions.setZ(i,10-Math.sqrt(100-x*x));}
        geometry.computeVertexNormals();
        const textures: THREE.Texture[] = [],
            materials: THREE.MeshBasicMaterial[] = [];
        const cards: THREE.Mesh[] = [];
        const loader = new THREE.TextureLoader();
        let disposed = false,
            visible = true;
        let settled = 0, loaded = 0;
        const center = new THREE.Vector3();
        // Surround the visitor with a continuous, dense image wall. Small collections
        // repeat around the sphere but retain their real distinct count and entry identity.
        const materialsByEntry = entries.map(() => new THREE.MeshBasicMaterial({color:"white",side:THREE.DoubleSide}));
        materials.push(...materialsByEntry);
        const cardsByEntry: THREE.Mesh[][] = entries.map(()=>[]);
        const columns=36, rows=15;
        for(let row=0;row<rows;row++)for(let column=0;column<columns;column++){
            const index=(row*columns+column)%entries.length, item=entries[index];
            const latitude=(row-(rows-1)/2)*0.105;
            const longitude=(column+(row%2)*0.38)*Math.PI*2/columns;
            const card=new THREE.Mesh(geometry,materialsByEntry[index]);
            card.position.set(Math.sin(longitude)*Math.cos(latitude)*10,Math.sin(latitude)*10,Math.cos(longitude)*Math.cos(latitude)*10);
            card.lookAt(center);card.visible=false;card.userData.item=item;
            group.add(card);cards.push(card);cardsByEntry[index].push(card);
        }
        entries.forEach((item,index)=>{
            const url=item.cover.startsWith("https:")?`/api/creator/prompt-image?url=${encodeURIComponent(item.cover)}`:item.cover;
            loader.load(url,(texture)=>{
                if(disposed){texture.dispose();return;}
                texture.colorSpace=THREE.SRGBColorSpace;textures.push(texture);
                const material=materialsByEntry[index];material.map=texture;material.needsUpdate=true;
                const image=texture.image as {width:number;height:number};
                for(const card of cardsByEntry[index]){
                    card.visible=true;
                    if(image.width&&image.height)card.scale.x=Math.min(1.05,Math.max(0.45,image.width/image.height/(1.58/1.02)));
                }
                settled++;loaded++;
            },undefined,()=>{if(disposed)return;settled++;if(settled===entries.length&&loaded===0)setFailed(true);});
        });
        const zoom=(event:WheelEvent)=>{event.preventDefault();camera.fov=THREE.MathUtils.clamp(camera.fov+event.deltaY*0.035,28,95);camera.updateProjectionMatrix();};
        renderer.domElement.addEventListener("wheel",zoom,{passive:false});
        const resize = new ResizeObserver(() => {
            const { width, height } = element.getBoundingClientRect();
            if (!width || !height) return;
            renderer.setSize(width, height);
            camera.aspect = width / height;
            camera.updateProjectionMatrix();
        });
        resize.observe(element);
        const visibility = new IntersectionObserver(([entry]) => {
            visible = entry.isIntersecting;
        });
        visibility.observe(element);
        const ray = new THREE.Raycaster(),
            point = new THREE.Vector2();
        let down = { x: 0, y: 0 };
        const pick = (event: PointerEvent) => {
            const rect = renderer.domElement.getBoundingClientRect();
            point.set(((event.clientX - rect.left) / rect.width) * 2 - 1, (-(event.clientY - rect.top) / rect.height) * 2 + 1);
            ray.setFromCamera(point, camera);
            return ray.intersectObjects(cards.filter((card) => card.visible))[0]?.object.userData.item as SphereEntry | undefined;
        };
        const move = (event: PointerEvent) => {
            const item = pick(event);
            setActive(item);
            renderer.domElement.style.cursor = item ? "pointer" : "grab";
        };
        const start = (event: PointerEvent) => {
            down = { x: event.clientX, y: event.clientY };
        };
        const end = (event: PointerEvent) => {
            if (Math.hypot(event.clientX - down.x, event.clientY - down.y) < 5) {
                const item = pick(event);
                if (item) select.current(item);
            }
        };
        const contextLost = (event: Event) => {
            event.preventDefault();
            setFailed(true);
        };
        renderer.domElement.addEventListener("pointermove", move);
        renderer.domElement.addEventListener("pointerdown", start);
        renderer.domElement.addEventListener("pointerup", end);
        renderer.domElement.addEventListener("webglcontextlost", contextLost);
        renderer.setAnimationLoop(() => {
            if (!visible || document.hidden) return;
            controls.autoRotate = !reduced.matches && !pausedRef.current;
            controls.update();
            renderer.render(scene, camera);
        });
        return () => {
            disposed = true;
            renderer.setAnimationLoop(null);
            resize.disconnect();
            visibility.disconnect();
            renderer.domElement.removeEventListener("wheel",zoom);
            controls.dispose();
            geometry.dispose();
            textures.forEach((texture) => texture.dispose());
            materials.forEach((material) => material.dispose());
            renderer.dispose();
            renderer.domElement.remove();
        };
        // Stable identity keys prevent recreation while hover titles change.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key,fullscreen]);
    const content = (
        <section className={`fg-sphere ${compact ? "is-compact" : ""} ${fullscreen ? "is-fullscreen" : ""}`} aria-label="灵感星球" role={fullscreen?"dialog":undefined} aria-modal={fullscreen||undefined}>
            <div className="fg-sphere-topline"><span>灵感星球 · {entries.length} 个作品</span></div>
            {toolbar ? <div className="fg-sphere-filters" aria-label="星球筛选">{toolbar}</div> : null}
            <Button ref={fullButton} className="fg-sphere-fullscreen" aria-label={fullscreen?"退出全屏漫游":"全屏漫游"} onClick={()=>setFullscreen(value=>!value)} icon={fullscreen?<Minimize2 size={18}/>:<Maximize2 size={18}/>}/>
            <div ref={host} className="fg-sphere-stage" style={{display: failed || !entries.length ? "none" : undefined}} />
            {failed || !entries.length ? <div className="fg-sphere-fallback">{failed ? "当前设备暂时无法显示星球视图，可在下方浏览作品。" : "当前筛选没有可展示的图片，试试其他分类。"}</div> : null}
            <div className="fg-sphere-center" aria-live="polite"><strong>{active?.title || collectionName}</strong><span>{active?"点击查看提示词":`${entries.length} 个作品`}</span></div>
            <div className="fg-sphere-help">拖动旋转 · 滚轮钻进 · 点击打开{fullscreen?" · Esc 退出":""}</div>
            <Button className="fg-sphere-pause" onClick={() => setPaused((value) => !value)} aria-pressed={paused}>
                {paused ? "继续旋转" : "暂停旋转"}
            </Button>
            <details className="fg-sphere-accessible">
                <summary>按作品名称浏览</summary>
                <div>
                    {entries.map((item) => (
                        <button key={item.id} onClick={() => select.current(item)}>
                            {item.title}
                        </button>
                    ))}
                </div>
            </details>
        </section>
    );
    return fullscreen?createPortal(content,document.body):content;
}
