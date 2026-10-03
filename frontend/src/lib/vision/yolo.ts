/**
 * On-device vehicle detection: Ultralytics YOLO11n (COCO, exported to ONNX) running in the browser
 * with ONNX Runtime Web (WebAssembly). No server, no upload — frames never leave the device.
 * Runtime + model are served from /ort and /models so the demo also works offline.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    ort?: any;
  }
}

export interface Detection {
  x: number; // source-pixel box (top-left)
  y: number;
  w: number;
  h: number;
  score: number;
  cls: number;
  label: string;
}

/** COCO classes we treat as vehicles */
export const VEHICLE_CLASSES: Record<number, string> = { 2: "car", 3: "motorcycle", 5: "bus", 7: "truck" };

const INPUT = 640;
let sessionPromise: Promise<any> | null = null;

const ORT_CDN = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/";

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    if (window.ort) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      s.remove();
      reject(new Error(`Failed to load ${src}`));
    };
    document.head.appendChild(s);
  });
}

let ortPromise: Promise<any> | null = null;
/** ONNX Runtime Web: CDN first (keeps the site small), local /ort/ copy as fallback. */
export function ensureOrt() {
  ortPromise ??= (async () => {
    let base = ORT_CDN;
    try {
      await loadScript(`${ORT_CDN}ort.wasm.min.js`);
    } catch {
      base = "/ort/";
      await loadScript("/ort/ort.wasm.min.js");
    }
    const ort = window.ort;
    ort.env.wasm.wasmPaths = base;
    ort.env.wasm.numThreads = (globalThis as any).crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
    return ort;
  })().catch((e) => {
    ortPromise = null;
    throw e;
  });
  return ortPromise;
}

export function loadDetector() {
  sessionPromise ??= (async () => {
    const ort = await ensureOrt();
    return ort.InferenceSession.create("/models/yolo11n.onnx", { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
  })().catch((e) => {
    sessionPromise = null;
    throw e;
  });
  return sessionPromise;
}

let work: HTMLCanvasElement | null = null;

/** Letterbox the frame into 640×640, run YOLO, decode + NMS. Returns boxes in source pixels. */
export async function detect(source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement, minScore = 0.35): Promise<Detection[]> {
  const session = await loadDetector();
  const ort = window.ort;
  const sw = (source as HTMLVideoElement).videoWidth || (source as HTMLImageElement).naturalWidth || (source as HTMLCanvasElement).width;
  const sh = (source as HTMLVideoElement).videoHeight || (source as HTMLImageElement).naturalHeight || (source as HTMLCanvasElement).height;
  if (!sw || !sh) return [];
  const scale = Math.min(INPUT / sw, INPUT / sh);
  const nw = Math.round(sw * scale);
  const nh = Math.round(sh * scale);
  const px = Math.floor((INPUT - nw) / 2);
  const py = Math.floor((INPUT - nh) / 2);

  work ??= document.createElement("canvas");
  work.width = INPUT;
  work.height = INPUT;
  const ctx = work.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "rgb(114,114,114)";
  ctx.fillRect(0, 0, INPUT, INPUT);
  ctx.drawImage(source, px, py, nw, nh);
  const { data } = ctx.getImageData(0, 0, INPUT, INPUT);
  const area = INPUT * INPUT;
  const input = new Float32Array(3 * area);
  for (let i = 0; i < area; i++) {
    input[i] = data[i * 4] / 255;
    input[i + area] = data[i * 4 + 1] / 255;
    input[i + 2 * area] = data[i * 4 + 2] / 255;
  }
  const feeds: Record<string, any> = {};
  feeds[session.inputNames[0]] = new ort.Tensor("float32", input, [1, 3, INPUT, INPUT]);
  const out = await session.run(feeds);
  const t = out[session.outputNames[0]];
  const [, ch, n] = t.dims as number[]; // [1, 84, 8400]
  const o = t.data as Float32Array;

  const cands: Detection[] = [];
  for (let a = 0; a < n; a++) {
    let best = -1;
    let bestScore = 0;
    for (const c of [2, 3, 5, 7]) {
      const sc = o[(4 + c) * n + a];
      if (sc > bestScore) {
        bestScore = sc;
        best = c;
      }
    }
    if (bestScore < minScore || ch < 84) continue;
    const cx = o[a], cy = o[n + a], w = o[2 * n + a], h = o[3 * n + a];
    cands.push({
      x: (cx - w / 2 - px) / scale,
      y: (cy - h / 2 - py) / scale,
      w: w / scale,
      h: h / scale,
      score: bestScore,
      cls: best,
      label: VEHICLE_CLASSES[best],
    });
  }
  return nms(cands, 0.45);
}

function iou(a: Detection, b: Detection) {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / (a.w * a.h + b.w * b.h - inter || 1);
}

function nms(list: Detection[], thr: number) {
  const sorted = [...list].sort((a, b) => b.score - a.score);
  const keep: Detection[] = [];
  for (const d of sorted) if (keep.every((k) => iou(k, d) < thr)) keep.push(d);
  return keep.slice(0, 30);
}

/** Share of a bay rectangle covered by a detection box. */
export function coverage(bay: { x: number; y: number; w: number; h: number }, d: Detection) {
  const x1 = Math.max(bay.x, d.x), y1 = Math.max(bay.y, d.y);
  const x2 = Math.min(bay.x + bay.w, d.x + d.w), y2 = Math.min(bay.y + bay.h, d.y + d.h);
  return (Math.max(0, x2 - x1) * Math.max(0, y2 - y1)) / (bay.w * bay.h || 1);
}

let tileCanvas: HTMLCanvasElement | null = null;

/**
 * Tiled inference (SAHI-style) for wide / aerial CCTV: cars are tiny in a 640-px resize, so we also run YOLO on
 * overlapping crops at native resolution and merge everything with NMS. ~cols×rows+1 inferences per frame.
 */
export async function detectTiled(source: HTMLVideoElement | HTMLCanvasElement, cols = 3, rows = 2, minScore = 0.25): Promise<Detection[]> {
  const sw = (source as HTMLVideoElement).videoWidth || (source as HTMLCanvasElement).width;
  const sh = (source as HTMLVideoElement).videoHeight || (source as HTMLCanvasElement).height;
  if (!sw || !sh) return [];
  const all: Detection[] = [...(await detect(source, minScore))];
  const ov = 0.2;
  const tw = sw / (cols - (cols - 1) * ov), th = sh / (rows - (rows - 1) * ov);
  tileCanvas ??= document.createElement("canvas");
  tileCanvas.width = Math.round(tw);
  tileCanvas.height = Math.round(th);
  const ctx = tileCanvas.getContext("2d")!;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = Math.round(c * tw * (1 - ov)), y0 = Math.round(r * th * (1 - ov));
      ctx.drawImage(source, x0, y0, tw, th, 0, 0, tw, th);
      const d = await detect(tileCanvas, minScore);
      for (const b of d) all.push({ ...b, x: b.x + x0, y: b.y + y0 });
    }
  }
  return nmsAll(all, 0.4);
}

function nmsAll(list: Detection[], thr: number) {
  const sorted = [...list].sort((a, b) => b.score - a.score);
  const keep: Detection[] = [];
  for (const d of sorted) {
    // also drop boxes mostly contained in a kept box (tile-edge duplicates)
    if (keep.every((k) => iou(k, d) < thr && containment(k, d) < 0.7)) keep.push(d);
  }
  return keep.slice(0, 200);
}

function containment(a: Detection, b: Detection) {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / Math.min(a.w * a.h, b.w * b.h || 1);
}
