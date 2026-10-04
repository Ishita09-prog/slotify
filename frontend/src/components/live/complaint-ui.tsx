"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Camera, CheckCircle2, ExternalLink, FileText, Film, Loader2, Paperclip, Video, X } from "lucide-react";
import { toast } from "sonner";
import { CCButton, Panel } from "@/components/command/ui";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { complaintAction, findRelatedBookings, type RelatedBooking } from "@/lib/live/complaint-service";
import {
  ACTION_LABEL, allowedActions, CLIP_MIME, EVIDENCE_LIMITS, OWNER_EVIDENCE_LIMITS, STATUS_LABEL, TYPE_LABEL, validateAttachments, validateOwnerEvidence,
  type Actor, type Attachment, type Complaint, type ComplaintAction, type ComplaintStatus,
} from "@/lib/live/complaints";
import { useLive } from "@/lib/live/provider";
import { fmtDateTime, fmtTime } from "@/lib/live/time";
import { cn, formatINR } from "@/lib/utils";

/* Shared pieces for the FASTag fraud-complaint workflow (driver, operator and Command Centre screens). */

export type Variant = "app" | "cc";

const V = {
  app: {
    dim: "text-muted-foreground",
    line: "border-border",
    field: "w-full rounded-lg border border-input bg-background/60 px-3 py-2 text-sm placeholder:text-muted-foreground",
    soft: "bg-secondary/40",
  },
  cc: {
    dim: "text-[hsl(var(--cc-dim))]",
    line: "border-[hsl(var(--cc-line))]",
    field: "w-full rounded border border-[hsl(var(--cc-line))] bg-[hsl(222_40%_8%)] px-2 py-1.5 text-sm text-slate-100 placeholder:text-[hsl(var(--cc-dim))]",
    soft: "bg-white/[0.03]",
  },
} as const;

export const STATUS_TONE: Record<ComplaintStatus, string> = {
  submitted: "bg-status-reserved/15 text-status-reserved",
  under_owner_review: "bg-status-reserved/15 text-status-reserved",
  forwarded: "bg-primary/15 text-primary",
  investigating: "bg-primary/15 text-primary",
  resolved: "bg-status-available/15 text-status-available",
  rejected: "bg-status-occupied/15 text-status-occupied",
};

export function StatusBadge({ s }: { s: ComplaintStatus }) {
  return <span className={cn("inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold", STATUS_TONE[s])}>{STATUS_LABEL[s]}</span>;
}

/* ------------------------------ data hooks ------------------------------ */

export function useComplaints(filter: [string, unknown] | null) {
  const live = useLive();
  const [list, setList] = useState<Complaint[] | null>(null);
  const key = filter ? `${filter[0]}:${String(filter[1])}` : "all";
  useEffect(() => {
    if (!live.store) return;
    return live.store.watch<Complaint>("complaints", filter, (l) => setList([...l].sort((a, b) => b.createdAt - a.createdAt)));
  }, [live.store, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return list;
}

/** undefined = loading, null = not found */
export function useComplaint(id: string) {
  const live = useLive();
  const [c, setC] = useState<Complaint | null | undefined>(undefined);
  useEffect(() => {
    if (!live.store || !id) return;
    return live.store.watchDoc<Complaint>("complaints", id, setC);
  }, [live.store, id]);
  return c;
}

/* ------------------------------- evidence ------------------------------- */

const readDataUrl = (f: Blob) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(new Error("Couldn't read the file."));
    r.readAsDataURL(f);
  });

/** Images are shrunk in the browser (max 1280 px JPEG) so evidence fits in the database document. PDFs are kept as-is under a size cap. */
export async function readEvidence(file: File): Promise<Attachment> {
  if (file.type === "application/pdf") {
    if (file.size > EVIDENCE_LIMITS.maxPdfBytes) throw new Error(`${file.name}: PDFs must be under ${Math.round(EVIDENCE_LIMITS.maxPdfBytes / 1000)} KB.`);
    return { name: file.name, mime: file.type, size: file.size, dataUrl: await readDataUrl(file) };
  }
  if (!file.type.startsWith("image/")) throw new Error(`${file.name}: only images and PDFs are allowed.`);
  const bmp = await createImageBitmap(file);
  const shrink = (max: number, q: number) => {
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(bmp.width * k));
    cv.height = Math.max(1, Math.round(bmp.height * k));
    cv.getContext("2d")!.drawImage(bmp, 0, 0, cv.width, cv.height);
    return cv.toDataURL("image/jpeg", q);
  };
  let url = shrink(1280, 0.72);
  if (url.length > 220_000) url = shrink(960, 0.55);
  return { name: file.name.replace(/\.[^.]+$/, "") + ".jpg", mime: "image/jpeg", size: Math.round(url.length * 0.75), dataUrl: url };
}

