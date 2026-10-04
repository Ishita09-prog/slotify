"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { ArrowLeft, ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from "lucide-react";

/* ====================================================================== */
/* Slotify "How it works": a clickable 3D story built with three.js.      */
/* Low-poly scene made in code (no external assets), scripted per scene.  */
/* ====================================================================== */

type V3 = [number, number, number];
type Pt = [number, number]; // x, z

interface World {
  car: THREE.Group;
  bike: THREE.Group;
  setPlate: (g: THREE.Group, text: string) => void;
  entryArm: THREE.Group;
  exitArm: THREE.Group;
  beamIn: THREE.Mesh;
  beamOut: THREE.Mesh;
  ringIn: THREE.Mesh;
  ringOut: THREE.Mesh;
  bayA1: THREE.MeshStandardMaterial;
  bayB1: THREE.MeshStandardMaterial;
  nodes: Record<NodeId, THREE.Group>;
  packet: (from: NodeId, to: NodeId, color: number, label?: string) => (p: number) => void;
  edge: THREE.Group;
  alarm: THREE.Mesh;
}

type NodeId = "booth" | "slotify" | "acquirer" | "netc" | "issuer" | "operator" | "upi" | "phone";

interface Act {
  at: number;
  dur: number;
  run: (p: number) => void;
}

interface Step {
  title: string;
  text: string;
  dur: number;
  cam: [V3, V3];
  acts?: (w: World) => Act[];
  overlay?: ReactNode;
}

interface Scene {
  id: string;
  label: string;
  emoji: string;
  setup: (w: World) => void;
  steps: Step[];
}

/* ------------------------------ helpers ------------------------------ */

const ease = (p: number) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);
const clamp = (p: number) => Math.max(0, Math.min(1, p));

function follow(g: THREE.Object3D, path: Pt[], p: number) {
  const seg: number[] = [];
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const d = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
    seg.push(d);
    total += d;
  }
  let dist = p * total;
  for (let i = 0; i < seg.length; i++) {
    if (dist <= seg[i] || i === seg.length - 1) {
      const k = seg[i] ? Math.min(1, dist / seg[i]) : 1;
      const [ax, az] = path[i], [bx, bz] = path[i + 1];
      g.position.x = ax + (bx - ax) * k;
      g.position.z = az + (bz - az) * k;
      const target = Math.atan2(bx - ax, bz - az);
      let d = target - g.rotation.y;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      g.rotation.y += d * 0.25;
      return;
    }
    dist -= seg[i];
  }
}
const drive = (g: THREE.Object3D, path: Pt[], at: number, dur: number): Act => ({ at, dur, run: (p) => follow(g, path, p) });
const place = (g: THREE.Object3D, x: number, z: number, ry: number) => {
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  g.visible = true;
};
const arm = (a: THREE.Group, up: boolean, sign: number, at: number, dur = 0.9): Act => ({ at, dur, run: (p) => (a.rotation.z = sign * 1.35 * (up ? p : 1 - p)) });
const pulse = (m: THREE.Mesh, at: number, dur = 1.6): Act => ({
  at,
  dur,
  run: (p) => {
    m.visible = p < 1;
    const k = (p * 3) % 1;
    m.scale.setScalar(0.6 + k * 1.6);
    (m.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k);
  },
});
const beam = (m: THREE.Mesh, at: number, dur = 1.4): Act => ({
  at,
  dur,
  run: (p) => {
    m.visible = p < 1;
    (m.material as THREE.MeshBasicMaterial).opacity = 0.35 * Math.sin(p * Math.PI);
  },
});
const color = (mat: THREE.MeshStandardMaterial, hex: number, at: number): Act => ({ at, dur: 0.01, run: () => mat.color.setHex(hex) });
const flash = (m: THREE.Mesh, at: number, dur: number): Act => ({
  at,
  dur,
  run: (p) => {
    m.visible = p < 1;
    (m.material as THREE.MeshBasicMaterial).opacity = 0.5 + 0.5 * Math.sin(p * 40);
  },
});

/* ------------------------------ world ------------------------------ */

function label(text: string, cls = "s3d-label") {
  const d = document.createElement("div");
  d.className = cls;
  d.textContent = text;
  return new CSS2DObject(d);
}

function plateTexture(text: string) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const x = c.getContext("2d")!;
  x.fillStyle = "#fafafa";
  x.fillRect(0, 0, 256, 64);
  x.strokeStyle = "#111";
  x.lineWidth = 6;
  x.strokeRect(3, 3, 250, 58);
  x.fillStyle = "#1d4ed8";
  x.fillRect(8, 8, 18, 48);
  x.fillStyle = "#111";
  x.font = "bold 38px Arial, sans-serif";
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.fillText(text, 140, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeCar(hex: number, plate?: string) {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: hex, metalness: 0.4, roughness: 0.35 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.8, roughness: 0.15 });
  const b = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.7, 4.2), body);
  b.position.y = 0.65;
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6, 2.2), glass);
  cab.position.set(0, 1.25, -0.2);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.08, 1.9), body);
  roof.position.set(0, 1.58, -0.25);
  g.add(b, cab, roof);
  g.userData.body = body;
  const wheel = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 16);
  const wm = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 });
  for (const [x, z] of [[-0.95, 1.3], [0.95, 1.3], [-0.95, -1.3], [0.95, -1.3]]) {
    const w = new THREE.Mesh(wheel, wm);
    w.rotation.z = Math.PI / 2;
    w.position.set(x, 0.38, z);
    g.add(w);
  }
  const lights = new THREE.MeshBasicMaterial({ color: 0xfef9c3 });
  for (const x of [-0.65, 0.65]) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.15, 0.05), lights);
    l.position.set(x, 0.8, 2.11);
    g.add(l);
  }
  if (plate) {
    const pm = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.28), new THREE.MeshBasicMaterial({ map: plateTexture(plate) }));
    pm.position.set(0, 0.55, 2.12);
    pm.name = "plate";
    g.add(pm);
    const back = pm.clone();
    back.position.set(0, 0.55, -2.12);
    back.rotation.y = Math.PI;
    back.name = "plate";
    g.add(back);
  }
  g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  return g;
}

