"use client";

import type { CSSProperties, ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

type ScrollExpandProps = {
  src: string;
  mediaType?: "image" | "video";
  poster?: string;
  alt?: string;
  title?: string;
  scrollHint?: string;
  startWidth?: number;
  startHeight?: number;
  startRadius?: number;
  endRadius?: number;
  mediaZoom?: number;
  scrollDistance?: number;
  holdDistance?: number;
  smoothing?: number;
  overlayScrim?: number;
  useWindowScroll?: boolean;
  enabled?: boolean;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  fallbackSrc?: string;
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

function smoothstep(edge0: number, edge1: number, value: number) {
  const progress = clamp((value - edge0) / (edge1 - edge0 || 0.000001), 0, 1);
  return progress * progress * (3 - 2 * progress);
}

export default function ScrollExpand({
  src,
  mediaType = "image",
  poster = "",
  alt = "",
  title = "",
  scrollHint = "",
  startWidth = 42,
  startHeight = 58,
  startRadius = 24,
  endRadius = 0,
  mediaZoom = 1.35,
  scrollDistance = 1.2,
  holdDistance = 0.35,
  smoothing = 0.1,
  overlayScrim = 0.45,
  useWindowScroll = false,
  enabled = true,
  children,
  className = "",
  style,
  fallbackSrc = "",
}: ScrollExpandProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const mediaRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const hintRef = useRef<HTMLDivElement>(null);
  const [videoFailed, setVideoFailed] = useState(false);

  const propsRef = useRef({
    startWidth,
    startHeight,
    startRadius,
    endRadius,
    mediaZoom,
    scrollDistance,
    holdDistance,
    smoothing,
    overlayScrim,
    useWindowScroll,
    enabled,
  });
  propsRef.current = { startWidth, startHeight, startRadius, endRadius, mediaZoom, scrollDistance, holdDistance, smoothing, overlayScrim, useWindowScroll, enabled };

  const applyProgress = useCallback((progress: number) => {
    const frame = frameRef.current;
    const media = mediaRef.current;
    if (!frame || !media) return;

    const settings = propsRef.current;
    const eased = smoothstep(0, 1, progress);
    const width = settings.startWidth + (100 - settings.startWidth) * eased;
    const height = settings.startHeight + (100 - settings.startHeight) * eased;
    const insetX = Math.max(0, (100 - width) / 2);
    const insetY = Math.max(0, (100 - height) / 2);
    const radius = settings.startRadius + (settings.endRadius - settings.startRadius) * eased;
    frame.style.clipPath = `inset(${insetY}% ${insetX}% ${insetY}% ${insetX}% round ${radius}px)`;
    media.style.transform = `scale(${settings.mediaZoom + (1 - settings.mediaZoom) * eased})`;

    if (scrimRef.current) scrimRef.current.style.opacity = `${settings.overlayScrim * eased}`;
    if (titleRef.current) {
      const leave = smoothstep(0.38, 0.84, progress);
      titleRef.current.style.opacity = `${1 - leave}`;
      titleRef.current.style.transform = `translate3d(0, ${-28 * leave}px, 0) scale(${1 + 0.055 * leave})`;
    }
    if (hintRef.current) {
      const leave = smoothstep(0, 0.12, progress);
      hintRef.current.style.opacity = `${1 - leave}`;
      hintRef.current.style.transform = `translate3d(0, ${8 * leave}px, 0)`;
    }
    if (overlayRef.current) {
      const enter = smoothstep(0.64, 1, progress);
      overlayRef.current.style.opacity = `${enter}`;
      overlayRef.current.style.transform = `translate3d(0, ${20 * (1 - enter)}px, 0)`;
    }
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    const track = trackRef.current;
    const stage = stageRef.current;
    if (!root || !track || !stage) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let current = 0;
    let target = 0;
    let stageHeight = 0;
    let running = false;

    const measure = () => {
      const settings = propsRef.current;
      stageHeight = settings.useWindowScroll ? window.innerHeight : root.clientHeight;
      if (stageHeight <= 0) return;
      stage.style.height = `${stageHeight}px`;
      track.style.height = `${stageHeight * (1 + Math.max(0, settings.scrollDistance) + Math.max(0, settings.holdDistance))}px`;
      stage.style.setProperty("--se-title-size", `${clamp((root.clientWidth || stageHeight) * 0.072, 28, 112)}px`);
    };

    const readProgress = () => {
      const settings = propsRef.current;
      if (!settings.enabled) return 1;
      const span = stageHeight * Math.max(0.01, settings.scrollDistance);
      if (settings.useWindowScroll) return clamp(-track.getBoundingClientRect().top / span, 0, 1);
      return clamp(root.scrollTop / span, 0, 1);
    };

    const tick = () => {
      const settings = propsRef.current;
      const speed = settings.smoothing <= 0 ? 1 : 1 - Math.exp(-1 / (60 * settings.smoothing));
      current += (target - current) * speed;
      if (Math.abs(target - current) < 0.0004) {
        current = target;
        running = false;
      }
      applyProgress(current);
      raf = running ? requestAnimationFrame(tick) : 0;
    };

    const onScroll = () => {
      target = readProgress();
      if (propsRef.current.smoothing <= 0 || reduceMotion) {
        current = target;
        applyProgress(current);
        return;
      }
      if (!running) {
        running = true;
        raf = requestAnimationFrame(tick);
      }
    };
    const onResize = () => {
      measure();
      current = readProgress();
      target = current;
      applyProgress(current);
    };

    measure();
    current = readProgress();
    target = current;
    applyProgress(current);
    const scroller = useWindowScroll ? window : root;
    scroller.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    const observer = new ResizeObserver(onResize);
    observer.observe(root);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      scroller.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      observer.disconnect();
    };
  }, [applyProgress, useWindowScroll]);

  const media = mediaType === "video" && !videoFailed ? (
    <video ref={mediaRef as any} className="scroll-expand__media" poster={poster} autoPlay muted loop playsInline preload="metadata" disablePictureInPicture onError={() => setVideoFailed(true)}>
      <source src={src} type="video/mp4" />
    </video>
  ) : (
    <img ref={mediaRef as any} className="scroll-expand__media" src={fallbackSrc || src} alt={alt} draggable={false} />
  );

  return <div ref={rootRef} className={`scroll-expand ${useWindowScroll ? "" : "scroll-expand--scroller"} ${className}`.trim()} style={style}>
    <div ref={trackRef} className="scroll-expand__track">
      <div ref={stageRef} className="scroll-expand__stage">
        <div ref={frameRef} className="scroll-expand__frame">
          {media}
          <div ref={scrimRef} className="scroll-expand__scrim" />
          {children ? <div ref={overlayRef} className="scroll-expand__overlay">{children}</div> : null}
        </div>
        {title ? <div ref={titleRef} className="scroll-expand__title">{title}</div> : null}
        {scrollHint ? <div ref={hintRef} className="scroll-expand__hint">{scrollHint}</div> : null}
      </div>
    </div>
  </div>;
}
