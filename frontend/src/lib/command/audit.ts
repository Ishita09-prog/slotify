/**
 * Append-only, hash-chained audit ledger.
 * Each entry stores SHA-256(prevHash | canonical payload). Changing, deleting or reordering any
 * entry breaks every hash after it, which `verifyChain` detects. In production the chain head is
 * anchored every few minutes to WORM storage so even an administrator cannot rewrite history.
 */

export interface AuditEntry {
  seq: number;
  at: string; // ISO timestamp (IST offset)
  actor: string; // "R. Meenakshi (Command Officer)" or "system:incident-engine"
  actorId: string;
  role: string;
  action: string; // dotted verb, e.g. "incident.approve"
  entity: string; // "INC-…", "lot:tn-pondy"
  detail: string;
  source: string; // where the action came from (UI, engine, model)
  prevHash: string;
  hash: string;
}

export type AuditInput = Omit<AuditEntry, "seq" | "at" | "prevHash" | "hash"> & { at?: string };

export const GENESIS = "0".repeat(64);

export function istIso(t = Date.now()) {
  const d = new Date(t + 5.5 * 3600_000);
  return d.toISOString().replace("Z", "+05:30");
}

const canonical = (e: Omit<AuditEntry, "hash">) =>
  [e.seq, e.at, e.actorId, e.role, e.action, e.entity, e.detail, e.source, e.prevHash].join("|");

async function sha256Hex(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function seal(prev: AuditEntry | undefined, input: AuditInput): Promise<AuditEntry> {
  const base = {
    ...input,
    seq: (prev?.seq ?? 0) + 1,
    at: input.at ?? istIso(),
    prevHash: prev?.hash ?? GENESIS,
  };
  return { ...base, hash: await sha256Hex(canonical(base)) };
}

export async function verifyChain(entries: AuditEntry[]): Promise<{ ok: boolean; brokenAt?: number; checked: number }> {
  let prev = GENESIS;
  for (const e of entries) {
    if (e.prevHash !== prev) return { ok: false, brokenAt: e.seq, checked: e.seq };
    const h = await sha256Hex(canonical(e));
    if (h !== e.hash) return { ok: false, brokenAt: e.seq, checked: e.seq };
    prev = e.hash;
  }
  return { ok: true, checked: entries.length };
}