function makeBike(plate: string) {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: 0x0ea5e9, metalness: 0.4, roughness: 0.4 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x111111 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 1.5), m);
  body.position.y = 0.75;
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.7), dark);
  seat.position.set(0, 1.05, -0.2);
  const rider = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 0.6, 4, 8), new THREE.MeshStandardMaterial({ color: 0xf59e0b }));
  rider.position.set(0, 1.55, -0.15);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), new THREE.MeshStandardMaterial({ color: 0xffffff }));
  helmet.position.set(0, 2.1, -0.1);
  g.add(body, seat, rider, helmet);
  const wg = new THREE.TorusGeometry(0.33, 0.1, 8, 20);
  for (const z of [0.75, -0.75]) {
    const w = new THREE.Mesh(wg, dark);
    w.rotation.y = Math.PI / 2;
    w.position.set(0, 0.42, z);
    g.add(w);
  }
  const pm = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.16), new THREE.MeshBasicMaterial({ map: plateTexture(plate) }));
  pm.position.set(0, 0.7, -0.78);
  pm.rotation.y = Math.PI;
  pm.name = "plate";
  const front = pm.clone();
  front.position.set(0, 0.7, 0.78);
  front.rotation.y = 0;
  g.add(pm, front);
  g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  return g;
}

const NODE_POS: Record<NodeId, V3> = {
  phone: [-22, 7, -8],
  booth: [0, 3.4, -4],
  slotify: [11, 7, -6],
  acquirer: [18, 8, -10],
  netc: [25, 9.5, -1],
  issuer: [19, 8, 9],
  operator: [11, 7, 16],
  upi: [-22, 7, 4],
};
const NODE_LABEL: Record<NodeId, string> = {
  phone: "📱 Driver's phone",
  booth: "Gate",
  slotify: "☁ Slotify",
  acquirer: "🏦 Acquirer bank",
  netc: "⇄ NPCI · NETC",
  issuer: "🏦 Issuer bank",
  operator: "🅿 Parking operator",
  upi: "UPI",
};
const NODE_COLOR: Record<NodeId, number> = { phone: 0x60a5fa, booth: 0x94a3b8, slotify: 0x3b82f6, acquirer: 0x10b981, netc: 0xa855f7, issuer: 0x10b981, operator: 0xf59e0b, upi: 0x22c55e };

