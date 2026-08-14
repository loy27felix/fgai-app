"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

type LiquidEtherProps = {
  colors?: string[];
  className?: string;
  resolution?: number;
  autoSpeed?: number;
  autoIntensity?: number;
};

function color(value: string, fallback: string) {
  try {
    return new THREE.Color(value);
  } catch {
    return new THREE.Color(fallback);
  }
}

/**
 * A deliberately light version of the Liquid Ether field. It keeps the
 * water-like WebGL movement from the supplied React Bits effect but renders at
 * a capped resolution so it can sit above a looping hero film without fighting
 * the page's text, controls or battery life.
 */
export default function LiquidEther({
  colors = ["#ffb4cf", "#72ecff", "#8a38ff"],
  className = "",
  resolution = 0.38,
  autoSpeed = 0.5,
  autoIntensity = 1.35,
}: LiquidEtherProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const colorKey = colors.join("|");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, powerPreference: "low-power" });
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.setAttribute("aria-hidden", "true");
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const palette = [color(colors[0] || "#ffb4cf", "#ffb4cf"), color(colors[1] || "#72ecff", "#72ecff"), color(colors[2] || "#8a38ff", "#8a38ff")];
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uPointer: { value: new THREE.Vector2(0.74, 0.42) },
        uColorA: { value: palette[0] },
        uColorB: { value: palette[1] },
        uColorC: { value: palette[2] },
        uIntensity: { value: autoIntensity },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        uniform float uTime;
        uniform vec2 uResolution;
        uniform vec2 uPointer;
        uniform vec3 uColorA;
        uniform vec3 uColorB;
        uniform vec3 uColorC;
        uniform float uIntensity;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }
        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        float fbm(vec2 p) {
          float value = 0.0;
          float gain = 0.56;
          for (int i = 0; i < 4; i++) {
            value += gain * noise(p);
            p = p * 2.08 + 7.4;
            gain *= 0.52;
          }
          return value;
        }
        void main() {
          vec2 uv = vUv;
          vec2 p = uv - 0.5;
          p.x *= uResolution.x / max(uResolution.y, 1.0);
          float t = uTime * 0.22;
          float field = fbm(p * 2.35 + vec2(t, -t * 0.66));
          float ripple = sin(p.x * 5.0 + p.y * 3.0 + field * 8.0 + t * 8.0) * 0.5 + 0.5;
          float pointer = exp(-length(uv - uPointer) * 7.5) * 0.58;
          float wave = smoothstep(0.2, 0.88, ripple + field * 0.42 + pointer);
          float edge = smoothstep(1.16, 0.18, length(p));
          vec3 tone = mix(uColorA, uColorB, smoothstep(0.18, 0.82, field));
          tone = mix(tone, uColorC, smoothstep(0.62, 1.02, ripple + pointer));
          float alpha = wave * edge * 0.6 * uIntensity;
          gl_FragColor = vec4(tone, alpha);
        }
      `,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    scene.add(mesh);

    let width = 1;
    let height = 1;
    let frame = 0;
    let visible = true;
    let disposed = false;
    const clock = new THREE.Clock();
    const demoTarget = new THREE.Vector2();

    const resize = () => {
      const rect = host.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.35);
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(Math.max(1, Math.round(width * resolution)), Math.max(1, Math.round(height * resolution)), false);
      material.uniforms.uResolution.value.set(width, height);
    };
    const move = (event: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      material.uniforms.uPointer.value.set(
        Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(rect.width, 1))),
        Math.max(0, Math.min(1, 1 - (event.clientY - rect.top) / Math.max(rect.height, 1))),
      );
    };
    const render = () => {
      if (disposed) return;
      if (visible && !document.hidden) {
        const elapsed = clock.getElapsedTime();
        const demo = material.uniforms.uPointer.value;
        demoTarget.set(0.73 + Math.sin(elapsed * autoSpeed) * 0.13, 0.46 + Math.cos(elapsed * autoSpeed * 0.72) * 0.13);
        demo.lerp(demoTarget, 0.012);
        material.uniforms.uTime.value = elapsed;
        renderer.render(scene, camera);
      }
      frame = requestAnimationFrame(render);
    };

    const observer = new IntersectionObserver(([entry]) => { visible = Boolean(entry?.isIntersecting); }, { threshold: 0.01 });
    const resizeObserver = new ResizeObserver(resize);
    observer.observe(host);
    resizeObserver.observe(host);
    window.addEventListener("pointermove", move, { passive: true });
    resize();
    render();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener("pointermove", move);
      mesh.geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [autoIntensity, autoSpeed, colorKey, resolution]);

  return <div ref={hostRef} className={`liquid-ether-container ${className}`} />;
}
