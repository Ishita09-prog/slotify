"use client";

import { Panel } from "@/components/command/ui";
import { useCity } from "@/lib/city";
import { CITY_LIST } from "@/lib/cities";

type Box = { x: number; y: number; w: number; h: number; title: string; sub?: string; tone?: "edge" | "app" | "core" | "ai" | "data" | "ext" | "user" };

const TONE: Record<NonNullable<Box["tone"]>, { stroke: string; fill: string; text: string }> = {
  user: { stroke: "#64748b", fill: "#0f172a", text: "#e2e8f0" },
  app: { stroke: "#38bdf8", fill: "#0c1a2b", text: "#e0f2fe" },
  core: { stroke: "#3987e5", fill: "#0d1830", text: "#dbeafe" },
  ai: { stroke: "#9085e9", fill: "#16132e", text: "#ede9fe" },
  data: { stroke: "#199e70", fill: "#0b2019", text: "#d1fae5" },
  ext: { stroke: "#d95926", fill: "#24130b", text: "#ffedd5" },
  edge: { stroke: "#eab308", fill: "#221c07", text: "#fef9c3" },
};

const LAYERS: { y: number; label: string }[] = [
  { y: 20, label: "USERS" },
  { y: 100, label: "CLIENTS" },
  { y: 180, label: "GATEWAY" },
  { y: 260, label: "SERVICES" },
  { y: 360, label: "AI / ANALYTICS" },
  { y: 450, label: "DATA" },
  { y: 540, label: "SOURCES" },
];

const BOXES: Box[] = [
  { x: 120, y: 26, w: 170, h: 46, title: "Citizens / drivers", sub: "find · book · pay", tone: "user" },
  { x: 305, y: 26, w: 170, h: 46, title: "Lot operators", sub: "capacity · maintenance", tone: "user" },
  { x: 490, y: 26, w: 170, h: 46, title: "Traffic police", sub: "enforcement approvals", tone: "user" },
  { x: 675, y: 26, w: 190, h: 46, title: "ULB command officers", sub: "city-wide decisions", tone: "user" },
  { x: 880, y: 26, w: 170, h: 46, title: "Auditors / RTI", sub: "read-only ledger", tone: "user" },

  { x: 120, y: 106, w: 260, h: 46, title: "Citizen app (Next.js PWA)", sub: "offline-capable · on-device model", tone: "app" },
  { x: 395, y: 106, w: 260, h: 46, title: "Operator & police dashboards", sub: "role-scoped views", tone: "app" },
  { x: 670, y: 106, w: 380, h: 46, title: "Command Centre (GIS · incidents · audit)", sub: "this screen", tone: "app" },

  { x: 120, y: 186, w: 930, h: 46, title: "API gateway — OIDC/SSO + MFA · RBAC on every call · rate limits · mTLS to edge · request signing", tone: "core" },

  { x: 120, y: 266, w: 170, h: 66, title: "Ingest service", sub: "events · ANPR · validation", tone: "core" },
  { x: 302, y: 266, w: 170, h: 66, title: "Booking & FASTag", sub: "reservations · wallet · billing", tone: "core" },
  { x: 484, y: 266, w: 170, h: 66, title: "Incident engine", sub: "detectors · correlation · escalation", tone: "core" },
  { x: 666, y: 266, w: 185, h: 66, title: "Notification service", sub: "field app · SMS · VMS · citizen push", tone: "core" },
  { x: 863, y: 266, w: 187, h: 66, title: "Audit ledger", sub: "hash chain · WORM anchor", tone: "core" },

  { x: 120, y: 366, w: 300, h: 56, title: "Forecast service (GBM, 3 quantiles)", sub: "15–180 min · intervals · explanations", tone: "ai" },
  { x: 432, y: 366, w: 300, h: 56, title: "Anomaly detection", sub: "forecast residual · 2-check debounce", tone: "ai" },
  { x: 744, y: 366, w: 306, h: 56, title: "Analytics & reporting", sub: "KPIs · impact · PDF sit-reps", tone: "ai" },

  { x: 120, y: 456, w: 225, h: 50, title: "PostgreSQL + PostGIS", sub: "lots · bookings · incidents", tone: "data" },
  { x: 357, y: 456, w: 225, h: 50, title: "Time-series store", sub: "occupancy history → retraining", tone: "data" },
  { x: 594, y: 456, w: 225, h: 50, title: "Firestore / Redis", sub: "realtime fan-out · cache", tone: "data" },
  { x: 831, y: 456, w: 219, h: 50, title: "Object store (WORM)", sub: "evidence images · ledger anchors", tone: "data" },

  { x: 120, y: 546, w: 175, h: 50, title: "Edge camera nodes", sub: "on-device YOLO bay status", tone: "edge" },
  { x: 307, y: 546, w: 175, h: 50, title: "ANPR cameras", sub: "plates + evidence frames", tone: "ext" },
  { x: 494, y: 546, w: 175, h: 50, title: "NETC FASTag", sub: "toll-style parking billing", tone: "ext" },
  { x: 681, y: 546, w: 175, h: 50, title: "Weather & calendar", sub: "rain forecast · TN holidays", tone: "ext" },
  { x: 868, y: 546, w: 182, h: 50, title: "e-Challan system", sub: "challan issue (integration)", tone: "ext" },
];

function BoxEl({ b }: { b: Box }) {
  const t = TONE[b.tone ?? "core"];
  return (
    <g>
      <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={6} fill={t.fill} stroke={t.stroke} strokeWidth={1.2} />
      <text x={b.x + 10} y={b.y + (b.sub ? 19 : b.h / 2 + 4)} fill={t.text} fontSize={11.5} fontWeight={700}>{b.title}</text>
      {b.sub && <text x={b.x + 10} y={b.y + 35} fill="#94a3b8" fontSize={10}>{b.sub}</text>}
    </g>
  );
}

