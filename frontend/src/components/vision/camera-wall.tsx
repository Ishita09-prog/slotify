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

/** If the browser refused to play, step the clip by hand so the feed never looks frozen. */
export function unfreeze(v: HTMLVideoElement) {
  if (!v.paused || v.seeking || !v.duration) return;
  const t0 = Number(v.dataset.t0 || (v.dataset.t0 = String(performance.now() - v.currentTime * 1000)));
  const t = ((performance.now() - t0) / 1000) % v.duration;
  if (Math.abs(t - v.currentTime) > 0.08) v.currentTime = t;
}

export function CameraWall() {
  const { city } = useCity();
  const { actions } = useSlotify();
  const vids = useRef<(HTMLVideoElement | null)[]>([]);
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
        const v = vids.current[i];
        const feed = feeds[cam.feed];
        const c = canvases.current[i];
        if (!v || !feed || !c || v.readyState < 2) return st.push("");
        const [cx, cy, cw, ch] = cam.crop ?? [0, 0, feed.w, feed.h];
        unfreeze(v);
        const dpr = devicePixelRatio;
        const CW = c.clientWidth, CH = c.clientHeight;
        const W = CW * dpr, H = CH * dpr;
        if (c.width !== W || c.height !== H) {
          c.width = W;
          c.height = H;
        }
        // The real <video> sits under the canvas (browsers never pause a visible video). Position it so the crop fills the tile.
        const k = Math.min(CW / cw, CH / ch);
        const css = `left:${(CW - cw * k) / 2 - cx * k}px;top:${(CH - ch * k) / 2 - cy * k}px;width:${feed.w * k}px;height:${feed.h * k}px`;
        if (v.dataset.css !== css) {
          v.dataset.css = css;
          v.style.cssText = `position:absolute;max-width:none;object-fit:fill;${css}`;
        }
        const ctx = c.getContext("2d")!;
        const s = k * dpr;
        const ox = (W - cw * s) / 2, oy = (H - ch * s) / 2;
        ctx.clearRect(0, 0, W, H);
        // black out whatever of the frame lies outside this camera's crop
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, W, oy);
        ctx.fillRect(0, oy + ch * s, W, H - oy - ch * s);
        ctx.fillRect(0, 0, ox, H);
        ctx.fillRect(ox + cw * s, 0, W - ox - cw * s, H);
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

  // Autoplay can still be refused (Brave shields, battery saver). Nudge, and offer a tap-to-start; unfreeze() keeps frames moving meanwhile.
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    const kick = () => {
      vids.current.forEach((v) => {
        if (v && v.paused) v.play().then(() => setBlocked(false)).catch(() => setBlocked(true));
      });
    };
    kick();
    const i = window.setInterval(kick, 2000);
    document.addEventListener("visibilitychange", kick);
    return () => {
      window.clearInterval(i);
      document.removeEventListener("visibilitychange", kick);
    };
  }, []);
  const startAll = () => vids.current.forEach((v) => v?.play().then(() => setBlocked(false)).catch(() => {}));

  return (
    <div className="relative">
      {blocked && (
        <button onClick={startAll} className="absolute left-1/2 top-1/3 z-20 -translate-x-1/2 rounded-full bg-sky-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg">
          ▶ Start camera feeds
        </button>
      )}
      <div className="grid gap-2 lg:grid-cols-3">
        {CAMS.map((cam, i) => (
          <div key={cam.id} className={cn("relative overflow-hidden rounded-lg border border-[hsl(var(--cc-line))] bg-black", i === 0 ? "aspect-square lg:col-span-2 lg:row-span-3 lg:aspect-auto lg:min-h-[560px]" : "aspect-video")}>
            <video ref={(el) => { vids.current[i] = el; }} autoPlay muted loop playsInline preload="auto" disablePictureInPicture className="absolute inset-0 h-full w-full" onClick={startAll}>
              <source src={`${FEEDS[cam.feed].src}.webm`} type="video/webm" />
              <source src={`${FEEDS[cam.feed].src}.mp4`} type="video/mp4" />
            </video>
            <canvas ref={(el) => { canvases.current[i] = el; }} onClick={startAll} className="absolute inset-0 h-full w-full" />
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
