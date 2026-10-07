import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";

const RippleDistortion = lazy(() => import("./react-bits/RippleDistortion.jsx"));
const MicroSlats = lazy(() => import("./react-bits/MicroSlats.jsx"));

export function WorkspaceAtmosphere() {
    const ref = useRef<HTMLDivElement>(null);
    const reduced = useReducedMotion();
    const [interactive, setInteractive] = useState(false);
    useEffect(() => {
        const media = window.matchMedia("(hover: hover) and (pointer: fine)");
        const update = () => setInteractive(media.matches && !reduced);
        update(); media.addEventListener("change", update);
        return () => media.removeEventListener("change", update);
    }, [reduced]);
    useEffect(() => {
        if (!interactive) return;
        let frame = 0;
        const move = (event: PointerEvent) => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
                ref.current?.style.setProperty("--atmosphere-x", `${(event.clientX / window.innerWidth - .5) * 14}px`);
                ref.current?.style.setProperty("--atmosphere-y", `${(event.clientY / window.innerHeight - .5) * 10}px`);
            });
        };
        window.addEventListener("pointermove", move, { passive: true });
        return () => { cancelAnimationFrame(frame); window.removeEventListener("pointermove", move); };
    }, [interactive]);
    return <div ref={ref} className="fg-workspace-atmosphere" aria-hidden="true">
        {interactive && <Suspense fallback={null}><RippleDistortion
            src={`${import.meta.env.BASE_URL}fg-visual/atelier-atmosphere.png`}
            strength={.012} swirl={.2} brushSize={85} fade={1.8} spread={2.5}
            grayscale={false} tint="#b2c7d4" tintAmount={.025} glint={.03}
            quality="low" style={{}} />
        </Suspense>}
    </div>;
}

export function AudioSlats() {
    const reduced = useReducedMotion();
    return <div className="fg-audio-slats" aria-hidden="true">{!reduced && <Suspense fallback={null}>
        <MicroSlats preset="signal" color="#7b9aab" glintColor="#eaf4f8" backgroundColor="transparent" speed={.3} interactive cursorStrength={.3} slatWidth={4} slatHeight={18} gap={4} scale={undefined} direction={undefined} chop={undefined} stretch={undefined} glint={undefined} contrast={undefined} perspective={undefined} fog={undefined} style={{}} />
    </Suspense>}</div>;
}