export default function ArchitecturePage() {
  const { city } = useCity();
  return (
    <div className="space-y-3">
      <Panel title="System architecture" subtitle="Layered, modular platform. Prototype runs every layer; production splits services only where scale demands it.">
        <div className="overflow-x-auto">
          <svg viewBox="0 0 1060 610" className="min-w-[900px]" role="img" aria-label="Layered architecture diagram from users down to data sources">
            {LAYERS.map((l) => (
              <g key={l.label}>
                <line x1={10} x2={1050} y1={l.y - 6} y2={l.y - 6} stroke="#1e293b" strokeDasharray="2 4" />
                <text x={12} y={l.y + 22} fill="#64748b" fontSize={9.5} fontWeight={700} letterSpacing={1.4}>{l.label}</text>
              </g>
            ))}
            {/* flows */}
            <defs>
              <marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill="#475569" />
              </marker>
            </defs>
            {[[585, 72, 585, 106], [585, 152, 585, 186], [585, 232, 585, 266], [585, 332, 585, 366], [585, 422, 585, 456], [207, 546, 207, 332], [394, 546, 394, 506]].map(([x1, y1, x2, y2], i) => (
              <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#475569" strokeWidth={1.2} markerEnd="url(#arr)" />
            ))}
            {BOXES.map((b) => <BoxEl key={b.title} b={b} />)}
          </svg>
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-[hsl(var(--cc-dim))]">
          {Object.entries({ user: "People", app: "Clients", core: "Core services", ai: "AI / analytics", data: "Data stores", edge: "Edge devices", ext: "External systems" }).map(([k, v]) => (
            <span key={k} className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm border" style={{ borderColor: TONE[k as keyof typeof TONE].stroke, background: TONE[k as keyof typeof TONE].fill }} /> {v}</span>
          ))}
        </div>
      </Panel>

      <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
        <Panel title="Why this shape">
          <ul className="list-disc space-y-1.5 pl-4 text-xs text-slate-300">
            <li><b>Modular monolith + workers</b> (FastAPI) rather than dozens of microservices: one deployable per city cluster, clear module boundaries, split later only where load requires (ingest, notifications).</li>
            <li><b>Edge-first detection</b>: cameras send bay states, not video — ~200 bytes per event, works on 4G, keeps footage local (privacy).</li>
            <li><b>Same model in browser and server</b>: forecasts keep working through a backend outage; a parity test (scripts/parity.ts) checks Python ↔ TypeScript give identical predictions.</li>
            <li><b>Human-in-the-loop by design</b>: the AI only recommends; approval, rejection and escalation are first-class states.</li>
          </ul>
        </Panel>
        <Panel title="Scale: multiple cities & departments">
          <ul className="list-disc space-y-1.5 pl-4 text-xs text-slate-300">
            <li>Each city is one config file ({CITY_LIST.map((c) => c.name).join(", ")} today) — zones, lots, units, VMS, authority. No code changes to onboard a city.</li>
            <li>Data partitioned by city → zone; a state-level view aggregates city summaries only.</li>
            <li>Ingest designed for ~50k events/min per city (bay changes are sparse: a 100-bay lot emits ~1 event/min).</li>
            <li>Roles scope by department and division (e.g. Traffic South sees its own incidents).</li>
          </ul>
        </Panel>
        <Panel title="Security & privacy">
          <ul className="list-disc space-y-1.5 pl-4 text-xs text-slate-300">
            <li>SSO (OIDC) + MFA for officials; mobile OTP for citizens; short-lived tokens; RBAC checked at the gateway on every request.</li>
            <li>Edge nodes authenticate with device certificates (mTLS); every event is signed and validated (schema, ranges, rate).</li>
            <li>Plates are personal data: purpose-limited to enforcement & billing, encrypted at rest, retained per policy, access logged (aligned to the DPDP Act, 2023).</li>
            <li>Append-only hash-chained audit, anchored to WORM storage; exportable for audit / RTI.</li>
          </ul>
        </Panel>
        <Panel title="Availability & recovery">
          <ul className="list-disc space-y-1.5 pl-4 text-xs text-slate-300">
            <li>Active–standby across two availability zones; target RPO ≤ 5 min, RTO ≤ 30 min.</li>
            <li>Clients degrade gracefully: edge data + on-device model + queued writes (shown live in the Backend-outage drill).</li>
            <li>Camera failures switch the lot to labelled estimates and open a vendor ticket automatically.</li>
            <li>Health console and heartbeats for every node; alerts on missed heartbeats and engine lag.</li>
          </ul>
        </Panel>
        <Panel title="Data provenance">
          <ul className="list-disc space-y-1.5 pl-4 text-xs text-slate-300">
            <li>Every number on screen names its source (cameras, ANPR, model version, calendar) and time.</li>
            <li>Every AI output stores model version, inputs and interval in the audit trail.</li>
            <li>Estimated values are always marked (~, ESTIMATED) and never mixed silently with observed ones.</li>
          </ul>
        </Panel>
        <Panel title="Prototype vs. production">
          <ul className="list-disc space-y-1.5 pl-4 text-xs text-slate-300">
            <li><b>Real in this prototype:</b> multi-city platform, GIS, trained forecaster + intervals + explanations, anomaly detector, incident workflow & RBAC, hash-chained audit, PDF reports, failure handling.</li>
            <li><b>Simulated:</b> camera / ANPR feeds, training history, weather, field units, SMS / VMS delivery, sign-in identities.</li>
            <li><b>Active city:</b> {city.name} — {city.lots.length} lots, {city.commandZones.length} zones, {city.units.length} field units.</li>
          </ul>
        </Panel>
      </div>
    </div>
  );
}
