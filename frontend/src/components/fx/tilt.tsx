"use client";

import { useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Card that tilts toward the cursor with a soft spotlight following it. */
export function Tilt({ children, className, max = 7 }: { children: ReactNode; className?: string; max?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const move = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el || e.pointerType === "touch") return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    el.style.transform = `perspective(900px) rotateX(${(0.5 - y) * max}deg) rotateY(${(x - 0.5) * max}deg) translateY(-3px)`;
    el.style.setProperty("--mx", `${x * 100}%`);
    el.style.setProperty("--my", `${y * 100}%`);
  };
  const leave = () => {
    if (ref.current) ref.current.style.transform = "perspective(900px) rotateX(0) rotateY(0)";
  };
  return (
    <div ref={ref} onPointerMove={move} onPointerLeave={leave} className={cn("group/tilt relative transition-transform duration-200 ease-out will-change-transform [transform-style:preserve-3d]", className)}>
      {children}
      <span aria-hidden className="pointer-events-none absolute inset-0 rounded-3xl opacity-0 transition-opacity duration-300 group-hover/tilt:opacity-100" style={{ background: "radial-gradient(260px circle at var(--mx,50%) var(--my,50%), rgba(255,255,255,.16), transparent 60%)" }} />
    </div>
  );
}