function buildWorld(scene: THREE.Scene): World {
  const std = (c: number, r = 0.9) => new THREE.MeshStandardMaterial({ color: c, roughness: r });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), std(0x1f2937));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const flat = (w: number, d: number, x: number, z: number, c: number, y = 0.01) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), std(c));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    m.receiveShadow = true;
    scene.add(m);
    return m;
  };
  flat(11, 44, 0, -22, 0x111827); // approach road
  flat(28, 16, 0, 8, 0x273244); // lot
  for (let z = -40; z < -6; z += 4) flat(0.18, 2, 0, z, 0xfacc15, 0.02); // centre dashes
  flat(28, 0.15, 0, 0.1, 0xe5e7eb, 0.02);

  // bays
  const bayMats: THREE.MeshStandardMaterial[] = [];
  const names = ["A1", "A2", "A3", "A4", "A5", "A6", "B1"];
  for (let i = 0; i < 7; i++) {
    const x = -10.8 + i * 3.6;
    const m = std(i === 6 ? 0x14532d : 0x166534);
    m.transparent = true;
    m.opacity = 0.75;
    const bay = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 5.2), m);
    bay.rotation.x = -Math.PI / 2;
    bay.position.set(x, 0.03, 10.5);
    scene.add(bay);
    bayMats.push(m);
    const l = label(i === 6 ? "B1 · 🛵" : names[i], "s3d-bay");
    l.position.set(x, 0.1, 13.6);
    scene.add(l);
  }
  // already-parked cars for realism
  for (const [i, c] of [[2, 0x64748b], [3, 0xe5e7eb], [5, 0x7c2d12]] as const) {
    const car = makeCar(c);
    car.position.set(-10.8 + i * 3.6, 0, 10.5);
    car.rotation.y = Math.PI;
    scene.add(car);
    bayMats[i].color.setHex(0x991b1b);
  }

  // booth, gantry, cameras
  const booth = new THREE.Mesh(new THREE.BoxGeometry(1.8, 2.6, 2), std(0x334155, 0.6));
  booth.position.set(0, 1.3, -4);
  booth.castShadow = true;
  scene.add(booth);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.2, 2.4), std(0x3b82f6, 0.5));
  roof.position.set(0, 2.7, -4);
  scene.add(roof);
  const edge = new THREE.Group();
  const eb = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.4, 0.5), std(0x0f172a, 0.4));
  const led = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.02), new THREE.MeshBasicMaterial({ color: 0x22c55e }));
  led.position.set(0.2, 0.05, 0.26);
  edge.add(eb, led);
  edge.position.set(0, 3.0, -4);
  const el = label("Edge AI box", "s3d-tag");
  el.position.set(0, 0.6, 0);
  edge.add(el);
  scene.add(edge);

  for (const x of [-5.6, 5.6]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 5.2), std(0x94a3b8, 0.5));
    pole.position.set(x, 2.6, -6.5);
    scene.add(pole);
  }
  const beamBar = new THREE.Mesh(new THREE.BoxGeometry(11.6, 0.3, 0.3), std(0x94a3b8, 0.5));
  beamBar.position.set(0, 5.2, -6.5);
  scene.add(beamBar);
  const ringMat = () => new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.0, side: THREE.DoubleSide });
  const mkRing = (x: number) => {
    const ant = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.25, 0.5), std(0xe2e8f0, 0.4));
    ant.position.set(x, 4.9, -6.5);
    scene.add(ant);
    const r = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.05, 8, 32), ringMat());
    r.rotation.x = Math.PI / 2;
    r.position.set(x, 4.5, -6.5);
    r.visible = false;
    scene.add(r);
    return r;
  };
  const ringIn = mkRing(-2.6);
  const ringOut = mkRing(2.6);
  const rl = label("RFID reader", "s3d-tag");
  rl.position.set(0, 5.7, -6.5);
  scene.add(rl);

  const mkBeam = (x: number) => {
    const cam = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.6), std(0x0f172a, 0.3));
    cam.position.set(x * 0.25, 3.1, -5);
    scene.add(cam);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(1.4, 6, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
    const from = new THREE.Vector3(x * 0.25, 3.1, -5);
    const to = new THREE.Vector3(x, 0.6, -9.5);
    cone.position.copy(from.clone().lerp(to, 0.5));
    cone.lookAt(to);
    cone.rotateX(-Math.PI / 2);
    cone.visible = false;
    scene.add(cone);
    return cone;
  };
  const beamIn = mkBeam(-2.6);
  const beamOut = mkBeam(2.6);
  const cl = label("ANPR camera", "s3d-tag");
  cl.position.set(0, 3.7, -5.6);
  scene.add(cl);

  const mkArm = (x: number, dir: number) => {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.35, 1.1, 0.35), std(0xe5e7eb, 0.5));
    post.position.set(x, 0.55, -4.8);
    scene.add(post);
    const pivot = new THREE.Group();
    pivot.position.set(x, 1.05, -4.8);
    const a = new THREE.Group();
    for (let i = 0; i < 8; i++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.14, 0.14), new THREE.MeshStandardMaterial({ color: i % 2 ? 0xffffff : 0xef4444 }));
      s.position.x = dir * (0.3 + i * 0.55);
      a.add(s);
    }
    pivot.add(a);
    scene.add(pivot);
    return pivot;
  };
  const entryArm = mkArm(-1.2, -1);
  const exitArm = mkArm(1.2, 1);
  const inl = label("ENTRY", "s3d-tag");
  inl.position.set(-2.8, 0.2, -12);
  scene.add(inl);
  const outl = label("EXIT", "s3d-tag");
  outl.position.set(2.8, 0.2, -12);
  scene.add(outl);

  const alarm = new THREE.Mesh(new THREE.SphereGeometry(0.35, 16, 12), new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0 }));
  alarm.position.set(0, 3.6, -4);
  alarm.visible = false;
  scene.add(alarm);

  // ecosystem nodes
  const nodes = {} as Record<NodeId, THREE.Group>;
  (Object.keys(NODE_POS) as NodeId[]).forEach((id) => {
    const g = new THREE.Group();
    g.position.set(...NODE_POS[id]);
    if (id !== "booth") {
      const s = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 1), new THREE.MeshStandardMaterial({ color: NODE_COLOR[id], emissive: NODE_COLOR[id], emissiveIntensity: 0.5, roughness: 0.3 }));
      g.add(s);
      const l = label(NODE_LABEL[id], "s3d-node");
      l.position.set(0, 1.2, 0);
      g.add(l);
    }
    scene.add(g);
    nodes[id] = g;
  });
  const link = (a: NodeId, b: NodeId) => {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...NODE_POS[a]), new THREE.Vector3(...NODE_POS[b])]);
    scene.add(new THREE.Line(geo, new THREE.LineDashedMaterial({ color: 0x475569, dashSize: 0.4, gapSize: 0.3 })).computeLineDistances());
  };
  link("booth", "slotify");
  link("slotify", "acquirer");
  link("acquirer", "netc");
  link("netc", "issuer");
  link("issuer", "operator");
  link("phone", "slotify");
  link("upi", "slotify");

  const packet = (from: NodeId, to: NodeId, c: number, text?: string) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12), new THREE.MeshBasicMaterial({ color: c }));
    const glow = new THREE.PointLight(c, 6, 6);
    m.add(glow);
    if (text) {
      const l = label(text, "s3d-packet");
      l.position.set(0, 0.6, 0);
      m.add(l);
    }
    m.visible = false;
    scene.add(m);
    const a = new THREE.Vector3(...NODE_POS[from]), b = new THREE.Vector3(...NODE_POS[to]);
    const mid = a.clone().lerp(b, 0.5).add(new THREE.Vector3(0, 2, 0));
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    return (p: number) => {
      m.visible = p > 0 && p < 1;
      m.position.copy(curve.getPoint(Math.min(1, p)));
      if (p >= 1) {
        scene.remove(m);
        m.traverse((o) => {
          if (o instanceof CSS2DObject) o.element.remove();
        });
      }
    };
  };

  const car = makeCar(0x2563eb, "TN09AB2007");
  car.visible = false;
  scene.add(car);
  const bike = makeBike("TN10ZX4521");
  bike.visible = false;
  scene.add(bike);

  const setPlate = (g: THREE.Group, text: string) => {
    g.traverse((o) => {
      if (o.name === "plate") ((o as THREE.Mesh).material as THREE.MeshBasicMaterial).map = plateTexture(text);
    });
  };

  return { car, bike, setPlate, entryArm, exitArm, beamIn, beamOut, ringIn, ringOut, bayA1: bayMats[0], bayB1: bayMats[6], nodes, packet, edge, alarm };
}

/* ------------------------------ overlays ------------------------------ */

