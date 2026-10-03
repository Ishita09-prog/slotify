import type { CityConfig } from "../cities";
import type { DemoUser } from "./rbac";
import { ROLES } from "./rbac";
import type { Incident, Notification } from "./types";
import type { AuditEntry } from "./audit";
import type { ModelCard } from "../ml/forecast";

/** PDF generation runs in the browser (jsPDF), so reports work offline / in degraded mode too. */

const ist = (t: number) =>
  new Date(t).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

async function doc() {
  const [{ jsPDF }, auto] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const d = new jsPDF({ unit: "pt", format: "a4" });
  return { d, autoTable: auto.default };
}

type D = Awaited<ReturnType<typeof doc>>["d"];

function header(d: D, city: CityConfig, title: string, ref: string, user: DemoUser | null) {
  const w = d.internal.pageSize.getWidth();
  d.setFillColor(11, 18, 32);
  d.rect(0, 0, w, 86, "F");
  d.setTextColor(226, 232, 240);
  d.setFont("helvetica", "bold");
  d.setFontSize(9);
  d.text(`${city.authority.toUpperCase()}  ·  ${city.police.toUpperCase()}`, 40, 30);
  d.setFontSize(18);
  d.text(clean(title), 40, 54);
  d.setFont("helvetica", "normal");
  d.setFontSize(9);
  d.setTextColor(148, 163, 184);
  d.text(`Ref ${ref}  ·  Generated ${ist(Date.now())} IST  ·  by ${user ? `${user.name} (${ROLES[user.role].label})` : "system"}`, 40, 72);
  // simulated-data stamp
  d.setDrawColor(234, 179, 8);
  d.setTextColor(234, 179, 8);
  d.setFont("helvetica", "bold");
  d.setFontSize(8);
  d.roundedRect(w - 150, 22, 110, 18, 3, 3);
  d.text("SIMULATED DATA", w - 95, 34, { align: "center" });
  d.setTextColor(15, 23, 42);
  d.setFont("helvetica", "normal");
}

function footer(d: D, note: string) {
  const n = d.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    d.setPage(i);
    const w = d.internal.pageSize.getWidth();
    const h = d.internal.pageSize.getHeight();
    d.setFontSize(7.5);
    d.setTextColor(100, 116, 139);
    d.text(note, 40, h - 24, { maxWidth: w - 140 });
    d.text(`Page ${i} of ${n}`, w - 40, h - 24, { align: "right" });
  }
}

function section(d: D, y: number, title: string) {
  d.setFont("helvetica", "bold");
  d.setFontSize(11);
  d.setTextColor(15, 23, 42);
  d.text(title, 40, y);
  d.setDrawColor(203, 213, 225);
  d.line(40, y + 4, d.internal.pageSize.getWidth() - 40, y + 4);
  d.setFont("helvetica", "normal");
  return y + 18;
}

/** Standard PDF fonts are WinAnsi only: map the few non-Latin-1 symbols we use. */
export const clean = (t: string) =>
  t.replace(/₹/g, "Rs ").replace(/≥/g, ">=").replace(/≤/g, "<=").replace(/→/g, "->").replace(/≈/g, "~").replace(/×/g, "x").replace(/[“”]/g, '"').replace(/[‘’]/g, "'");

