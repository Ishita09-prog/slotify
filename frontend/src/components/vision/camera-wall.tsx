"use client";

import { useEffect, useRef, useState } from "react";
import { Cpu, Link2 } from "lucide-react";
import { useCity } from "@/lib/city";
import { useSlotify } from "@/lib/store";
import { cn } from "@/lib/utils";

/**
 * Camera wall. Recorded parking footage processed by the edge AI box; per-frame results (vehicle boxes or bay
 * states) are streamed as JSON exactly as an edge device would send them, and drawn in sync with the video.
 * The bay camera is linked to a real lot: when a bay changes, it changes in the driver app too.
 */

interface Feed {
  fps: number;
  w: number;
  h: number;
  model: string;
  classes: string[];
  bayNames?: string[];
  frames: number[][][]; // [x, y, w, h, id, score, cls]
}

interface Cam {
  id: string;
  name: string;
  feed: "bays" | "aerial";
  crop?: [number, number, number, number];
}

const FEEDS = {
  bays: { src: "/feeds/lot-bays", data: "/feeds/lot-bays.tracks.json" },
  aerial: { src: "/feeds/lot-aerial", data: "/feeds/lot-aerial.tracks.json" },
};

const CAMS: Cam[] = [
  { id: "CAM-01", name: "Bay camera · rows A–B", feed: "bays" },
  { id: "CAM-02", name: "Drone · full lot", feed: "aerial" },
  { id: "CAM-03", name: "Drone · west rows", feed: "aerial", crop: [0, 360, 440, 248] },
  { id: "CAM-04", name: "Drone · east rows", feed: "aerial", crop: [660, 360, 540, 304] },
];

const LINK_LOT = "vl-phoenix";

