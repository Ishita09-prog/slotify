"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, CameraOff, ImageUp, Loader2, ScanLine } from "lucide-react";
import { loadAnpr, readPlates, type PlateRead } from "@/lib/vision/anpr";
import { cn } from "@/lib/utils";

/** Gate ANPR camera: webcam / phone camera / uploaded photo → plate text. */
export function GateCamera({ onRead, disabled }: { onRead: (plate: string, conf: number, raw?: string) => void; disabled?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const img = useRef<HTMLImageElement | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const [mode, setMode] = useState<"off" | "camera" | "photo">("off");
  const [model, setModel] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [reads, setReads] = useState<PlateRead[]>([]);
  const [ms, setMs] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const last = useRef<{ text: string; n: number }>({ text: "", n: 0 });
  const fired = useRef<{ text: string; at: number }>({ text: "", at: 0 });
  const cb = useRef(onRead);
  cb.current = onRead;

  const ensureModel = async () => {
    if (model === "ready") return true;
    setModel("loading");
    try {
      await loadAnpr();
      setModel("ready");
      return true;
    } catch (e) {
      setErr((e as Error).message);
      setModel("error");
      return false;
    }
  };

  const stop = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };
  useEffect(() => stop, []);

  const startCamera = async () => {
    setErr(null);
    if (!(await ensureModel())) return;
    try {
      stop();
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      stream.current = s;
      if (video.current) {
        video.current.srcObject = s;
        await video.current.play();
      }
      setMode("camera");
    } catch {
      setErr("Camera blocked. Allow camera access, or upload a photo instead.");
    }
  };

  const fire = (r: PlateRead) => {
    const now = Date.now();
    if (fired.current.text === r.text && now - fired.current.at < 10000) return;
    fired.current = { text: r.text, at: now };
    cb.current(r.text, r.conf, r.raw);
  };

  const draw = (src: HTMLVideoElement | HTMLImageElement, rs: PlateRead[]) => {
    const c = canvas.current;
    if (!c) return;
    const sw = (src as HTMLVideoElement).videoWidth || (src as HTMLImageElement).naturalWidth;
    const sh = (src as HTMLVideoElement).videoHeight || (src as HTMLImageElement).naturalHeight;
    c.width = sw;
    c.height = sh;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, sw, sh);
    if (mode === "photo" || src instanceof HTMLImageElement) ctx.drawImage(src, 0, 0);
    const k = Math.max(1, sw / 640);
    for (const r of rs) {
      ctx.strokeStyle = r.valid ? "#22c55e" : "#f59e0b";
      ctx.lineWidth = 3 * k;
      ctx.strokeRect(r.box.x, r.box.y, r.box.w, r.box.h);
      ctx.font = `700 ${Math.round(16 * k)}px ui-monospace, monospace`;
      const t = `${r.twoLine ? "2-line " : ""}${r.text} ${Math.round(r.conf * 100)}%`;
      const tw = ctx.measureText(t).width + 10 * k;
      ctx.fillStyle = r.valid ? "#22c55e" : "#f59e0b";
      ctx.fillRect(r.box.x, r.box.y - 22 * k, tw, 22 * k);
      ctx.fillStyle = "#04130a";
      ctx.fillText(t, r.box.x + 5 * k, r.box.y - 6 * k);
    }
  };

  // live loop
  useEffect(() => {
    if (mode !== "camera") return;
    let alive = true;
    const loop = async () => {
      const v = video.current;
      if (!alive || !v) return;
      if (v.readyState >= 2) {
        const t0 = performance.now();
        try {
          const rs = await readPlates(v);
          setMs(Math.round(performance.now() - t0));
          setReads(rs);
          draw(v, rs);
          const best = rs.filter((r) => (r.valid || r.raw.length >= 8) && r.conf > 0.6).sort((a, b) => b.conf - a.conf)[0];
          if (best) {
            last.current = last.current.text === best.text ? { text: best.text, n: last.current.n + 1 } : { text: best.text, n: 1 };
            if (last.current.n >= 2 && !disabled) fire(best);
          }
        } catch (e) {
          console.warn(e);
        }
      }
      if (alive) window.setTimeout(loop, 350);
    };
    void loop();
    return () => {
      alive = false;
    };
  }, [mode, disabled]); // eslint-disable-line react-hooks/exhaustive-deps

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setErr(null);
    stop();
    if (!(await ensureModel())) return;
    const im = new Image();
    im.src = URL.createObjectURL(f);
    await im.decode();
    img.current = im;
    setMode("photo");
    const t0 = performance.now();
    const rs = await readPlates(im, 0.25);
    setMs(Math.round(performance.now() - t0));
    setReads(rs);
    draw(im, rs);
    const best = rs.sort((a, b) => Number(b.valid) - Number(a.valid) || b.conf - a.conf)[0];
    if (best && !disabled) {
      fired.current = { text: "", at: 0 };
      fire(best);
    }
    if (!rs.length) setErr("No number plate found in this photo. Try a closer, straighter shot.");
  };

  return (
    <div>
      <div className="relative aspect-video overflow-hidden rounded-xl bg-black">
        <video ref={video} muted playsInline className={cn("absolute inset-0 h-full w-full object-contain", mode !== "camera" && "hidden")} />
        <canvas ref={canvas} className={cn("absolute inset-0 h-full w-full object-contain", mode === "off" && "hidden")} />
        {mode === "off" && (
          <div className="absolute inset-0 grid place-items-center text-center text-sm text-white/70">
            <div>
              <ScanLine className="mx-auto mb-2 size-8 text-white/50" />
              ANPR gate camera
              <p className="text-xs text-white/40">Point a phone or webcam at the number plate, or upload a photo</p>
            </div>
          </div>
        )}
        <div className="absolute left-2 top-2 flex items-center gap-1.5 rounded bg-black/60 px-2 py-0.5 font-mono text-[11px] text-white">
          <span className={cn("size-2 rounded-full", mode === "camera" ? "animate-pulse bg-red-500" : "bg-white/40")} /> ANPR · {model === "loading" ? "loading models…" : model === "ready" ? `plate detector + OCR${ms ? ` · ${ms} ms` : ""}` : "idle"}
        </div>
        {reads[0] && (
          <div className="absolute bottom-2 right-2 rounded-lg bg-white px-2 py-1 font-display text-lg font-extrabold tracking-wider text-slate-900 shadow">
            {reads[0].text} <span className={cn("ml-1 text-xs", reads[0].valid ? "text-emerald-600" : "text-amber-600")}>{reads[0].valid ? "✓" : "?"}</span>
          </div>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {mode === "camera" ? (
          <button onClick={() => { stop(); setMode("off"); }} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold hover:bg-secondary/60"><CameraOff className="size-3.5" /> Stop camera</button>
        ) : (
          <button onClick={startCamera} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold hover:bg-secondary/60">
            {model === "loading" ? <Loader2 className="size-3.5 animate-spin" /> : <Camera className="size-3.5" />} Start camera
          </button>
        )}
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold hover:bg-secondary/60">
          <ImageUp className="size-3.5" /> Upload photo
          <input type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        {reads.length > 0 && <span className="self-center text-[11px] text-muted-foreground">raw OCR: {reads.map((r) => r.raw).join(", ")}</span>}
      </div>
      {err && <p className="mt-1 text-xs text-status-reserved">{err}</p>}
    </div>
  );
}
