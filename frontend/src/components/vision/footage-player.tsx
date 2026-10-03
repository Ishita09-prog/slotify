"use client";

import { useEffect, useRef, useState } from "react";
import { unfreeze } from "./camera-wall";

/** Plays a recorded camera clip with the edge-AI bay overlay and an evidence watermark. */
export function FootagePlayer({ title, watermark, className }: { title: string; watermark?: string; className?: string }) {
  const v = useRef<HTMLVideoElement>(null);
  const c = useRef<HTMLCanvasElement>(null);
  const [feed, setFeed] = useState<{ fps: number; w: number; h: number; bayNames: string[]; frames: number[][][] } | null>(null);
  useEffect(() => {
    fetch("/feeds/lot-bays.tracks.json").then((r) => r.json()).then(setFeed).catch(() => {});
  }, []);
  useEffect(() => {
    const kick = () => v.current?.paused && v.current.play().catch(() => {});
    kick();
    const i = window.setInterval(kick, 1500);
    return () => window.clearInterval(i);
  }, []);
  useEffect(() => {
    if (!feed) return;
    let raf = 0;
    const draw = () => {
      const vid = v.current, cv = c.current;
      if (vid && cv && vid.readyState >= 2) {
        const dpr = devicePixelRatio, W = cv.clientWidth * dpr, H = cv.clientHeight * dpr;
        if (cv.width !== W || cv.height !== H) {
          cv.width = W;
          cv.height = H;
        }
        unfreeze(vid);
        const ctx = cv.getContext("2d")!;
        const s = Math.min(W / feed.w, H / feed.h), ox = (W - feed.w * s) / 2, oy = (H - feed.h * s) / 2;
        ctx.clearRect(0, 0, W, H);
        const f = feed.frames[Math.min(feed.frames.length - 1, Math.floor(vid.currentTime * feed.fps))] ?? [];
        ctx.font = `700 ${Math.round(10 * dpr)}px ui-monospace, monospace`;
        for (const [x, y, w, h, id, , cls] of f) {
          const empty = cls === 1;
          ctx.strokeStyle = empty ? "#22c55e" : "#ef4444";
          ctx.lineWidth = 2 * dpr;
          ctx.strokeRect(ox + x * s + 2, oy + y * s + 2, w * s - 4, h * s - 4);
          ctx.fillStyle = ctx.strokeStyle;
          ctx.fillText(`${feed.bayNames[id]} ${empty ? "EMPTY" : "OCC"}`, ox + x * s + 6, oy + y * s + 14 * dpr);
        }
        if (watermark) {
          ctx.fillStyle = "rgba(255,255,255,0.75)";
          ctx.font = `600 ${Math.round(10 * dpr)}px ui-monospace, monospace`;
          ctx.fillText(watermark, 10 * dpr, H - 10 * dpr);
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [feed, watermark]);
  return (
    <div className={`relative overflow-hidden rounded-lg bg-black ${className ?? "aspect-square"}`}>
      <video ref={v} autoPlay muted loop playsInline preload="auto" disablePictureInPicture className="absolute inset-0 h-full w-full object-contain">
        <source src="/feeds/lot-bays.webm" type="video/webm" />
        <source src="/feeds/lot-bays.mp4" type="video/mp4" />
      </video>
      <canvas ref={c} onClick={() => v.current?.play().catch(() => {})} className="absolute inset-0 h-full w-full" />
      <div className="pointer-events-none absolute left-2 top-2 flex items-center gap-1.5 rounded bg-black/60 px-2 py-0.5 font-mono text-[11px] text-white">
        <span className="size-2 animate-pulse rounded-full bg-red-500" /> {title}
      </div>
    </div>
  );
}