function Phone({ children }: { children: ReactNode }) {
  return (
    <div className="s3d-in absolute bottom-28 left-4 w-56 rounded-[28px] border-4 border-slate-700 bg-slate-950 p-3 text-white shadow-2xl sm:left-8">
      <div className="mx-auto mb-2 h-1.5 w-16 rounded-full bg-slate-700" />
      <div className="space-y-2 text-sm">{children}</div>
    </div>
  );
}
function Hud({ tone = "ok", title, lines }: { tone?: "ok" | "bad" | "warn" | "info"; title: string; lines: string[] }) {
  const c = tone === "bad" ? "border-red-500/70 bg-red-950/85" : tone === "warn" ? "border-amber-400/70 bg-amber-950/85" : tone === "info" ? "border-sky-400/60 bg-slate-950/85" : "border-emerald-400/60 bg-emerald-950/85";
  return (
    <div className={`s3d-in absolute right-4 top-20 w-[min(22rem,calc(100%-2rem))] rounded-xl border p-3 font-mono text-xs text-white shadow-2xl backdrop-blur sm:right-8 ${c}`}>
      <p className="mb-1 font-sans text-sm font-bold">{title}</p>
      {lines.map((l, i) => (
        <p key={i} className="text-white/85">{l}</p>
      ))}
    </div>
  );
}
function Chain({ items, bad }: { items: string[]; bad?: number }) {
  return (
    <div className="s3d-in absolute right-4 top-20 flex w-[min(24rem,calc(100%-2rem))] flex-col gap-1.5 sm:right-8">
      {items.map((t, i) => (
        <div key={i} className={`rounded-lg border px-3 py-2 text-xs text-white shadow-lg backdrop-blur ${bad === i ? "border-red-500/70 bg-red-950/85" : "border-slate-600 bg-slate-950/85"}`} style={{ animationDelay: `${i * 0.35}s` }}>
          <b className="mr-1 text-sky-300">{i + 1}.</b> {t}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------ scenes ------------------------------ */

const ENTRY_IN: Pt[] = [[-2.6, -38], [-2.6, -10]];
const ENTRY_PARK: Pt[] = [[-2.6, -10], [-2.6, 3], [-10.8, 5], [-10.8, 10.5]];
const EXIT_OUT: Pt[] = [[-10.8, 10.5], [-10.8, 5], [2.6, 3], [2.6, -2.5]];
const EXIT_GO: Pt[] = [[2.6, -2.5], [2.6, -38]];
const BIKE_PARK: Pt[] = [[-2.6, -10], [-2.6, 3], [10.8, 5], [10.8, 10.5]];
const BIKE_OUT: Pt[] = [[10.8, 10.5], [10.8, 5], [2.6, 3], [2.6, -2.5]];

const CAM = {
  wide: [[20, 16, -28], [2, -1, 2]] as [V3, V3],
  phone: [[-8, 10, -30], [-14, 1, -6]] as [V3, V3],
  entry: [[-13, 7, -29], [-2.6, 0, -14]] as [V3, V3],
  lot: [[2, 18, -8], [-2, -2, 7]] as [V3, V3],
  exit: [[13, 7, -22], [2.6, 0, -8]] as [V3, V3],
  net: [[0, 16, -30], [14, 4, 2]] as [V3, V3],
  edge: [[-6, 7, -13], [0, 1.6, -4]] as [V3, V3],
};

const resetCommon = (w: World) => {
  w.entryArm.rotation.z = 0;
  w.exitArm.rotation.z = 0;
  w.bayA1.color.setHex(0x166534);
  w.bayB1.color.setHex(0x14532d);
  w.car.visible = false;
  w.bike.visible = false;
  w.alarm.visible = false;
  w.setPlate(w.car, "TN09AB2007");
  (w.car.userData.body as THREE.MeshStandardMaterial).color.setHex(0x2563eb);
};

const SCENES: Scene[] = [
  {
    id: "car",
    label: "Car · FASTag",
    emoji: "🚗",
    setup: (w) => {
      resetCommon(w);
      place(w.car, -2.6, -38, 0);
    },
    steps: [
      {
        title: "1 · Book on the phone, pay ₹25",
        text: "The driver picks a free bay on Slotify. A ₹25 cover charge is paid from the FASTag wallet, so the bay is locked and no one else can take it.",
        dur: 4.5,
        cam: CAM.phone,
        acts: (w) => [{ at: 0.5, dur: 2.5, run: w.packet("phone", "slotify", 0x60a5fa, "Book A1 · ₹25") }, color(w.bayA1, 0xb45309, 2.6)],
        overlay: (
          <Phone>
            <p className="font-bold">REC Parking · Bay A1</p>
            <p className="text-xs text-white/60">TN09AB2007 · arrive by 8:15</p>
            <div className="rounded-lg bg-emerald-600 py-2 text-center font-semibold">Pay ₹25 · FASTag ✓</div>
            <p className="text-[11px] text-white/60">Bay A1 is now red on every other driver&apos;s screen.</p>
          </Phone>
        ),
      },
      {
        title: "2 · Drive to the gate",
        text: "No ticket, no stopping to show anything. The booking is already waiting at the gate.",
        dur: 4,
        cam: CAM.entry,
        acts: (w) => [drive(w.car, ENTRY_IN, 0, 3.6)],
      },
      {
        title: "3 · Camera reads the plate, RFID reads the tag",
        text: "The ANPR camera reads TN09AB2007 and the RFID reader reads the FASTag. Slotify checks both belong to the same car and match today's booking.",
        dur: 4,
        cam: CAM.entry,
        acts: (w) => [beam(w.beamIn, 0.2, 2.2), pulse(w.ringIn, 0.4, 2.4)],
        overlay: <Hud title="Plate + tag matched ✓" lines={["ANPR read   TN09AB2007", "FASTag      registered to TN09AB2007", "Booking     SLT-2P3HA4P6 · bay A1", "→ open entry gate"]} />,
      },
      {
        title: "4 · Gate opens, car parks in A1",
        text: "The barrier lifts automatically and the bay turns 'parked' for everyone, live.",
        dur: 5.5,
        cam: CAM.lot,
        acts: (w) => [arm(w.entryArm, true, -1, 0), drive(w.car, ENTRY_PARK, 0.8, 3.8), arm(w.entryArm, false, -1, 2.4), color(w.bayA1, 0x991b1b, 4.5)],
      },
      {
        title: "5 · Two hours later: exit",
        text: "At the exit the plate and tag are read again. Fee = 2 h × ₹30 = ₹60, minus the ₹25 already paid = ₹35.",
        dur: 5.5,
        cam: CAM.exit,
        acts: (w) => [drive(w.car, EXIT_OUT, 0.2, 3.6), beam(w.beamOut, 3.8, 1.5), pulse(w.ringOut, 3.9, 1.5)],
        overlay: <Hud tone="info" title="⏱ 2 h 04 min parked" lines={["2 h × ₹30      = ₹60", "cover paid     − ₹25", "due by FASTag  = ₹35"]} />,
      },
      {
        title: "6 · FASTag charged through the bank network",
        text: "Slotify → acquirer bank → NPCI NETC → the driver's issuer bank debits ₹35 and sends an SMS. The operator is paid next day (T+1).",
        dur: 6,
        cam: CAM.net,
        acts: (w) => [
          { at: 0, dur: 1, run: w.packet("booth", "slotify", 0x38bdf8, "₹35") },
          { at: 1, dur: 1, run: w.packet("slotify", "acquirer", 0x38bdf8) },
          { at: 2, dur: 1, run: w.packet("acquirer", "netc", 0x38bdf8, "checks tag") },
          { at: 3, dur: 1, run: w.packet("netc", "issuer", 0x38bdf8, "debit ₹35") },
          { at: 4.2, dur: 1.4, run: w.packet("issuer", "operator", 0xf59e0b, "settles T+1") },
        ],
      },
      {
        title: "7 · Gate opens, bay is free again",
        text: "The barrier lifts, the car leaves, and bay A1 turns green on every driver's screen instantly.",
        dur: 5,
        cam: CAM.exit,
        acts: (w) => [color(w.bayA1, 0x166534, 0), arm(w.exitArm, true, 1, 0.2), drive(w.car, EXIT_GO, 1, 3.4), arm(w.exitArm, false, 1, 3.8)],
        overlay: <Hud title="SMS · Issuer bank" lines={["₹35 debited from FASTag", "REC Parking · TN09AB2007", "Balance ₹465"]} />,
      },
    ],
  },
  {
    id: "bike",
    label: "Two-wheeler · UPI",
    emoji: "🛵",
    setup: (w) => {
      resetCommon(w);
      place(w.bike, -2.6, -38, 0);
    },
    steps: [
      {
        title: "1 · Two-wheelers get their own bays, ₹10 cover",
        text: "Bikes see only bike bays (B1). Cover is ₹10 and the hourly rate is lower.",
        dur: 4,
        cam: CAM.phone,
        acts: (w) => [{ at: 0.4, dur: 2.4, run: w.packet("phone", "slotify", 0x60a5fa, "Book B1 · ₹10") }, color(w.bayB1, 0xb45309, 2.6)],
        overlay: (
          <Phone>
            <p className="font-bold">🛵 Two-wheeler · Bay B1</p>
            <p className="text-xs text-white/60">TN10ZX4521</p>
            <div className="rounded-lg bg-emerald-600 py-2 text-center font-semibold">Pay ₹10 cover ✓</div>
          </Phone>
        ),
      },
      {
        title: "2 · Plate read, gate opens",
        text: "Same camera, smaller plate. Two-line bike plates are read too.",
        dur: 6,
        cam: CAM.entry,
        acts: (w) => [drive(w.bike, ENTRY_IN, 0, 2.6), beam(w.beamIn, 2.6, 1.2), arm(w.entryArm, true, -1, 3.4), drive(w.bike, BIKE_PARK, 4, 1.9), arm(w.entryArm, false, -1, 5.2)],
        overlay: <Hud title="Plate matched ✓" lines={["ANPR read   TN10ZX4521", "Booking     bay B1 (two-wheeler)"]} />,
      },
      {
        title: "3 · No FASTag? Pay by UPI at the exit",
        text: "Most bikes have no FASTag, so the exit shows a UPI QR. Paid in seconds, and the gate opens on payment.",
        dur: 6,
        cam: CAM.exit,
        acts: (w) => [color(w.bayB1, 0x991b1b, 0), drive(w.bike, BIKE_OUT, 0.2, 2.8), beam(w.beamOut, 3, 1.2), { at: 3.8, dur: 1.5, run: w.packet("upi", "slotify", 0x22c55e, "UPI ₹20") }],
        overlay: (
          <Phone>
            <p className="font-bold">Exit · due ₹20</p>
            <div className="mx-auto grid size-24 grid-cols-5 gap-0.5 rounded bg-white p-1.5">
              {Array.from({ length: 25 }).map((_, i) => <span key={i} className={(i * 7) % 3 ? "bg-slate-900" : "bg-white"} />)}
            </div>
            <div className="rounded-lg bg-emerald-600 py-1.5 text-center text-xs font-semibold">Paid via UPI ✓</div>
          </Phone>
        ),
      },
      {
        title: "4 · Gate opens",
        text: "Payment confirmed, so the barrier lifts and bay B1 is free again.",
        dur: 4.5,
        cam: CAM.exit,
        acts: (w) => [color(w.bayB1, 0x14532d, 0), arm(w.exitArm, true, 1, 0.1), drive(w.bike, EXIT_GO, 0.8, 2.8), arm(w.exitArm, false, 1, 3.4)],
      },
    ],
  },
  {
    id: "clone",
    label: "Cloned plate",
    emoji: "🚨",
    setup: (w) => {
      resetCommon(w);
      place(w.car, -2.6, -38, 0);
      (w.car.userData.body as THREE.MeshStandardMaterial).color.setHex(0xdc2626);
    },
    steps: [
      {
        title: "1 · A car arrives with a copied plate",
        text: "Someone has copied TN09AB2007 onto a different car to make the real owner pay.",
        dur: 4,
        cam: CAM.entry,
        acts: (w) => [drive(w.car, ENTRY_IN, 0, 3.6)],
      },
      {
        title: "2 · Camera and tag disagree",
        text: "The camera reads TN09AB2007, but the FASTag on that car is registered to TN12GE3745. A plate can be copied; the tag can't.",
        dur: 5,
        cam: CAM.entry,
        acts: (w) => [beam(w.beamIn, 0.2, 2), pulse(w.ringIn, 0.4, 2), flash(w.alarm, 2.2, 2.8)],
        overlay: <Hud tone="bad" title="⚠ Tag–plate mismatch" lines={["ANPR read   TN09AB2007", "FASTag      registered to TN12GE3745", "→ gate HELD · no charge made"]} />,
      },
      {
        title: "3 · Fraud case opens by itself",
        text: "Slotify opens a cloned-plate case for the real owner, the parking operator adds CCTV evidence, and the Command Centre decides.",
        dur: 7,
        cam: CAM.wide,
        acts: (w) => [flash(w.alarm, 0, 3), { at: 0.5, dur: 1.5, run: w.packet("booth", "slotify", 0xef4444, "case FC-…") }, { at: 2.4, dur: 1.6, run: w.packet("slotify", "operator", 0xef4444, "CCTV still") }],
        overlay: <Chain bad={0} items={["Gate: tag–plate mismatch, gate held", "Case opened for the real owner of TN09AB2007", "Operator attaches a CCTV still from that moment", "Command Centre investigates; asks for full video if needed", "Real owner is never charged, or refunded"]} />,
      },
    ],
  },
  {
    id: "stolen",
    label: "Stolen tag",
    emoji: "🛑",
    setup: (w) => {
      resetCommon(w);
      place(w.car, -2.6, -38, 0);
    },
    steps: [
      {
        title: "1 · Owner reports the tag stolen",
        text: "In the app, 'Report tag lost / stolen' hotlists the tag on the NPCI network.",
        dur: 4,
        cam: CAM.phone,
        acts: (w) => [{ at: 0.4, dur: 2.2, run: w.packet("phone", "netc", 0xef4444, "hotlist tag") }],
        overlay: (
          <Phone>
            <p className="font-bold">FASTag status</p>
            <div className="rounded-lg bg-red-600 py-2 text-center font-semibold">Hotlisted 🛑</div>
            <p className="text-[11px] text-white/60">Any gate that reads it will hold the vehicle.</p>
          </Phone>
        ),
      },
      {
        title: "2 · The tag shows up at a gate",
        text: "The reader checks the tag against NPCI's exception list. It's hotlisted, so the gate stays down and security is alerted.",
        dur: 6,
        cam: CAM.entry,
        acts: (w) => [drive(w.car, ENTRY_IN, 0, 3), pulse(w.ringIn, 3, 1.6), flash(w.alarm, 3.4, 2.4)],
        overlay: <Hud tone="bad" title="🛑 Hotlisted tag" lines={["NETC exception list: HOTLISTED", "→ gate HELD · security alerted", "→ owner notified by issuer bank"]} />,
      },
    ],
  },
  {
    id: "low",
    label: "Low balance",
    emoji: "🪫",
    setup: (w) => {
      resetCommon(w);
      place(w.car, -10.8, 10.5, Math.PI);
      w.bayA1.color.setHex(0x991b1b);
    },
    steps: [
      {
        title: "1 · FASTag can't cover the fee",
        text: "At exit the tag has ₹12 but ₹35 is due. Nobody is stuck at the gate.",
        dur: 5,
        cam: CAM.exit,
        acts: (w) => [drive(w.car, EXIT_OUT, 0, 3.4), pulse(w.ringOut, 3.4, 1.4)],
        overlay: <Hud tone="warn" title="🪫 Low balance" lines={["FASTag balance ₹12", "Due            ₹35", "→ fall back to UPI / QR / card"]} />,
      },
      {
        title: "2 · Pay by UPI, gate opens",
        text: "The driver scans a UPI QR and the gate opens on payment. Same flow for blacklisted tags.",
        dur: 6,
        cam: CAM.exit,
        acts: (w) => [{ at: 0.3, dur: 1.4, run: w.packet("upi", "slotify", 0x22c55e, "UPI ₹35") }, color(w.bayA1, 0x166534, 1.8), arm(w.exitArm, true, 1, 2), drive(w.car, EXIT_GO, 2.6, 2.8), arm(w.exitArm, false, 1, 5.2)],
        overlay: (
          <Phone>
            <p className="font-bold">Exit · due ₹35</p>
            <div className="rounded-lg bg-emerald-600 py-2 text-center font-semibold">Paid via UPI ✓</div>
          </Phone>
        ),
      },
    ],
  },
  {
    id: "net",
    label: "FASTag network",
    emoji: "🏦",
    setup: (w) => resetCommon(w),
    steps: [
      {
        title: "Who is involved in one FASTag charge",
        text: "Slotify sits on the parking-lot side. In production we connect through an acquirer bank that is certified on NPCI's NETC network, the same route toll plazas use.",
        dur: 8,
        cam: CAM.net,
        acts: (w) => [
          { at: 0, dur: 1.2, run: w.packet("booth", "slotify", 0xa855f7, "tag + plate") },
          { at: 1.4, dur: 1.2, run: w.packet("slotify", "acquirer", 0xa855f7, "debit request") },
          { at: 2.8, dur: 1.2, run: w.packet("acquirer", "netc", 0xa855f7, "route + exception list") },
          { at: 4.2, dur: 1.2, run: w.packet("netc", "issuer", 0xa855f7, "debit wallet") },
          { at: 5.8, dur: 1.6, run: w.packet("issuer", "operator", 0xf59e0b, "settlement T+1") },
        ],
        overlay: <Chain items={["Gate: RFID tag + ANPR plate read", "Slotify: works out the fee from the booking", "Acquirer bank: the parking lot's bank, sends the request", "NPCI NETC: checks blacklist / hotlist, routes to the right bank", "Issuer bank: debits the driver's FASTag, sends SMS", "Operator: paid next day (T+1)"]} />,
      },
    ],
  },
  {
    id: "privacy",
    label: "Privacy & accuracy",
    emoji: "🔒",
    setup: (w) => resetCommon(w),
    steps: [
      {
        title: "Video never leaves the parking lot",
        text: "Plate reading and bay detection run on an edge box at the site. Only plate text and bay states go to the cloud, never the video itself.",
        dur: 6,
        cam: CAM.edge,
        acts: (w) => [{ at: 0.5, dur: 2, run: w.packet("booth", "slotify", 0x22c55e, "TN09AB2007 · A1 occupied") }],
        overlay: <Chain items={["Camera → edge AI box at the lot", "Sent to cloud: plate text, bay free/occupied", "Not sent: video, faces", "Footage stays on the operator's recorder"]} />,
      },
      {
        title: "Footage only with approval, every access logged",
        text: "The Command Centre can request a clip for a dispute. The operator approves it, and every request and approval goes into an audit trail that can't be edited.",
        dur: 6,
        cam: CAM.wide,
        acts: (w) => [{ at: 0.4, dur: 1.6, run: w.packet("slotify", "operator", 0xf59e0b, "request clip") }, { at: 2.6, dur: 1.6, run: w.packet("operator", "slotify", 0x22c55e, "approved · ±5 min") }],
        overlay: <Chain items={["Command Centre requests a time-limited clip", "Operator approves or declines", "Only that clip is shared", "Audit trail: who asked, why, when"]} />,
      },
      {
        title: "Plate reads are never trusted alone",
        text: "Each read is matched against the bookings at that lot and cross-checked with the FASTag. If the read is unsure or they disagree, the gate holds and a person decides; nobody is charged on a guess.",
        dur: 7,
        cam: CAM.entry,
        acts: (w) => [beam(w.beamIn, 0.3, 2), pulse(w.ringIn, 0.5, 2)],
        overlay: <Chain items={["Camera read + confidence score", "Matched to today's bookings at this lot", "Cross-checked with the FASTag's registered plate", "Unsure or mismatch → gate holds, manual check"]} />,
      },
    ],
  },
];

/* ------------------------------ component ------------------------------ */

export default function Story3D() {
  const mount = useRef<HTMLDivElement>(null);
  const worldRef = useRef<World | null>(null);
  const camRef = useRef<THREE.PerspectiveCamera | null>(null);
  const ctlRef = useRef<OrbitControls | null>(null);
  const run = useRef({ scene: 0, step: 0, t: 0, acts: [] as (Act & { last: number })[], playing: true, camFrom: [new THREE.Vector3(), new THREE.Vector3()], camTo: [new THREE.Vector3(), new THREE.Vector3()], camT: 1 });
  const [ui, setUi] = useState({ scene: 0, step: 0, playing: true, t: 0 });

  const enterStep = useCallback((si: number, st: number, fresh: boolean) => {
    const w = worldRef.current, cam = camRef.current, ctl = ctlRef.current;
    if (!w || !cam || !ctl) return;
    const r = run.current;
    // finish any running actions of the previous step so objects land where they should
    for (const a of r.acts) a.run(1);
    const sc = SCENES[si];
    if (fresh) sc.setup(w);
    const step = sc.steps[st];
    r.scene = si;
    r.step = st;
    r.t = 0;
    r.acts = (step.acts?.(w) ?? []).map((a) => ({ ...a, last: -1 }));
    r.camFrom = [cam.position.clone(), ctl.target.clone()];
    r.camTo = [new THREE.Vector3(...step.cam[0]), new THREE.Vector3(...step.cam[1])];
    r.camT = 0;
    setUi((u) => ({ ...u, scene: si, step: st, t: 0 }));
  }, []);

  const goScene = useCallback((si: number) => enterStep(si, 0, true), [enterStep]);
  const next = useCallback(() => {
    const r = run.current;
    const sc = SCENES[r.scene];
    if (r.step + 1 < sc.steps.length) enterStep(r.scene, r.step + 1, false);
    else enterStep((r.scene + 1) % SCENES.length, 0, true);
  }, [enterStep]);
  const prev = useCallback(() => {
    const r = run.current;
    if (r.step > 0) {
      // replay the scene up to the previous step
      const target = r.step - 1;
      enterStep(r.scene, 0, true);
      for (let i = 1; i <= target; i++) enterStep(r.scene, i, false);
    } else goScene((r.scene - 1 + SCENES.length) % SCENES.length);
  }, [enterStep, goScene]);

  useEffect(() => {
    const el = mount.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(renderer.domElement);
    const labels = new CSS2DRenderer();
    labels.domElement.style.position = "absolute";
    labels.domElement.style.inset = "0";
    labels.domElement.style.pointerEvents = "none";
    el.appendChild(labels.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1020);
    scene.fog = new THREE.Fog(0x0b1020, 45, 110);
    const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 400);
    cam.position.set(...CAM.wide[0]);
    const ctl = new OrbitControls(cam, renderer.domElement);
    ctl.enableDamping = true;
    ctl.maxPolarAngle = Math.PI / 2.1;
    ctl.target.set(...CAM.wide[1]);
    scene.add(new THREE.HemisphereLight(0xbfdbfe, 0x1e293b, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(20, 30, -15);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30 });
    scene.add(sun);

    worldRef.current = buildWorld(scene);
    camRef.current = cam;
    ctlRef.current = ctl;
    enterStep(0, 0, true);

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h);
      labels.setSize(w, h);
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    };
    resize();
    window.addEventListener("resize", resize);

    let raf = 0;
    let last = performance.now();
    let uiTick = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const r = run.current;
      const step = SCENES[r.scene].steps[r.step];
      if (r.playing) {
        r.t += dt;
        for (const a of r.acts) {
          if (r.t < a.at) continue;
          const p = clamp((r.t - a.at) / a.dur);
          if (p === a.last && p === 1) continue;
          a.run(a.dur < 0.05 ? 1 : ease(p));
          a.last = p;
        }
        if (r.t >= step.dur) next();
      }
      if (r.camT < 1) {
        r.camT = Math.min(1, r.camT + dt / 1.4);
        const k = ease(r.camT);
        cam.position.lerpVectors(r.camFrom[0], r.camTo[0], k);
        ctl.target.lerpVectors(r.camFrom[1], r.camTo[1], k);
      }
      ctl.update();
      renderer.render(scene, cam);
      labels.render(scene, cam);
      if ((uiTick += dt) > 0.1) {
        uiTick = 0;
        setUi((u) => (Math.abs(u.t - r.t) > 0.05 ? { ...u, t: r.t } : u));
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      ctl.dispose();
      renderer.dispose();
      el.innerHTML = "";
    };
  }, [enterStep, next]);

  const togglePlay = () => {
    run.current.playing = !run.current.playing;
    setUi((u) => ({ ...u, playing: run.current.playing }));
  };

  const sc = SCENES[ui.scene];
  const step = sc.steps[ui.step];
  const prog = Math.min(1, ui.t / step.dur);

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#0b1020] text-white">
      <style>{`
        .s3d-label,.s3d-tag{font:600 11px ui-sans-serif,system-ui;color:#e2e8f0;background:rgba(15,23,42,.75);border:1px solid rgba(148,163,184,.35);padding:2px 6px;border-radius:6px;white-space:nowrap}
        .s3d-bay{font:700 12px ui-sans-serif,system-ui;color:#cbd5e1;text-shadow:0 1px 2px #000}
        .s3d-node{font:700 12px ui-sans-serif,system-ui;color:#fff;background:rgba(2,6,23,.8);border:1px solid rgba(148,163,184,.4);padding:3px 8px;border-radius:999px;white-space:nowrap}
        .s3d-packet{font:700 11px ui-monospace,monospace;color:#0b1020;background:#e0f2fe;padding:1px 6px;border-radius:6px;white-space:nowrap}
        @keyframes s3din{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
        .s3d-in,.s3d-in>div{animation:s3din .45s ease both}
      `}</style>
      <div ref={mount} className="absolute inset-0" />

      {/* top bar */}
      <div className="absolute inset-x-0 top-0 flex items-center gap-2 overflow-x-auto bg-gradient-to-b from-black/70 to-transparent px-3 py-3 sm:px-6">
        <Link href="/" className="mr-1 flex shrink-0 items-center gap-1 rounded-full border border-white/20 px-3 py-1.5 text-xs font-semibold hover:bg-white/10"><ArrowLeft className="size-3.5" /> Slotify</Link>
        {SCENES.map((s, i) => (
          <button key={s.id} onClick={() => goScene(i)} className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${ui.scene === i ? "bg-sky-500 text-white" : "border border-white/20 bg-black/30 text-white/80 hover:bg-white/10"}`}>
            {s.emoji} {s.label}
          </button>
        ))}
      </div>

      {/* overlay for this step */}
      <div key={`${ui.scene}-${ui.step}`}>{step.overlay}</div>

      {/* caption + controls */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/60 to-transparent px-4 pb-4 pt-10 sm:px-8">
        <div key={`c-${ui.scene}-${ui.step}`} className="s3d-in mx-auto max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-widest text-sky-300">{sc.emoji} {sc.label} · step {ui.step + 1} of {sc.steps.length}</p>
          <h2 className="mt-1 text-xl font-extrabold sm:text-2xl">{step.title}</h2>
          <p className="mt-1 text-sm text-white/80 sm:text-base">{step.text}</p>
        </div>
        <div className="mx-auto mt-3 flex max-w-3xl items-center gap-2">
          <button aria-label="Previous" onClick={prev} className="grid size-9 place-items-center rounded-full border border-white/20 hover:bg-white/10"><ChevronLeft className="size-4" /></button>
          <button aria-label={ui.playing ? "Pause" : "Play"} onClick={togglePlay} className="grid size-10 place-items-center rounded-full bg-sky-500 hover:bg-sky-400">{ui.playing ? <Pause className="size-4" /> : <Play className="size-4" />}</button>
          <button aria-label="Next" onClick={next} className="grid size-9 place-items-center rounded-full border border-white/20 hover:bg-white/10"><ChevronRight className="size-4" /></button>
          <button aria-label="Restart scene" onClick={() => goScene(ui.scene)} className="grid size-9 place-items-center rounded-full border border-white/20 hover:bg-white/10"><RotateCcw className="size-4" /></button>
          <div className="ml-2 flex flex-1 gap-1">
            {sc.steps.map((_, i) => (
              <div key={i} className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/15">
                <div className="h-full bg-sky-400" style={{ width: i < ui.step ? "100%" : i === ui.step ? `${prog * 100}%` : "0%" }} />
              </div>
            ))}
          </div>
          <span className="hidden text-[11px] text-white/50 sm:inline">drag to look around</span>
        </div>
      </div>
    </div>
  );
}
