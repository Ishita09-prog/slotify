/**
 * Automatic Number Plate Recognition (ANPR), fully in the browser.
 *  1. Plate detector: YOLOv9-t (open-image-models, MIT) — finds plate boxes, NMS built in ("end2end").
 *  2. Plate reader: CCT-XS OCR (fast-plate-ocr, MIT) — 10 character slots, Latin alphabet.
 *  3. Indian-format correction: TN 09 AB 1234 → fixes O/0, I/1, B/8, S/5, Z/2 by position.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { ensureOrt } from "./yolo";

const DET = 640;
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_";

let det: Promise<any> | null = null;
let ocr: Promise<any> | null = null;

export function loadAnpr() {
  det ??= ensureOrt().then((ort) => ort.InferenceSession.create("/models/plate-det.onnx", { executionProviders: ["wasm"], graphOptimizationLevel: "all" }));
  ocr ??= ensureOrt().then((ort) => ort.InferenceSession.create("/models/plate-ocr.onnx", { executionProviders: ["wasm"], graphOptimizationLevel: "all" }));
  return Promise.all([det, ocr]).catch((e) => {
    det = ocr = null;
    throw e;
  });
}

export interface PlateRead {
  box: { x: number; y: number; w: number; h: number };
  detScore: number;
  raw: string;
  text: string; // Indian-normalised
  conf: number; // mean char probability
  valid: boolean; // matches Indian format
}

type Src = HTMLVideoElement | HTMLImageElement | HTMLCanvasElement;
const dims = (s: Src) => ({
  w: (s as HTMLVideoElement).videoWidth || (s as HTMLImageElement).naturalWidth || (s as HTMLCanvasElement).width,
  h: (s as HTMLVideoElement).videoHeight || (s as HTMLImageElement).naturalHeight || (s as HTMLCanvasElement).height,
});

let c1: HTMLCanvasElement | null = null;
let c2: HTMLCanvasElement | null = null;

export async function readPlates(source: Src, minScore = 0.35): Promise<PlateRead[]> {
  const [detS, ocrS] = await loadAnpr();
  const ort = window.ort;
  const { w: sw, h: sh } = dims(source);
  if (!sw || !sh) return [];

  // --- detect (letterbox 640, RGB, /255, NCHW)
  const r = Math.min(DET / sw, DET / sh);
  const nw = Math.round(sw * r), nh = Math.round(sh * r);
  const dw = (DET - nw) / 2, dh = (DET - nh) / 2;
  c1 ??= document.createElement("canvas");
  c1.width = DET;
  c1.height = DET;
  const x1 = c1.getContext("2d", { willReadFrequently: true })!;
  x1.fillStyle = "rgb(114,114,114)";
  x1.fillRect(0, 0, DET, DET);
  x1.drawImage(source, Math.round(dw - 0.1), Math.round(dh - 0.1), nw, nh);
  const px = x1.getImageData(0, 0, DET, DET).data;
  const area = DET * DET;
  const input = new Float32Array(3 * area);
  for (let i = 0; i < area; i++) {
    input[i] = px[i * 4] / 255;
    input[i + area] = px[i * 4 + 1] / 255;
    input[i + 2 * area] = px[i * 4 + 2] / 255;
  }
  const out = await detS.run({ [detS.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, DET, DET]) });
  const t = out[detS.outputNames[0]];
  const rows = t.dims[0] as number;
  const d = t.data as Float32Array; // [batch, x1, y1, x2, y2, cls, score]
  const boxes: { x: number; y: number; w: number; h: number; s: number }[] = [];
  for (let i = 0; i < rows; i++) {
    const s = d[i * 7 + 6];
    if (s < minScore) continue;
    const bx1 = (d[i * 7 + 1] - dw) / r, by1 = (d[i * 7 + 2] - dh) / r, bx2 = (d[i * 7 + 3] - dw) / r, by2 = (d[i * 7 + 4] - dh) / r;
    boxes.push({ x: Math.max(0, bx1), y: Math.max(0, by1), w: Math.min(sw, bx2) - Math.max(0, bx1), h: Math.min(sh, by2) - Math.max(0, by1), s });
  }

  // --- read each plate (crop → 128×64 RGB uint8, NHWC)
  c2 ??= document.createElement("canvas");
  c2.width = 128;
  c2.height = 64;
  const x2 = c2.getContext("2d", { willReadFrequently: true })!;
  const reads: PlateRead[] = [];
  for (const b of boxes.sort((a, z) => z.s - a.s).slice(0, 4)) {
    if (b.w < 8 || b.h < 4) continue;
    x2.drawImage(source, b.x, b.y, b.w, b.h, 0, 0, 128, 64);
    const p = x2.getImageData(0, 0, 128, 64).data;
    const u8 = new Uint8Array(128 * 64 * 3);
    for (let i = 0; i < 128 * 64; i++) {
      u8[i * 3] = p[i * 4];
      u8[i * 3 + 1] = p[i * 4 + 1];
      u8[i * 3 + 2] = p[i * 4 + 2];
    }
    const o = await ocrS.run({ [ocrS.inputNames[0]]: new ort.Tensor("uint8", u8, [1, 64, 128, 3]) });
    const plate = o.plate ?? o[ocrS.outputNames[0]];
    const probs = plate.data as Float32Array; // [1, 10, 37]
    let raw = "", sum = 0, n = 0;
    for (let k = 0; k < 10; k++) {
      let bi = 0, bp = -1;
      for (let c = 0; c < 37; c++) {
        const v = probs[k * 37 + c];
        if (v > bp) {
          bp = v;
          bi = c;
        }
      }
      const ch = ALPHABET[bi];
      if (ch !== "_") {
        raw += ch;
        sum += bp;
        n++;
      }
    }
    const fixed = indianPlate(raw);
    reads.push({ box: b, detScore: b.s, raw, text: fixed.text, conf: n ? sum / n : 0, valid: fixed.valid });
  }
  return reads;
}

const TO_LETTER: Record<string, string> = { "0": "O", "1": "I", "2": "Z", "5": "S", "8": "B", "6": "G", "4": "A", "7": "T" };
const TO_DIGIT: Record<string, string> = { O: "0", D: "0", Q: "0", I: "1", L: "1", Z: "2", S: "5", B: "8", G: "6", A: "4", T: "7" };
const STATES = new Set("AN AP AR AS BR CG CH DD DL DN GA GJ HP HR JH JK KA KL LA LD MH ML MN MP MZ NL OD OR PB PY RJ SK TN TR TS UK UP WB BH".split(" "));

/** Normalise to the Indian format SS DD L{0,3} NNNN (e.g. TN09AB1234, also BH series 22BH1234AA). */
export function indianPlate(raw: string) {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (s.length < 6) return { text: s, valid: false };
  const ch = s.split("");
  // last 4 → digits; first 2 → letters; next 1-2 → digits
  for (let i = Math.max(0, ch.length - 4); i < ch.length; i++) ch[i] = TO_DIGIT[ch[i]] ?? ch[i];
  for (let i = 0; i < 2; i++) ch[i] = TO_LETTER[ch[i]] ?? ch[i];
  for (let i = 2; i < Math.min(4, ch.length - 4); i++) if (i === 2 || /[0-9OIZSBGDQL]/.test(ch[i])) ch[i] = TO_DIGIT[ch[i]] ?? ch[i];
  // middle series → letters
  const midStart = /\d/.test(ch[3] ?? "") ? 4 : 3;
  for (let i = midStart; i < ch.length - 4; i++) ch[i] = TO_LETTER[ch[i]] ?? ch[i];
  const text = ch.join("");
  const valid = /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}$/.test(text) && STATES.has(text.slice(0, 2));
  return { text, valid };
}
