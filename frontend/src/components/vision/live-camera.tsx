"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Film, Minus, PencilRuler, RotateCcw, ScanLine, X } from "lucide-react";
import { useCity } from "@/lib/city";
import { useSlotify } from "@/lib/store";
import { coverage, detect, detectTiled, loadDetector, type Detection } from "@/lib/vision/yolo";
import { cn } from "@/lib/utils";

type Bay = { x: number; y: number; w: number; h: number }; // normalised 0..1 of the frame
const defaultBays = (n: number): Bay[] => Array.from({ length: n }, (_, i) => ({ x: 0.04 + (i * 0.92) / n, y: 0.42, w: 0.92 / n - 0.03, h: 0.5 }));
const OCCUPIED_AT = 0.3; // a bay is occupied when ≥30% of it is covered by a vehicle box
const STABLE_FRAMES = 3;

/** Header button + floating panel. */
export function LiveCameraLauncher({ dark }: { dark?: boolean }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      if (window.sessionStorage.getItem("slotify:cam") === "1") setOpen(true);
    } catch {
      /* ignore */
    }
  }, []);
  const toggle = (v: boolean) => {
    setOpen(v);
    try {
      window.sessionStorage.setItem("slotify:cam", v ? "1" : "0");
    } catch {
      /* ignore */
    }
  };
  return (
    <>
      <button
        onClick={() => toggle(!open)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-semibold transition-colors",
          dark ? "border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10" : "border-status-available/50 text-status-available hover:bg-status-available/10",
          open && (dark ? "bg-emerald-500/15" : "bg-status-available/15")
        )}
        aria-pressed={open}
      >
        <ScanLine className="size-3.5" /> <span className="hidden sm:inline">AI camera</span>
      </button>
      {open && <LiveCameraPanel onClose={() => toggle(false)} />}
    </>
  );
}

