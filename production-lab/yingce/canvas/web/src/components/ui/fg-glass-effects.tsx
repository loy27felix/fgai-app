import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from "react";
import { useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import "./fg-glass-effects.css";

// Adapted from David Haz's React Bits SpotlightCard and Magnet.
// Source and MIT + Commons Clause notice: ./react-bits-LICENSE.md.
export function SpotlightCard({ children, className, as: Element = "div", ...props }: HTMLAttributes<HTMLElement> & { as?: "div" | "article"; children: ReactNode }) {
    const ref = useRef<HTMLDivElement>(null);
    const reducedMotion = useReducedMotion();
    return <Element {...props} ref={ref} className={cn("fg-spotlight-card", className)} onPointerMove={(event) => {
        if (reducedMotion || event.pointerType !== "mouse" || !ref.current) return;
        const rect = ref.current.getBoundingClientRect();
        ref.current.style.setProperty("--mouse-x", `${event.clientX - rect.left}px`);
        ref.current.style.setProperty("--mouse-y", `${event.clientY - rect.top}px`);
    }}>{children}</Element>;
}

export function Magnet({ children, className }: { children: ReactNode; className?: string }) {
    const ref = useRef<HTMLDivElement>(null);
    const reducedMotion = useReducedMotion();
    const [position, setPosition] = useState({ x: 0, y: 0 });
    useEffect(() => {
        if (reducedMotion || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
            setPosition({ x: 0, y: 0 });
            return;
        }
        const move = (event: MouseEvent) => {
            if (!ref.current) return;
            const { left, top, width, height } = ref.current.getBoundingClientRect();
            const x = event.clientX - left - width / 2;
            const y = event.clientY - top - height / 2;
            const next = Math.abs(x) < width / 2 + 24 && Math.abs(y) < height / 2 + 24 ? { x: x / 10, y: y / 10 } : { x: 0, y: 0 };
            setPosition((current) => current.x === next.x && current.y === next.y ? current : next);
        };
        window.addEventListener("mousemove", move, { passive: true });
        return () => window.removeEventListener("mousemove", move);
    }, [reducedMotion]);
    return <div ref={ref} className={cn("fg-magnet", className)}><div style={{ transform: `translate3d(${position.x}px, ${position.y}px, 0)` }}>{children}</div></div>;
}

export function GlassAgent({ size = 64, className }: { size?: number; className?: string }) {
    return <span className={cn("fg-glass-agent", className)} style={{ width: size, height: size }} aria-hidden="true"><img src="/fg-visual/agent-glass-orb.png" width={size} height={size} alt="" draggable={false} /><span className="fg-glass-agent-light" /></span>;
}
