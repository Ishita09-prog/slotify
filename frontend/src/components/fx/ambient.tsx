"use client";

import { useEffect, useRef } from "react";

/** Floating particles + soft light that follows the cursor. Purely decorative, never blocks clicks. */
export function Ambient() {
  const cv = useRef<HTMLCanvasElement>(null);
  const glow = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const c = cv.current!, ctx = c.getContext("2d")!;
    let W = 0, H = 0, raf = 0;
    const dpr = Math.min(2, devicePixelRatio);
    const resize = () => {
      W = innerWidth; H = innerHeight;
      c.width = W * dpr; c.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const N = Math.round(Math.min(70, (W * H) / 22000));
    const ps = Array.from({ length: N }, () => ({ x: Math.random() * W, y: Math.random() * H, r: 0.6 + Math.random() * 1.6, vx: (Math.random() - 0.5) * 0.18, vy: -0.05 - Math.random() * 0.22, a: 0.15 + Math.random() * 0.45, ph: Math.random() * 6.28 }));
    let mx = -999, my = -999;
    const move = (e: PointerEvent) => {
      mx = e.clientX; my = e.clientY;
      if (glow.current) glow.current.style.transform = `translate3d(${mx - 260}px, ${my - 260}px, 0)`;
    };
    const tick = (t: number) => {
      ctx.clearRect(0, 0, W, H);
      for (const p of ps) {
        p.x += p.vx; p.y += p.vy;
        const dx = p.x - mx, dy = p.y - my, d2 = dx * dx + dy * dy;
        if (d2 < 14000) { p.x += dx * 0.004; p.y += dy * 0.004; } // particles drift away from the cursor
        if (p.y < -5) { p.y = H + 5; p.x = Math.random() * W; }
        if (p.x < -5) p.x = W + 5; else if (p.x > W + 5) p.x = -5;
        const tw = 0.6 + 0.4 * Math.sin(t / 900 + p.ph);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, 6.283);
        ctx.fillStyle = `rgba(148, 197, 255, ${p.a * tw})`;
        ctx.fill();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    addEventListener("resize", resize);
    addEventListener("pointermove", move);
    return () => { cancelAnimationFrame(raf); removeEventListener("resize", resize); removeEventListener("pointermove", move); };
  }, []);
  return (
    <>
      <canvas ref={cv} aria-hidden className="pointer-events-none fixed inset-0 z-[60] h-full w-full opacity-70 mix-blend-screen" />
      <div ref={glow} aria-hidden className="pointer-events-none fixed left-0 top-0 z-[60] hidden size-[520px] rounded-full mix-blend-soft-light md:block" style={{ background: "radial-gradient(circle, rgba(125,180,255,.35) 0%, rgba(125,180,255,.08) 40%, transparent 70%)", transform: "translate3d(-999px,-999px,0)" }} />
    </>
  );
}