export function CameraWall() {
  const { city } = useCity();
  const { actions } = useSlotify();
  const vids = useRef<Record<string, HTMLVideoElement | null>>({});
  const canvases = useRef<(HTMLCanvasElement | null)[]>([]);
  const [feeds, setFeeds] = useState<Partial<Record<keyof typeof FEEDS, Feed>>>({});
  const [stats, setStats] = useState<string[]>(CAMS.map(() => ""));
  const [bayStates, setBayStates] = useState<{ name: string; empty: boolean }[]>([]);
  const [clock, setClock] = useState("");
  const lotId: string = city.lots.some((l) => l.id === LINK_LOT) ? LINK_LOT : city.lots[0].id;
  const lotName = city.lots.find((l) => l.id === lotId)?.name ?? "";
  const committed = useRef<Record<string, boolean>>({});

  useEffect(() => {
    (Object.keys(FEEDS) as (keyof typeof FEEDS)[]).forEach((k) =>
      fetch(FEEDS[k].data).then((r) => r.json()).then((f: Feed) => setFeeds((p) => ({ ...p, [k]: f }))).catch(() => {})
    );
  }, []);

  // release the linked bays when leaving the page
  useEffect(() => {
    const c = committed.current;
    return () => {
      for (const name of Object.keys(c)) actions.cameraBay(lotId, name, null);
    };
  }, [lotId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let raf = 0;
    let lastKey = "";
    const draw = () => {
      const st: string[] = [];
      CAMS.forEach((cam, i) => {
        const v = vids.current[cam.feed];
        const feed = feeds[cam.feed];
        const c = canvases.current[i];
        if (!v || !feed || !c || v.readyState < 2) return st.push("");
        const [cx, cy, cw, ch] = cam.crop ?? [0, 0, feed.w, feed.h];
        const sx = v.videoWidth / feed.w, sy = v.videoHeight / feed.h;
        const dpr = devicePixelRatio;
        const W = c.clientWidth * dpr, H = c.clientHeight * dpr;
        if (c.width !== W || c.height !== H) {
          c.width = W;
          c.height = H;
        }
        const ctx = c.getContext("2d")!;
        // keep aspect: fit crop into canvas (letterbox)
        const s = Math.min(W / cw, H / ch);
        const ox = (W - cw * s) / 2, oy = (H - ch * s) / 2;
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, W, H);
        ctx.drawImage(v, cx * sx, cy * sy, cw * sx, ch * sy, ox, oy, cw * s, ch * s);
        const f = feed.frames[Math.min(feed.frames.length - 1, Math.floor(v.currentTime * feed.fps))] ?? [];
        ctx.font = `700 ${Math.round(11 * dpr)}px ui-monospace, monospace`;
        let n = 0, free = 0;
        const bays: { name: string; empty: boolean }[] = [];
        for (const b of f) {
          const [x, y, w, h, id, score, cls] = b;
          const mx = x + w / 2, my = y + h / 2;
          if (mx < cx || mx > cx + cw || my < cy || my > cy + ch) continue;
          const X = ox + (x - cx) * s, Y = oy + (y - cy) * s, BW = w * s, BH = h * s;
          if (cam.feed === "bays") {
            const empty = cls === 1;
            const name = feed.bayNames?.[id] ?? `B${id}`;
            bays.push({ name, empty });
            if (empty) free++;
            ctx.fillStyle = empty ? "rgba(34,197,94,0.28)" : "rgba(239,68,68,0.22)";
            ctx.fillRect(X + 3, Y + 3, BW - 6, BH - 6);
            ctx.strokeStyle = empty ? "#22c55e" : "#ef4444";
            ctx.lineWidth = 2.5 * dpr;
            ctx.strokeRect(X + 3, Y + 3, BW - 6, BH - 6);
            const t = `${name} ${empty ? "EMPTY" : "OCCUPIED"} ${Math.round(score * 100)}%`;
            const tw = ctx.measureText(t).width + 8 * dpr;
            ctx.fillStyle = empty ? "#22c55e" : "#ef4444";
            ctx.fillRect(X + 3, Y + 3, tw, 16 * dpr);
            ctx.fillStyle = "#fff";
            ctx.fillText(t, X + 3 + 4 * dpr, Y + 3 + 12 * dpr);
          } else {
            n++;
            ctx.strokeStyle = "#38bdf8";
            ctx.lineWidth = Math.max(1.5 * dpr, 1.2 * s);
            ctx.strokeRect(X, Y, BW, BH);
            if (s > 1.6) {
              const t = `car ${Math.round(score * 100)}%`;
              ctx.fillStyle = "#38bdf8";
              ctx.fillRect(X, Y - 14 * dpr, ctx.measureText(t).width + 6 * dpr, 14 * dpr);
              ctx.fillStyle = "#03111d";
              ctx.fillText(t, X + 3 * dpr, Y - 3 * dpr);
            }
          }
        }
        if (cam.feed === "bays") {
          st.push(`${free} of ${bays.length} bays free`);
          const key = bays.map((b) => +b.empty).join("");
          if (key !== lastKey) {
            lastKey = key;
            setBayStates(bays);
            for (const b of bays) {
              if (committed.current[b.name] !== !b.empty) {
                committed.current[b.name] = !b.empty;
                actions.cameraBay(lotId, b.name, !b.empty, 0.95);
              }
            }
          }
        } else st.push(`${n} vehicles`);
      });
      setStats((p) => (p.join("|") === st.join("|") ? p : st));
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    const t = window.setInterval(() => setClock(new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour12: false })), 1000);
    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(t);
    };
  }, [feeds, actions, lotId]);

  return (
    <div>
      {(Object.keys(FEEDS) as (keyof typeof FEEDS)[]).map((k) => (
        <video key={k} ref={(el) => { vids.current[k] = el; }} autoPlay muted loop playsInline className="hidden">
          <source src={`${FEEDS[k].src}.webm`} type="video/webm" />
          <source src={`${FEEDS[k].src}.mp4`} type="video/mp4" />
        </video>
      ))}
      <div className="grid gap-2 lg:grid-cols-3">
        {CAMS.map((cam, i) => (
          <div key={cam.id} className={cn("relative overflow-hidden rounded-lg border border-[hsl(var(--cc-line))] bg-black", i === 0 ? "aspect-square lg:col-span-2 lg:row-span-3 lg:aspect-auto lg:min-h-[560px]" : "aspect-video")}>
            <canvas ref={(el) => { canvases.current[i] = el; }} className="absolute inset-0 h-full w-full" />
            <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/80 to-transparent px-2.5 py-1.5 font-mono text-[11px] text-white">
              <span className="flex items-center gap-1.5"><span className="size-2 animate-pulse rounded-full bg-red-500" /> {cam.id} · {cam.name}</span>
              <span>{clock}</span>
            </div>
            <div className="pointer-events-none absolute bottom-1.5 left-2 rounded bg-black/70 px-2 py-0.5 font-mono text-[11px] text-emerald-300">{stats[i] || "loading…"}</div>
          </div>
        ))}
      </div>
      <div className="mt-2 grid gap-2 text-[11px] text-[hsl(var(--cc-dim))] lg:grid-cols-2">
        <p className="flex items-start gap-1.5"><Link2 className="mt-0.5 size-3.5 shrink-0 text-emerald-400" /> <span>CAM-01 is linked to <b className="text-slate-200">{lotName}</b>: bays {bayStates.filter((b) => b.empty).map((b) => b.name).join(", ") || "—"} are free; changes appear on drivers&apos; phones instantly.</span></p>
        <p className="flex items-start gap-1.5"><Cpu className="mt-0.5 size-3.5 shrink-0 text-sky-400" /> <span>CAM-01: {feeds.bays?.model ?? "…"}. CAM-02–04: {feeds.aerial?.model ?? "…"}.</span></p>
      </div>
    </div>
  );
}