export async function openAttachment(a: Attachment) {
  if (a.clip) return void window.open(a.clip.src, "_blank", "noopener");
  const blob = await (await fetch(a.dataUrl)).blob();
  window.open(URL.createObjectURL(blob), "_blank", "noopener");
}

/** File picker + chips. Parent owns the list. */
export function EvidencePicker({ value, onChange, variant = "app", owner = false }: { value: Attachment[]; onChange: (a: Attachment[]) => void; variant?: Variant; owner?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      const read: Attachment[] = [];
      for (const f of Array.from(files)) read.push(await readEvidence(f));
      onChange(owner ? validateOwnerEvidence(value, read) : validateAttachments(value, read));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = "";
    }
  };
  return (
    <div className="space-y-2">
      <input ref={ref} type="file" multiple accept="image/*,application/pdf" aria-label="Evidence upload" className="sr-only" onChange={(e) => void add(e.target.files)} />
      <button type="button" onClick={() => ref.current?.click()} disabled={busy} className={cn("flex w-full items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-4 text-sm font-medium", V[variant].line, V[variant].dim, "hover:text-foreground")}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />} {owner ? "Upload screenshot or file" : "Add photo or PDF"}
      </button>
      {!owner && <p className={cn("text-[11px]", V[variant].dim)}>Images and PDFs only · up to {EVIDENCE_LIMITS.maxFiles} files · PDFs under {Math.round(EVIDENCE_LIMITS.maxPdfBytes / 1000)} KB (photos are shrunk automatically)</p>}
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {value.map((a, i) => (
            <li key={i} className={cn("flex items-center gap-2 rounded-lg border px-2 py-1 text-xs", V[variant].line)}>
              {a.clip ? <Film className="size-3.5" /> : <FileText className="size-3.5" />} <span className="max-w-48 truncate">{a.name}</span>
              <button type="button" aria-label={`Remove ${a.name}`} onClick={() => onChange(value.filter((_, j) => j !== i))}><X className="size-3.5" /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function EvidenceList({ list, variant }: { list: Attachment[]; variant: Variant }) {
  if (!list.length) return <p className={cn("text-sm", V[variant].dim)}>No evidence uploaded.</p>;
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {list.map((a, i) => a.clip ? (
        <li key={i} className="col-span-2 sm:col-span-3"><ClipView a={a} variant={variant} /></li>
      ) : (
        <li key={i}>
          <button type="button" onClick={() => void openAttachment(a)} className={cn("group flex w-full flex-col overflow-hidden rounded-lg border text-left", V[variant].line)}>
            {a.mime.startsWith("image/") ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={a.dataUrl} alt={a.name} className="h-24 w-full object-cover" />
            ) : (
              <span className={cn("grid h-24 place-items-center", V[variant].soft)}><FileText className="size-8" /></span>
            )}
            <span className="flex items-center justify-between gap-1 px-2 py-1 text-[11px]"><span className="truncate">{a.name}{a.capturedAt ? ` · ${fmtTime(a.capturedAt)}` : ""}</span><ExternalLink className="size-3 shrink-0 opacity-60" /></span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/* --------------------------- operator CCTV evidence --------------------------- */

/** The operator's recorded bay camera (demo NVR clip). Real deployment: the NVR's playback API for that camera and time. */
const NVR = { src: "/feeds/lot-bays.mp4", camera: "CAM-01 · Bay camera" };

/** Grabs the CCTV frame at camera time `at` and stamps it with camera, time and lot, like an NVR export. */
export async function captureStill(at: number, lot: string): Promise<Attachment> {
  const v = document.createElement("video");
  v.muted = true;
  v.preload = "auto";
  v.playsInline = true;
  v.src = v.canPlayType("video/webm") ? NVR.src.replace(/\.mp4$/, ".webm") : NVR.src;
  await new Promise<void>((res, rej) => {
    const to = window.setTimeout(() => rej(new Error("Camera recording didn't load. Try again.")), 15000);
    v.onloadeddata = () => { window.clearTimeout(to); res(); };
    v.onerror = () => { window.clearTimeout(to); rej(new Error("Camera recording unavailable.")); };
  });
  v.currentTime = (at / 1000) % Math.max(1, v.duration - 0.2);
  await new Promise<void>((res) => { v.onseeked = () => res(); window.setTimeout(res, 4000); });
  const W = 960, H = Math.round((W * v.videoHeight) / Math.max(1, v.videoWidth));
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext("2d")!;
  ctx.drawImage(v, 0, 0, W, H);
  ctx.fillStyle = "rgba(0,0,0,0.65)";
  ctx.fillRect(0, 0, W, 30);
  ctx.fillRect(0, H - 26, W, 26);
  ctx.font = "700 15px ui-monospace, monospace";
  ctx.fillStyle = "#fff";
  ctx.fillText(`● ${NVR.camera}`, 10, 20);
  const ts = `${fmtDateTime(at)} IST`;
  ctx.fillText(ts, W - ctx.measureText(ts).width - 10, 20);
  ctx.font = "600 12px ui-monospace, monospace";
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.fillText(`${lot} · operator NVR export · Slotify`, 10, H - 9);
  const dataUrl = cv.toDataURL("image/jpeg", 0.6);
  return { name: `CCTV still ${fmtTime(at).replace(/\s/g, "")}.jpg`, mime: "image/jpeg", size: Math.round(dataUrl.length * 0.75), dataUrl, capturedAt: at };
}

/** Recording shared by reference: the video stays on the operator's NVR; the case stores which camera and time range. */
export function clipEvidence(at: number, minutes: number): Attachment {
  const from = at - minutes * 60_000, to = at + minutes * 60_000;
  return { name: `${NVR.camera} recording ${fmtTime(from)}–${fmtTime(to)}`, mime: CLIP_MIME, size: 0, dataUrl: "", capturedAt: at, clip: { src: NVR.src, from, to, camera: NVR.camera } };
}

function ClipView({ a, variant }: { a: Attachment; variant: Variant }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [t, setT] = useState(a.clip!.from);
  const onTime = () => {
    const v = ref.current;
    if (v?.duration) setT(a.clip!.from + (v.currentTime / v.duration) * (a.clip!.to - a.clip!.from));
  };
  return (
    <div className={cn("overflow-hidden rounded-lg border", V[variant].line)}>
      <div className="relative bg-black">
        <video ref={ref} controls muted playsInline onTimeUpdate={onTime} className="max-h-72 w-full">
          <source src={a.clip!.src.replace(/\.mp4$/, ".webm")} type="video/webm" />
          <source src={a.clip!.src} type="video/mp4" />
        </video>
        <span className="pointer-events-none absolute left-2 top-2 rounded bg-black/70 px-2 py-0.5 font-mono text-[11px] text-white">● {a.clip!.camera} · {fmtDateTime(t)}</span>
      </div>
      <p className="flex items-center gap-1.5 px-2 py-1.5 text-[11px]"><Video className="size-3.5" /> {a.name} · shared from the operator&apos;s NVR</p>
    </div>
  );
}

const OFFSETS = [-5, -2, 0, 2, 5];

/** Operator adds CCTV stills / screenshots (optional) and answers a Command Centre request for the full recording. */
export function OwnerEvidencePanel({ c, actor }: { c: Complaint; actor: Actor }) {
  const live = useLive();
  const allowed = allowedActions(c, actor);
  const [staged, setStaged] = useState<Attachment[]>([]);
  const [offset, setOffset] = useState(0);
  const [mins, setMins] = useState(5);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  if (!allowed.includes("owner_add_evidence") && !allowed.includes("owner_share_footage")) return null;
  const ref = c.txnAt ?? c.incidentAt;
  const have = c.ownerEvidence ?? [];

  const grab = async () => {
    setBusy("grab");
    try {
      const s = await captureStill(ref + offset * 60_000, c.parkingLocation);
      setStaged(validateOwnerEvidence([...have, ...staged], [s]).slice(have.length));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const send = async (action: "owner_add_evidence" | "owner_share_footage", items: Attachment[]) => {
    if (!live.store) return;
    setBusy(action);
    try {
      await complaintAction(live.store, c.id, actor, action, { attachments: items, note });
      toast.success(action === "owner_share_footage" ? "Recording shared with the Command Centre" : "Evidence added to the case");
      setStaged([]);
      setNote("");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const forwarded = c.status !== "submitted" && c.status !== "under_owner_review";

  return (
    <Card className="space-y-4 p-4">
      {allowed.includes("owner_share_footage") && c.footageRequest && (
        <div className="space-y-3 rounded-xl border border-status-reserved/50 bg-status-reserved/10 p-3">
          <p className="flex items-start gap-2 text-sm"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-status-reserved" /><span><b>Command Centre ({c.footageRequest.by}) asked for the full recording:</b> {c.footageRequest.note}</span></p>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Share {NVR.camera}</span>
            {[5, 10, 15].map((m) => (
              <button key={m} onClick={() => setMins(m)} className={cn("rounded-full border px-3 py-1 text-xs font-semibold", mins === m ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground")}>±{m} min</button>
            ))}
            <span className="text-xs text-muted-foreground">{fmtTime(ref - mins * 60_000)} – {fmtTime(ref + mins * 60_000)}</span>
          </div>
          <Button disabled={!!busy} onClick={() => void send("owner_share_footage", [clipEvidence(ref, mins)])}>{busy === "owner_share_footage" ? <Loader2 className="animate-spin" /> : <Film />} Share recording</Button>
        </div>
      )}

      {allowed.includes("owner_add_evidence") && (
        <div className="space-y-3">
          <div>
            <h2 className="font-display text-base font-bold">Your evidence <span className="text-xs font-medium text-muted-foreground">(optional)</span></h2>
            <p className="text-xs text-muted-foreground">Charge time {fmtDateTime(ref)}. Grab the CCTV frame from that moment or upload a screenshot. {forwarded ? "It's added to the case the Command Centre is investigating." : "Add it before forwarding so the Command Centre sees it straight away."}</p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {OFFSETS.map((o) => (
              <button key={o} onClick={() => setOffset(o)} className={cn("rounded-full border px-2.5 py-1 text-xs font-semibold tabular-nums", offset === o ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground")}>{o === 0 ? "At charge time" : `${o > 0 ? "+" : "−"}${Math.abs(o)} min`}</button>
            ))}
          </div>
          <Button variant="outline" disabled={!!busy} onClick={() => void grab()}>{busy === "grab" ? <Loader2 className="animate-spin" /> : <Camera />} Capture CCTV still at {fmtTime(ref + offset * 60_000)}</Button>
          {staged.some((a) => a.mime.startsWith("image/")) && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {staged.filter((a) => a.mime.startsWith("image/")).map((a, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={a.dataUrl} alt={a.name} className="w-full rounded-lg border" />
              ))}
            </div>
          )}
          <EvidencePicker value={staged} onChange={setStaged} owner />
          <textarea aria-label="Evidence note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note for the Command Centre, e.g. 'Gate camera shows a white hatchback, not the driver's SUV'" className={V.app.field} />
          <p className="text-[11px] text-muted-foreground">Up to {OWNER_EVIDENCE_LIMITS.maxFiles} items. Full recordings stay on your NVR until the Command Centre asks for them.</p>
          <Button disabled={!!busy || !staged.length} onClick={() => void send("owner_add_evidence", staged)}>{busy === "owner_add_evidence" && <Loader2 className="animate-spin" />} Add {staged.length || ""} to case</Button>
        </div>
      )}
    </Card>
  );
}

/* ----------------------------- detail screen ---------------------------- */

function Box({ variant, title, children }: { variant: Variant; title: string; children: React.ReactNode }) {
  return variant === "cc" ? (
    <Panel title={title}>{children}</Panel>
  ) : (
    <Card className="p-4">
      <h2 className="mb-3 font-display text-base font-bold">{title}</h2>
      {children}
    </Card>
  );
}

function Fact({ l, v, variant }: { l: string; v: React.ReactNode; variant: Variant }) {
  return (
    <div className="min-w-0">
      <p className={cn("text-[11px] uppercase tracking-wide", V[variant].dim)}>{l}</p>
      <p className="mt-0.5 break-words text-sm font-semibold">{v}</p>
    </div>
  );
}

export function ComplaintDetail({ c, viewer, variant = "app" }: { c: Complaint; viewer: "driver" | "owner" | "command"; variant?: Variant }) {
  const live = useLive();
  const [related, setRelated] = useState<RelatedBooking[] | null>(null);
  useEffect(() => {
    if (viewer === "driver" || !live.store) return;
    void findRelatedBookings(live.store, c).then(setRelated);
  }, [live.store, viewer, c.id, c.vehicleNumber, c.lotId]); // eslint-disable-line react-hooks/exhaustive-deps
  const dim = V[variant].dim;

  return (
    <div className="space-y-4">
      <Box variant={variant} title="Complaint">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-bold">{c.complaintId}</span>
          <StatusBadge s={c.status} />
          <span className={cn("text-xs", dim)}>{TYPE_LABEL[c.complaintType]}</span>
        </div>
        {c.awaitingInfo && (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-status-reserved/50 bg-status-reserved/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-status-reserved" />
            <p><b>{c.awaitingInfo.by === "owner" ? "The parking operator" : "The Command Centre"} asked for more information:</b> {c.awaitingInfo.note}</p>
          </div>
        )}
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-3">
          <Fact variant={variant} l="Vehicle number" v={<span className="font-display tracking-wider">{c.vehicleNumber}</span>} />
          <Fact variant={variant} l="Transaction ID" v={<span className="font-mono text-xs">{c.transactionId}</span>} />
          <Fact variant={variant} l="Parking location" v={c.parkingLocation} />
          <Fact variant={variant} l="Date & time of incident" v={fmtDateTime(c.incidentAt)} />
          <Fact variant={variant} l="Filed on" v={fmtDateTime(c.createdAt)} />
          {viewer !== "driver" && <Fact variant={variant} l="Complainant" v={c.userName} />}
        </div>
        <p className={cn("mt-4 text-[11px] uppercase tracking-wide", dim)}>Description</p>
        <p className="mt-1 whitespace-pre-wrap text-sm">{c.description}</p>
      </Box>

      <Box variant={variant} title={viewer === "driver" ? "Evidence" : "Driver's evidence"}>
        <EvidenceList list={c.attachments} variant={variant} />
      </Box>

      {viewer !== "driver" && (
        <Box variant={variant} title="Parking operator's evidence">
          {c.footageRequest && (
            <p className={cn("mb-3 flex items-start gap-2 rounded-lg border p-2.5 text-sm", c.footageRequest.status === "pending" ? "border-status-reserved/50 bg-status-reserved/10" : "border-status-available/40 bg-status-available/10")}>
              <Film className="mt-0.5 size-4 shrink-0" />
              <span>{c.footageRequest.status === "pending" ? <><b>Full recording requested</b> from the operator by {c.footageRequest.by} · {fmtDateTime(c.footageRequest.at)}: {c.footageRequest.note}</> : <><b>Recording shared</b> by the operator · {fmtDateTime(c.footageRequest.sharedAt ?? c.updatedAt)}</>}</span>
            </p>
          )}
          {(c.ownerEvidence ?? []).length ? <EvidenceList list={c.ownerEvidence!} variant={variant} /> : <p className={cn("text-sm", dim)}>{viewer === "owner" ? "You haven't added any. Optional: CCTV stills or screenshots help the Command Centre decide faster." : "The operator didn't attach any. Use “Request Full CCTV Recording” if you need it."}</p>}
        </Box>
      )}

      {viewer !== "driver" && (
        <Box variant={variant} title="Investigation">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4">
            <Fact variant={variant} l="Disputed charge" v={c.txnAmount != null ? formatINR(c.txnAmount) : "Not found"} />
            <Fact variant={variant} l="Charged at" v={c.txnAt ? fmtDateTime(c.txnAt) : "—"} />
            <Fact variant={variant} l="Matched to FASTag history" v={c.txnVerified ? <span className="text-status-available">Yes</span> : <span className="text-status-reserved">No: verify manually</span>} />
            <Fact variant={variant} l="Charge description" v={c.txnDesc ?? "—"} />
          </div>
          <p className={cn("mb-2 mt-4 text-[11px] uppercase tracking-wide", dim)}>Entry / exit records for this plate at this lot</p>
          {related === null ? (
            <p className={cn("text-sm", dim)}>Looking up gate records…</p>
          ) : related.length === 0 ? (
            <div className="flex items-start gap-2 rounded-lg border border-status-reserved/50 bg-status-reserved/10 p-3 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-status-reserved" />
              <p><b>No booking or gate entry exists for {c.vehicleNumber} at this lot.</b> The charge has no matching visit on record, which supports the complaint.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead className={cn("border-b text-left text-xs", V[variant].line, dim)}>
                  <tr>{["Booking", "Bay", "Booked by", "Entry", "Exit", "Status"].map((h) => <th key={h} className="py-2 pr-3 font-medium">{h}</th>)}</tr>
                </thead>
                <tbody className={cn("divide-y", V[variant].line)}>
                  {related.map(({ booking: b, otherAccount, minutesFromCharge }) => (
                    <tr key={b.id}>
                      <td className="py-2 pr-3 font-mono text-xs">{b.id}{minutesFromCharge != null && <span className={cn("block font-sans", dim)}>{minutesFromCharge < 1440 ? `${minutesFromCharge} min from the charge` : `${Math.round(minutesFromCharge / 1440)} d from the charge`}</span>}</td>
                      <td className="py-2 pr-3 font-semibold">{b.bayLabel}</td>
                      <td className="py-2 pr-3">{b.driverName}{otherAccount && <span className="ml-1 rounded bg-status-occupied/15 px-1 text-[10px] font-semibold text-status-occupied">different account</span>}</td>
                      <td className="py-2 pr-3 text-xs">{b.parkedAt ? fmtDateTime(b.parkedAt) : "—"}</td>
                      <td className="py-2 pr-3 text-xs">{b.exitAt ? fmtDateTime(b.exitAt) : "—"}</td>
                      <td className="py-2 pr-3 capitalize">{b.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Box>
      )}

      {(c.ownerRemarks || c.commandCentreRemarks || c.refund) && (
        <Box variant={variant} title={viewer === "command" ? "Remarks & investigation notes" : "Remarks"}>
          <div className="space-y-3 text-sm">
            {c.ownerRemarks && <div><p className={cn("text-[11px] uppercase tracking-wide", dim)}>Parking operator</p><p className="whitespace-pre-wrap">{c.ownerRemarks}</p></div>}
            {c.commandCentreRemarks && <div><p className={cn("text-[11px] uppercase tracking-wide", dim)}>Command Centre</p><p className="whitespace-pre-wrap">{c.commandCentreRemarks}</p></div>}
            {c.refund && <p className="flex items-center gap-1.5 font-semibold text-status-available"><CheckCircle2 className="size-4" /> {formatINR(c.refund.amount)} refunded to the driver&apos;s FASTag wallet</p>}
          </div>
        </Box>
      )}

      <Box variant={variant} title="Complaint history">
        <ol className={cn("relative ml-2 space-y-4 border-l pl-5", V[variant].line)}>
          {c.auditLog.map((e, i) => (
            <li key={i} className="relative">
              <span className={cn("absolute -left-[27px] top-1 size-3 rounded-full ring-4", i === c.auditLog.length - 1 ? "bg-primary ring-primary/20" : "bg-muted-foreground/60 ring-transparent")} />
              <p className="text-sm font-semibold">{e.action}</p>
              <p className={cn("text-xs", dim)}>{e.actorName} · {e.actorRole === "driver" ? "Driver" : e.actorRole === "owner" ? "Parking operator" : e.actorRole === "command" ? "Command Centre" : "System"} · {fmtDateTime(e.at)}</p>
              {e.note && <p className="mt-1 text-sm">{e.note}</p>}
            </li>
          ))}
        </ol>
        <p className={cn("mt-3 text-[11px]", dim)}>History is permanent: entries can be added but never edited or deleted.</p>
      </Box>
    </div>
  );
}

/* ------------------------------- actions -------------------------------- */

const DANGER: ComplaintAction[] = ["owner_reject", "command_reject"];
const NEEDS_NOTE: ComplaintAction[] = ["owner_reject", "owner_request_info", "command_reject", "command_request_evidence", "command_request_footage"];
const NOTE_HINT: Partial<Record<ComplaintAction, string>> = {
  owner_reject: "Reason for rejecting (required)",
  owner_request_info: "What do you need from the driver? (required)",
  command_reject: "Reason for rejecting (required)",
  command_request_evidence: "What evidence is needed? (required)",
  command_request_footage: "Which camera / time range do you need from the operator? (required)",
};

/** Decision bar. Only buttons the actor may use right now are shown; the same rules are enforced again on save. */
export function ComplaintActions({
  c, actor, variant = "app", onDone,
}: {
  c: Complaint;
  actor: Actor;
  variant?: Variant;
  onDone?: (action: ComplaintAction, next: Complaint, note: string) => void;
}) {
  const live = useLive();
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState<string>(c.txnAmount != null ? String(c.txnAmount) : "");
  const [busy, setBusy] = useState<ComplaintAction | null>(null);
  const actions = allowedActions(c, actor).filter((a) => a !== "owner_review" && a !== "owner_add_evidence" && a !== "owner_share_footage");
  if (!actions.length) return null;
  const Btn = variant === "cc" ? CCButton : Button;

  const run = async (a: ComplaintAction) => {
    if (!live.store) return;
    setBusy(a);
    try {
      const next = await complaintAction(live.store, c.id, actor, a, { note, amount: a === "approve_refund" ? Number(amount) : undefined });
      toast.success(a === "approve_refund" ? `${formatINR(next.refund?.amount ?? 0)} refunded to the driver's FASTag wallet` : `${ACTION_LABEL[a]}: done`);
      onDone?.(a, next, note);
      setNote("");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const wantNote = actions.some((a) => NEEDS_NOTE.includes(a)) || actions.includes("close") || actions.includes("forward");
  return (
    <Box variant={variant} title="Decision">
      {wantNote && (
        <textarea aria-label="Note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note. Required to reject or to ask for information; optional otherwise." className={cn(V[variant].field, "mb-3")} />
      )}
      {actions.includes("approve_refund") && (
        <div className="mb-3 flex items-center gap-2 text-sm">
          <label htmlFor="refund-amt" className={V[variant].dim}>Refund ₹</label>
          <input id="refund-amt" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} className={cn(V[variant].field, "w-28")} />
          <span className={cn("text-xs", V[variant].dim)}>{c.txnAmount != null ? `disputed charge ${formatINR(c.txnAmount)}` : "charge not found in driver's history: enter the amount you verified"}</span>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => {
          const disabled = !!busy || (NEEDS_NOTE.includes(a) && note.trim().length < 3);
          const props = variant === "cc" ? { variant: DANGER.includes(a) ? ("danger" as const) : a === "accept" || a === "approve_refund" ? ("primary" as const) : ("default" as const) } : { variant: DANGER.includes(a) ? ("destructive" as const) : a === "forward" || a === "accept" || a === "approve_refund" ? ("default" as const) : ("outline" as const) };
          return (
            <Btn key={a} {...(props as object)} disabled={disabled} onClick={() => void run(a)} title={NEEDS_NOTE.includes(a) ? NOTE_HINT[a] : undefined}>
              {busy === a && <Loader2 className="size-4 animate-spin" />} {ACTION_LABEL[a]}
            </Btn>
          );
        })}
      </div>
    </Box>
  );
}

/** Driver answers a "more information" request. */
export function ReplyForm({ c, actor }: { c: Complaint; actor: Actor }) {
  const live = useLive();
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  if (!allowedActions(c, actor).includes("user_reply")) return null;
  const send = async () => {
    if (!live.store) return;
    setBusy(true);
    try {
      await complaintAction(live.store, c.id, actor, "user_reply", { note, attachments: files });
      toast.success("Sent. The reviewer has been notified.");
      setNote("");
      setFiles([]);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="space-y-3 border-status-reserved/50 p-4">
      <h2 className="font-display text-base font-bold">Send the information requested</h2>
      <textarea aria-label="Your reply" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Write your reply" className={V.app.field} />
      <EvidencePicker value={files} onChange={setFiles} />
      <Button disabled={busy || (note.trim().length < 3 && !files.length)} onClick={() => void send()}>{busy && <Loader2 className="animate-spin" />} Send information</Button>
    </Card>
  );
}