function LiveCameraPanel({ onClose }: { onClose: () => void }) {
  const { city } = useCity();
  const { state, actions } = useSlotify();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [mini, setMini] = useState(false);
  const [source, setSource] = useState<"none" | "camera" | "file">("none");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");
  const [model, setModel] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);
  const [dets, setDets] = useState<Detection[]>([]);
  const [fps, setFps] = useState(0);
  const [ms, setMs] = useState(0);
  const [bays, setBays] = useState<Bay[]>(() => defaultBays(3));
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Bay | null>(null);
  const [lotId, setLotId] = useState(city.lots[0].id);
  const [bayState, setBayState] = useState<{ occupied: boolean; cover: number; conf: number; cars?: number }[]>([]);
  const [tiled, setTiled] = useState(true);
  const history = useRef<boolean[][]>([]);
  const committed = useRef<(boolean | null)[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const running = useRef(false);

  const lotSlots = (state.slots[lotId] ?? []).filter((s) => s.status !== "maintenance").slice(0, bays.length).map((s) => s.id);
  const lot = city.lots.find((l) => l.id === lotId);

  // model
  useEffect(() => {
    setModel("loading");
    loadDetector()
      .then(() => setModel("ready"))
      .catch((e) => {
        setModel("error");
        setErr(String(e?.message ?? e));
      });
  }, []);

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const startCamera = useCallback(async (id?: string) => {
    setErr(null);
    try {
      stopStream();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: id ? { deviceId: { exact: id }, width: { ideal: 1280 }, height: { ideal: 720 } } : { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      const v = videoRef.current!;
      v.srcObject = stream;
      v.src = "";
      await v.play();
      setSource("camera");
      const list = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
      setDevices(list);
      if (!id) setDeviceId(stream.getVideoTracks()[0]?.getSettings().deviceId ?? "");
    } catch (e) {
      setErr("Camera blocked or unavailable. Allow camera access, or load a video file.");
      console.warn(e);
    }
  }, []);

  const loadFile = (f: File) => {
    stopStream();
    const v = videoRef.current!;
    v.srcObject = null;
    v.src = URL.createObjectURL(f);
    v.loop = true;
    void v.play();
    setSource("file");
    setErr(null);
  };

  // release camera-held bays on unmount / lot change
  const release = useCallback(
    (id: string, slots: string[]) => {
      slots.forEach((s) => actions.cameraBay(id, s, null));
    },
    [actions]
  );
  useEffect(() => {
    const id = lotId;
    const slots = lotSlots;
    return () => release(id, slots);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lotId, bays.length]);
  useEffect(() => () => stopStream(), []);

  // inference loop
  useEffect(() => {
    if (source === "none" || model !== "ready") return;
    running.current = true;
    let last = performance.now();
    let frames = 0;
    let fpsT = last;
    const loop = async () => {
      if (!running.current) return;
      const v = videoRef.current;
      if (v && v.readyState >= 2 && !v.paused) {
        const t0 = performance.now();
        try {
          const d = tiled ? await detectTiled(v) : await detect(v);
          setDets(d);
          setMs(Math.round(performance.now() - t0));
          frames++;
          const now = performance.now();
          if (now - fpsT > 1000) {
            setFps(Math.round((frames * 1000) / (now - fpsT)));
            frames = 0;
            fpsT = now;
          }
          // bay occupancy
          const W = v.videoWidth, H = v.videoHeight;
          const st = bays.map((b) => {
            const px = { x: b.x * W, y: b.y * H, w: b.w * W, h: b.h * H };
            // share of the bay covered by ALL vehicle boxes (a big zone holds many small cars)
            let cover = 0, conf = 0, cars = 0;
            for (const det of d) {
              const c = coverage(px, det);
              if (c > 0) {
                cover += c;
                conf = Math.max(conf, det.score);
                const cx = det.x + det.w / 2, cy = det.y + det.h / 2;
                if (cx >= px.x && cx <= px.x + px.w && cy >= px.y && cy <= px.y + px.h) cars++;
              }
            }
            cover = Math.min(1, cover);
            return { occupied: cover >= OCCUPIED_AT, cover, conf, cars };
          });
          setBayState(st);
          st.forEach((b, i) => {
            const h = (history.current[i] ??= []);
            h.push(b.occupied);
            if (h.length > STABLE_FRAMES) h.shift();
            const stable = h.length === STABLE_FRAMES && h.every((x) => x === h[0]);
            if (stable && committed.current[i] !== h[0] && lotSlots[i]) {
              committed.current[i] = h[0];
              actions.cameraBay(lotId, lotSlots[i], h[0], b.occupied ? b.conf : 0.95);
            }
          });
        } catch (e) {
          console.warn(e);
        }
        last = performance.now();
      }
      const wait = Math.max(30, 220 - (performance.now() - last));
      window.setTimeout(loop, wait);
    };
    void loop();
    return () => {
      running.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, model, bays, lotId, lotSlots.join(","), tiled]);

  // reset smoothing when layout changes
  useEffect(() => {
    history.current = [];
    committed.current = [];
  }, [bays, lotId]);

  // drawing
  useEffect(() => {
    const c = canvasRef.current, v = videoRef.current, box = boxRef.current;
    if (!c || !v || !box) return;
    const bw = box.clientWidth, bh = box.clientHeight;
    c.width = bw * devicePixelRatio;
    c.height = bh * devicePixelRatio;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.clearRect(0, 0, bw, bh);
    const W = v.videoWidth || 16, H = v.videoHeight || 9;
    const s = Math.min(bw / W, bh / H);
    const ox = (bw - W * s) / 2, oy = (bh - H * s) / 2;
    // bays
    bays.forEach((b, i) => {
      const occ = bayState[i]?.occupied;
      const col = source === "none" ? "rgba(148,163,184,.6)" : occ ? "#ef4444" : "#22c55e";
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(ox + b.x * W * s, oy + b.y * H * s, b.w * W * s, b.h * H * s);
      ctx.setLineDash([]);
      ctx.fillStyle = occ ? "rgba(239,68,68,.16)" : "rgba(34,197,94,.12)";
      ctx.fillRect(ox + b.x * W * s, oy + b.y * H * s, b.w * W * s, b.h * H * s);
      const nCars = bayState[i]?.cars ?? 0;
      const label = `${lotSlots[i] ?? `B${i + 1}`} ${source === "none" ? "" : occ ? `OCCUPIED${nCars > 1 ? ` · ${nCars} cars` : ""}` : "EMPTY"}`;
      ctx.font = "bold 10px ui-monospace, monospace";
      const tw = ctx.measureText(label).width + 8;
      ctx.fillStyle = col;
      ctx.fillRect(ox + b.x * W * s, oy + b.y * H * s, tw, 15);
      ctx.fillStyle = "#0b1220";
      ctx.fillText(label, ox + b.x * W * s + 4, oy + b.y * H * s + 11);
    });
    if (draft) {
      ctx.strokeStyle = "#38bdf8";
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(ox + draft.x * W * s, oy + draft.y * H * s, draft.w * W * s, draft.h * H * s);
      ctx.setLineDash([]);
    }
    // detections
    dets.forEach((d) => {
      ctx.strokeStyle = "#38bdf8";
      ctx.lineWidth = 2;
      ctx.strokeRect(ox + d.x * s, oy + d.y * s, d.w * s, d.h * s);
      const t = `${d.label} ${Math.round(d.score * 100)}%`;
      ctx.font = "bold 11px ui-sans-serif, system-ui";
      const tw = ctx.measureText(t).width + 8;
      ctx.fillStyle = "#38bdf8";
      ctx.fillRect(ox + d.x * s, oy + d.y * s - 16, tw, 16);
      ctx.fillStyle = "#0b1220";
      ctx.fillText(t, ox + d.x * s + 4, oy + d.y * s - 4);
    });
  }, [dets, bays, bayState, draft, source, lotSlots, mini]);

  // bay editor
  const toNorm = (e: React.PointerEvent) => {
    const v = videoRef.current!, box = boxRef.current!;
    const r = box.getBoundingClientRect();
    const W = v.videoWidth || 16, H = v.videoHeight || 9;
    const s = Math.min(r.width / W, r.height / H);
    const ox = (r.width - W * s) / 2, oy = (r.height - H * s) / 2;
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left - ox) / (W * s))), y: Math.min(1, Math.max(0, (e.clientY - r.top - oy) / (H * s))) };
  };
  const start = useRef<{ x: number; y: number } | null>(null);

  const occupiedCount = bayState.filter((b) => b.occupied).length;

  return (
    <div
      className={cn(
        "fixed right-3 top-[64px] z-[1150] overflow-hidden rounded-xl border border-slate-700/80 bg-[#0b1220]/95 text-slate-200 shadow-[0_20px_60px_-15px_rgba(0,0,0,.8)] backdrop-blur",
        mini ? "w-64" : "w-[min(400px,calc(100vw-24px))]"
      )}
      role="region"
      aria-label="Live AI camera"
    >
      <div className="flex items-center gap-2 border-b border-slate-700/70 px-3 py-2">
        <span className="relative flex size-2">
          {source !== "none" && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-70" />}
          <span className={cn("relative inline-flex size-2 rounded-full", source !== "none" ? "bg-red-500" : "bg-slate-500")} />
        </span>
        <p className="text-[11px] font-bold uppercase tracking-[0.12em]">{source !== "none" ? "Live" : "Camera"} · AI bay detection</p>
        <span className="ml-auto text-[10px] text-slate-400">{model === "ready" ? `YOLO11n · ${fps} fps` : model === "loading" ? "loading model…" : model === "error" ? "model error" : ""}</span>
        <button onClick={() => setMini((v) => !v)} className="rounded p-0.5 text-slate-400 hover:bg-white/10" aria-label={mini ? "Expand" : "Minimise"}>
          <Minus className="size-3.5" />
        </button>
        <button onClick={onClose} className="rounded p-0.5 text-slate-400 hover:bg-white/10" aria-label="Close camera">
          <X className="size-3.5" />
        </button>
      </div>

      <div className={cn(mini && "hidden")}>
        <div
          ref={boxRef}
          className={cn("relative aspect-video w-full bg-black", editing && "cursor-crosshair")}
          onPointerDown={(e) => {
            if (!editing) return;
            start.current = toNorm(e);
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!editing || !start.current) return;
            const p = toNorm(e);
            setDraft({ x: Math.min(p.x, start.current.x), y: Math.min(p.y, start.current.y), w: Math.abs(p.x - start.current.x), h: Math.abs(p.y - start.current.y) });
          }}
          onPointerUp={() => {
            if (!editing || !start.current) return;
            if (draft && draft.w > 0.03 && draft.h > 0.03) setBays((b) => [...b, draft].slice(-6));
            setDraft(null);
            start.current = null;
          }}
        >
          <video ref={videoRef} className="absolute inset-0 h-full w-full object-contain" muted playsInline />
          <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
          {source === "none" && (
            <div className="absolute inset-0 grid place-items-center p-4 text-center">
              <div>
                <p className="text-xs text-slate-300">Point a camera at cars or toy cars in bays.<br />YOLO runs on this device; no video is uploaded.</p>
                <div className="mt-3 flex justify-center gap-2">
                  <button onClick={() => startCamera()} className="inline-flex items-center gap-1.5 rounded-md bg-sky-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-400">
                    <Camera className="size-3.5" /> Use camera
                  </button>
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-600 px-3 py-1.5 text-xs font-semibold hover:bg-white/5">
                    <Film className="size-3.5" /> Load video
                    <input type="file" accept="video/*" className="hidden" onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])} />
                  </label>
                </div>
              </div>
            </div>
          )}
          {editing && (
            <div className="pointer-events-none absolute inset-x-0 top-0 bg-sky-500/90 px-2 py-1 text-center text-[10px] font-semibold text-slate-950">
              Drag on the video to draw each bay · {bays.length} drawn
            </div>
          )}
        </div>

        <div className="space-y-2 p-3 text-xs">
          {err && <p className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-amber-300">{err}</p>}
          <div className="flex flex-wrap gap-1.5">
            {bays.map((_, i) => {
              const b = bayState[i];
              const occ = b?.occupied;
              return (
                <span key={i} className={cn("rounded px-2 py-1 font-mono text-[11px] font-semibold", source === "none" ? "bg-slate-800 text-slate-400" : occ ? "bg-red-500/15 text-red-400" : "bg-emerald-500/15 text-emerald-400")}>
                  {lotSlots[i] ?? `B${i + 1}`} · {source === "none" ? "—" : occ ? `Occupied${(b?.cars ?? 0) > 1 ? ` · ${b?.cars} cars` : ` ${Math.round((b?.conf ?? 0) * 100)}%`}` : "Empty"}
                </span>
              );
            })}
          </div>
          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            <span>
              Synced to <b className="text-slate-200">{lot?.name}</b>
            </span>
            {source !== "none" && <span className="ml-auto font-mono">{dets.length} veh · {ms} ms</span>}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <select value={lotId} onChange={(e) => setLotId(e.target.value)} className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[11px]" aria-label="Parking lot to sync">
              {city.lots.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
            {source === "camera" && devices.length > 1 && (
              <select
                value={deviceId}
                onChange={(e) => {
                  setDeviceId(e.target.value);
                  void startCamera(e.target.value);
                }}
                className="max-w-[120px] rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[11px]"
                aria-label="Camera"
              >
                {devices.map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>
                ))}
              </select>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => {
                if (!editing) setBays([]);
                setEditing((v) => !v);
              }}
              className={cn("inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] font-semibold", editing ? "border-sky-400 bg-sky-500/15 text-sky-300" : "border-slate-700 hover:bg-white/5")}
            >
              <PencilRuler className="size-3" /> {editing ? "Done drawing" : "Draw bays"}
            </button>
            <button onClick={() => { setEditing(false); setBays(defaultBays(3)); }} className="inline-flex items-center gap-1 rounded border border-slate-700 px-2 py-1 text-[11px] font-semibold hover:bg-white/5">
              <RotateCcw className="size-3" /> Default 3 bays
            </button>
            <button onClick={() => setTiled((t) => !t)} title="Runs YOLO on 6 zoomed tiles + full frame, so small / far-away cars are found" className={cn("inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] font-semibold", tiled ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300" : "border-slate-700 hover:bg-white/5")}>
              {tiled ? "High accuracy · tiled" : "Fast · single pass"}
            </button>
            {source !== "none" && (
              <button
                onClick={() => {
                  stopStream();
                  const v = videoRef.current!;
                  v.pause();
                  v.srcObject = null;
                  v.removeAttribute("src");
                  setSource("none");
                  setDets([]);
                  setBayState([]);
                  release(lotId, lotSlots);
                }}
                className="ml-auto rounded border border-slate-700 px-2 py-1 text-[11px] font-semibold hover:bg-white/5"
              >
                Stop
              </button>
            )}
          </div>
          {source !== "none" && (
            <p className="text-[10px] text-slate-500">
              {occupiedCount}/{bays.length} bays occupied · a bay counts as occupied when ≥{Math.round(OCCUPIED_AT * 100)}% of it is covered by a vehicle for {STABLE_FRAMES} frames
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