const lastY = (d: D) => (d as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
const tableStyle = {
  styles: { fontSize: 8.5, cellPadding: 4, textColor: [30, 41, 59] as [number, number, number] },
  headStyles: { fillColor: [30, 41, 59] as [number, number, number], textColor: [241, 245, 249] as [number, number, number], fontStyle: "bold" as const },
  alternateRowStyles: { fillColor: [248, 250, 252] as [number, number, number] },
  margin: { left: 40, right: 40 },
  didParseCell: (data: { cell: { text: string[] } }) => {
    data.cell.text = data.cell.text.map(clean);
  },
};

export async function downloadIncidentReport(inc: Incident, city: CityConfig, user: DemoUser | null, notifications: Notification[]) {
  const { d, autoTable } = await doc();
  header(d, city, `Incident report · ${inc.id}`, inc.id, user);
  let y = 112;
  d.setFont("helvetica", "bold");
  d.setFontSize(13);
  d.text(clean(inc.title), 40, y);
  d.setFont("helvetica", "normal");
  d.setFontSize(9.5);
  y += 16;
  const lines = d.splitTextToSize(clean(inc.summary), d.internal.pageSize.getWidth() - 80);
  d.text(lines, 40, y);
  y += lines.length * 12 + 8;

  autoTable(d, {
    ...tableStyle,
    startY: y,
    head: [["Field", "Value"]],
    body: [
      ["Severity / risk", `${inc.severity.toUpperCase()} · ${inc.risk.score}/100`],
      ["Status", inc.status.replace("_", " ")],
      ["Detected", `${ist(inc.detectedAt)} IST`],
      ["Source", inc.source],
      ["Detection confidence", `${Math.round(inc.confidence * 100)}%`],
      ["Zone", city.commandZones.find((z) => z.id === inc.zoneId)?.name ?? inc.zoneId],
      ["Approved by", inc.approved ? `${inc.approved.by} (${inc.approved.role}) at ${ist(inc.approved.at)}` : "—"],
      ["Resolved", inc.resolved ? `${inc.resolved.by} at ${ist(inc.resolved.at)} — ${inc.resolved.note}` : "—"],
    ],
  });
  y = lastY(d) + 20;
  y = section(d, y, "Risk score breakdown");
  autoTable(d, { ...tableStyle, startY: y, head: [["Factor", "Value", "Points"]], body: inc.risk.factors.map((f) => [f.label, f.value, `+${f.points}`]) });
  y = lastY(d) + 20;
  if (inc.forecast) {
    y = section(d, y, `AI assessment (${inc.forecast.modelVersion})`);
    autoTable(d, {
      ...tableStyle,
      startY: y,
      head: [["Input", "Contribution (occupancy pts)"]],
      body: [
        [`Forecast ${inc.forecast.horizonMin ? `in ${inc.forecast.horizonMin} min` : "now"}`, `${Math.round(inc.forecast.occupancy * 100)}% (80% interval ${Math.round(inc.forecast.low * 100)}–${Math.round(inc.forecast.high * 100)}%)`],
        ...inc.forecast.factors.map((f) => [f.label, `${f.points > 0 ? "+" : ""}${f.points.toFixed(1)}`]),
      ],
    });
    y = lastY(d) + 20;
  }
  y = section(d, y, "Recommended actions");
  autoTable(d, {
    ...tableStyle,
    startY: y,
    head: [["Action", "Type", "Decision"]],
    body: inc.recommendations.map((r) => [r.title, r.enforcement ? "Enforcement" : "Policy / ops", inc.approved?.recIds.includes(r.id) ? "APPROVED" : inc.status === "awaiting_approval" ? "pending" : "not selected"]),
  });
  y = lastY(d) + 20;
  if (inc.occAtDetection !== undefined) {
    y = section(d, y, "Impact");
    autoTable(d, {
      ...tableStyle,
      startY: y,
      head: [["At detection", "Forecast without action (60 min)", "At close / now"]],
      body: [[`${Math.round(inc.occAtDetection * 100)}%`, inc.counterfactual !== undefined ? `${Math.round(inc.counterfactual * 100)}%` : "—", inc.occAtResolution !== undefined ? `${Math.round(inc.occAtResolution * 100)}%` : "—"]],
    });
    y = lastY(d) + 20;
  }
  y = section(d, y, "Timeline");
  autoTable(d, { ...tableStyle, startY: y, head: [["Time (IST)", "Event", "Actor"]], body: inc.timeline.map((t) => [ist(t.at), t.label, t.actor]), columnStyles: { 0: { cellWidth: 120 } } });
  const ns = notifications.filter((n) => n.incidentId === inc.id);
  if (ns.length) {
    y = lastY(d) + 20;
    y = section(d, y, "Notifications");
    autoTable(d, { ...tableStyle, startY: y, head: [["Channel", "To", "Message", "Status"]], body: ns.map((n) => [n.channel, n.to, n.message, n.status]) });
  }
  footer(d, "Slotify prototype. All figures are simulated for demonstration. AI outputs are advisory; actions shown as APPROVED were authorised by the named official and are recorded in the hash-chained audit trail.");
  d.save(`${inc.id}.pdf`);
}

export async function downloadSituationReport(args: {
  city: CityConfig;
  user: DemoUser | null;
  totals: { usable: number; free: number; occupancy: number; fullLots: number; staleLots: number };
  zones: { name: string; occupancy: number; free: number; lots: number; forecast60?: number }[];
  lots: { name: string; zone: string; occupancy: number; free: number; forecast?: string; feed: string }[];
  incidents: Incident[];
  violations: { total: number; actioned: number; byType: [string, number][] };
  model: ModelCard | null;
  auditHead: AuditEntry | undefined;
  auditCount: number;
}) {
  const { d, autoTable } = await doc();
  const ref = `SITREP-${args.city.authorityShort}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`;
  header(d, args.city, `Parking situation report · ${args.city.name}`, ref, args.user);
  let y = 112;
  y = section(d, y, "1. Summary");
  const resolved = args.incidents.filter((i) => i.status === "resolved");
  const avgResolve = resolved.length ? Math.round(resolved.reduce((a, i) => a + ((i.resolved?.at ?? i.detectedAt) - i.detectedAt), 0) / resolved.length / 1000) : null;
  autoTable(d, {
    ...tableStyle,
    startY: y,
    head: [["Indicator", "Value"]],
    body: [
      ["City occupancy", `${Math.round(args.totals.occupancy * 100)}%`],
      ["Free bays", `${args.totals.free} of ${args.totals.usable}`],
      ["Lots at ≥95%", String(args.totals.fullLots)],
      ["Camera nodes offline", String(args.totals.staleLots)],
      ["Incidents (this shift)", `${args.incidents.length} raised · ${resolved.length} resolved · ${args.incidents.filter((i) => i.status === "awaiting_approval").length} awaiting approval`],
      ["Mean time to resolve", avgResolve !== null ? `${avgResolve} s (demo clock)` : "—"],
      ["Illegal parking detections", `${args.violations.total} · ${args.violations.actioned} actioned`],
    ],
  });
  y = lastY(d) + 20;
  y = section(d, y, "2. Zones");
  autoTable(d, {
    ...tableStyle,
    startY: y,
    head: [["Zone", "Occupancy", "Free bays", "Lots", "Forecast 60 min"]],
    body: args.zones.map((z) => [z.name, `${Math.round(z.occupancy * 100)}%`, String(z.free), String(z.lots), z.forecast60 !== undefined ? `${Math.round(z.forecast60 * 100)}%` : "—"]),
  });
  y = lastY(d) + 20;
  y = section(d, y, "3. Lots");
  autoTable(d, {
    ...tableStyle,
    startY: y,
    head: [["Lot", "Zone", "Occupancy", "Free", "60 min (80% range)", "Feed"]],
    body: args.lots.map((l) => [l.name, l.zone, `${Math.round(l.occupancy * 100)}%`, String(l.free), l.forecast ?? "—", l.feed]),
  });
  y = lastY(d) + 20;
  y = section(d, y, "4. Incidents");
  autoTable(d, {
    ...tableStyle,
    startY: y,
    head: [["ID", "Title", "Severity", "Status", "Approved by", "Detected"]],
    body: args.incidents.length
      ? args.incidents.map((i) => [i.id, i.title, i.severity, i.status.replace("_", " "), i.approved?.by ?? "—", ist(i.detectedAt)])
      : [["—", "No incidents this shift", "", "", "", ""]],
  });
  y = lastY(d) + 20;
  y = section(d, y, "5. Enforcement");
  autoTable(d, { ...tableStyle, startY: y, head: [["Violation type", "Detections"]], body: args.violations.byType.map(([k, v]) => [k, String(v)]) });
  y = lastY(d) + 20;
  if (args.model) {
    y = section(d, y, "6. Forecast model");
    const m = args.model.metrics;
    autoTable(d, {
      ...tableStyle,
      startY: y,
      head: [["Item", "Value"]],
      body: [
        ["Version", `${args.model.version} (trained ${args.model.trainedAt})`],
        ["Algorithm", args.model.algorithm],
        ["Training data", args.model.training.data],
        ["Hold-out MAE (occupancy pts)", `${m.mae_occupancy_pts.gbm} vs ${m.mae_occupancy_pts.heuristic_v1} (v1 heuristic) vs ${m.mae_occupancy_pts.persistence} (same-as-now)`],
        ["On holidays / rain / festival", `${m.mae_on_holiday_rain_festival_pts.gbm} vs ${m.mae_on_holiday_rain_festival_pts.heuristic_v1} (v1)`],
        ["80% interval coverage", `${Math.round(m.interval_80_coverage * 100)}%`],
        ["Anomaly detector", `recall ${Math.round(m.anomaly_detector.event_recall * 100)}%, ${m.anomaly_detector.false_alerts_per_lot_per_week} false alerts / lot / week`],
      ],
    });
    y = lastY(d) + 20;
  }
  y = section(d, y, "7. Integrity");
  autoTable(d, {
    ...tableStyle,
    startY: y,
    head: [["Audit ledger", "Value"]],
    body: [
      ["Entries", String(args.auditCount)],
      ["Chain head (SHA-256)", args.auditHead?.hash ?? "—"],
      ["Head entry", args.auditHead ? `#${args.auditHead.seq} ${args.auditHead.action} at ${args.auditHead.at}` : "—"],
    ],
    columnStyles: { 1: { font: "courier", fontSize: 7.5 } },
  });
  y = lastY(d) + 40;
  if (y > d.internal.pageSize.getHeight() - 100) {
    d.addPage();
    y = 80;
  }
  d.setFontSize(9);
  d.setTextColor(30, 41, 59);
  d.text("Reviewed by: ______________________________      Signature / date: ____________________", 40, y);
  footer(d, `${ref} · Slotify prototype — all operational data simulated. Verify this report against audit chain head ${args.auditHead?.hash.slice(0, 16) ?? "-"}…`);
  d.save(`${ref}.pdf`);
  return ref;
}
