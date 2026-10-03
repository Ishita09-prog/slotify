/* ------------------------------------------------------------------ */
/* FASTag fraud complaints: driver -> parking owner -> Command Centre.  */
/* Pure state machine (no React, no database) so every rule is testable */
/* The audit log is append-only: nothing here edits or removes entries. */
/* ------------------------------------------------------------------ */

export type ComplaintStatus = "submitted" | "under_owner_review" | "forwarded" | "investigating" | "resolved" | "rejected";
export type ComplaintType = "unauthorized_deduction" | "plate_cloning" | "incorrect_detection" | "billing_error";
export type ActorRole = "driver" | "owner" | "command" | "system";

export const STATUS_LABEL: Record<ComplaintStatus, string> = {
  submitted: "Submitted",
  under_owner_review: "Under Owner Review",
  forwarded: "Forwarded To Command Centre",
  investigating: "Investigation In Progress",
  resolved: "Resolved",
  rejected: "Rejected",
};
export const TYPE_LABEL: Record<ComplaintType, string> = {
  unauthorized_deduction: "Unauthorized FASTag Deduction",
  plate_cloning: "Number Plate Cloning",
  incorrect_detection: "Incorrect Vehicle Detection",
  billing_error: "Billing Error",
};
export const COMPLAINT_TYPES = Object.keys(TYPE_LABEL) as ComplaintType[];
export const isOpen = (s: ComplaintStatus) => s !== "resolved" && s !== "rejected";

/** GCC-run public lots have no private operator account to review a complaint. */
export const PUBLIC_OWNER_UID = "gcc-public";

export interface Attachment {
  name: string;
  mime: string;
  size: number;
  /** data: URL. Kept small (see EVIDENCE_LIMITS) so the document fits Firestore's 1 MiB cap. */
  dataUrl: string;
}

export interface AuditEntry {
  at: number;
  actorId: string;
  actorName: string;
  actorRole: ActorRole;
  action: string;
  note?: string;
  from?: ComplaintStatus | null;
  to?: ComplaintStatus | null;
}

export interface Complaint {
  /** same value as complaintId */
  id: string;
  complaintId: string;
  userId: string;
  userName: string;
  /** the lot operator who reviews first; "gcc-public" = straight to Command Centre */
  ownerUid: string;
  lotId: string;
  transactionId: string;
  vehicleNumber: string;
  parkingLocation: string;
  /** when the driver says the deduction happened */
  incidentAt: number;
  complaintType: ComplaintType;
  description: string;
  attachments: Attachment[];
  status: ComplaintStatus;
  ownerRemarks: string;
  commandCentreRemarks: string;
  createdAt: number;
  updatedAt: number;
  auditLog: AuditEntry[];
  /** snapshot of the driver's FASTag debit, if the transaction ID matched their history */
  txnVerified: boolean;
  txnAmount: number | null;
  txnAt: number | null;
  txnDesc: string | null;
  /** someone asked the driver for more information and is waiting */
  awaitingInfo: { by: "owner" | "command"; note: string; at: number } | null;
  refund: { amount: number; approvedBy: string; at: number } | null;
  resolution: "refunded" | "no_refund" | "rejected" | null;
}

export interface Actor {
  id: string;
  name: string;
  role: "driver" | "owner" | "command";
}

export type ComplaintAction =
  | "owner_review" | "forward" | "owner_reject" | "owner_request_info"
  | "user_reply"
  | "accept" | "approve_refund" | "command_reject" | "command_request_evidence" | "close";

export const ACTION_LABEL: Record<ComplaintAction, string> = {
  owner_review: "View Complaint",
  forward: "Forward To Command Centre",
  owner_reject: "Reject Complaint",
  owner_request_info: "Request More Information",
  user_reply: "Send Information",
  accept: "Accept Investigation",
  approve_refund: "Approve Refund",
  command_reject: "Reject Complaint",
  command_request_evidence: "Request Additional Evidence",
  close: "Close Case",
};

export const EVIDENCE_LIMITS = { maxFiles: 4, maxTotalChars: 700_000, maxPdfBytes: 400_000 };

export class ComplaintError extends Error {}

export function validateAttachments(existing: Attachment[], added: Attachment[]): Attachment[] {
  const all = [...existing, ...added];
  if (all.length > EVIDENCE_LIMITS.maxFiles) throw new ComplaintError(`At most ${EVIDENCE_LIMITS.maxFiles} evidence files per complaint.`);
  for (const a of added) {
    const okImage = /^image\//.test(a.mime);
    const okPdf = a.mime === "application/pdf";
    if (!okImage && !okPdf) throw new ComplaintError(`${a.name}: only images and PDFs are allowed.`);
    if (okPdf && a.size > EVIDENCE_LIMITS.maxPdfBytes) throw new ComplaintError(`${a.name}: PDFs must be under ${Math.round(EVIDENCE_LIMITS.maxPdfBytes / 1000)} KB.`);
  }
  if (all.reduce((n, a) => n + a.dataUrl.length, 0) > EVIDENCE_LIMITS.maxTotalChars) throw new ComplaintError("Evidence is too large in total. Use smaller files.");
  return all;
}

export interface NewComplaintInput {
  id: string;
  driver: Actor;
  ownerUid: string;
  lotId: string;
  transactionId: string;
  vehicleNumber: string;
  parkingLocation: string;
  incidentAt: number;
  complaintType: ComplaintType;
  description: string;
  attachments: Attachment[];
  txn: { amount: number; at: number; desc: string } | null;
}

export function newComplaint(i: NewComplaintInput, now: number): Complaint {
  if (!i.transactionId.trim()) throw new ComplaintError("Enter the transaction ID.");
  if (!i.vehicleNumber.trim()) throw new ComplaintError("Choose the vehicle.");
  if (!i.lotId) throw new ComplaintError("Choose the parking location.");
  if (!COMPLAINT_TYPES.includes(i.complaintType)) throw new ComplaintError("Choose a complaint type.");
  if (i.description.trim().length < 10) throw new ComplaintError("Describe what happened (at least 10 characters).");
  if (!Number.isFinite(i.incidentAt) || i.incidentAt > now + 60_000) throw new ComplaintError("Date and time can't be in the future.");
  const attachments = validateAttachments([], i.attachments);
  const direct = i.ownerUid === PUBLIC_OWNER_UID;
  const status: ComplaintStatus = direct ? "forwarded" : "submitted";
  const me = { actorId: i.driver.id, actorName: i.driver.name, actorRole: "driver" as const };
  const auditLog: AuditEntry[] = [{ at: now, ...me, action: "Complaint Created", note: TYPE_LABEL[i.complaintType], from: null, to: "submitted" }];
  if (direct) auditLog.push({ at: now, actorId: "system", actorName: "Slotify", actorRole: "system", action: "Forwarded To Command Centre", note: "Public (GCC-run) lot has no private operator, so it goes straight to the Command Centre.", from: "submitted", to: "forwarded" });
  return {
    id: i.id, complaintId: i.id, userId: i.driver.id, userName: i.driver.name, ownerUid: i.ownerUid, lotId: i.lotId,
    transactionId: i.transactionId.trim(), vehicleNumber: i.vehicleNumber, parkingLocation: i.parkingLocation, incidentAt: i.incidentAt,
    complaintType: i.complaintType, description: i.description.trim(), attachments, status,
    ownerRemarks: "", commandCentreRemarks: "", createdAt: now, updatedAt: now, auditLog,
    txnVerified: !!i.txn, txnAmount: i.txn?.amount ?? null, txnAt: i.txn?.at ?? null, txnDesc: i.txn?.desc ?? null,
    awaitingInfo: null, refund: null, resolution: null,
  };
}

/** Which actions this person can take on this complaint right now (drives the buttons; applyAction enforces it). */
export function allowedActions(c: Complaint, a: Actor): ComplaintAction[] {
  if (!isOpen(c.status)) return [];
  if (a.role === "owner") {
    if (c.ownerUid !== a.id) return [];
    if (c.status === "submitted" || c.status === "under_owner_review") {
      const out: ComplaintAction[] = ["forward", "owner_reject"];
      if (!c.awaitingInfo) out.push("owner_request_info");
      return out;
    }
    return [];
  }
  if (a.role === "driver") return c.userId === a.id && c.awaitingInfo ? ["user_reply"] : [];
  // command centre
  if (c.status === "forwarded") return ["accept", "command_reject"];
  if (c.status === "investigating") {
    const out: ComplaintAction[] = ["command_reject"];
    if (!c.awaitingInfo) {
      if (!c.refund) out.unshift("approve_refund");
      out.push("command_request_evidence", "close");
    }
    // a refund already paid can't be "rejected" afterwards: close the case instead
    return c.refund ? out.filter((x) => x !== "command_reject") : out;
  }
  return [];
}

export interface ActionPayload {
  note?: string;
  amount?: number;
  attachments?: Attachment[];
}

const NEED_NOTE: ComplaintAction[] = ["owner_reject", "owner_request_info", "command_reject", "command_request_evidence"];

/** Returns the next version of the complaint. Throws ComplaintError if the actor isn't allowed. Never mutates `c`. */
export function applyAction(c: Complaint, action: ComplaintAction, a: Actor, p: ActionPayload, now: number): Complaint {
  if (action === "owner_review") {
    // opening a new complaint is itself a recorded step; harmless no-op afterwards
    if (a.role !== "owner" || c.ownerUid !== a.id) throw new ComplaintError("Only the lot operator can review this complaint.");
    if (c.status !== "submitted") return c;
  } else if (!allowedActions(c, a).includes(action)) {
    throw new ComplaintError(!isOpen(c.status) ? "This case is already closed." : "That action isn't available for this complaint right now.");
  }
  const note = (p.note ?? "").trim();
  if (NEED_NOTE.includes(action) && note.length < 3) throw new ComplaintError("Add a short note explaining your decision.");
  const role: ActorRole = a.role;
  const entry = (action_: string, to: ComplaintStatus, n?: string): AuditEntry => ({ at: now, actorId: a.id, actorName: a.name, actorRole: role, action: action_, note: n || undefined, from: c.status, to });
  const next = (to: ComplaintStatus, e: AuditEntry, patch: Partial<Complaint> = {}): Complaint => ({ ...c, ...patch, status: to, updatedAt: now, auditLog: [...c.auditLog, e] });

  switch (action) {
    case "owner_review":
      return next("under_owner_review", entry("Owner Reviewed", "under_owner_review"));
    case "forward":
      return next("forwarded", entry("Forwarded To Command Centre", "forwarded", note), { ownerRemarks: note || c.ownerRemarks, awaitingInfo: null });
    case "owner_reject":
      return next("rejected", entry("Rejected By Owner", "rejected", note), { ownerRemarks: note, resolution: "rejected", awaitingInfo: null });
    case "owner_request_info":
      return next("under_owner_review", entry("More Information Requested By Owner", "under_owner_review", note), { awaitingInfo: { by: "owner", note, at: now } });
    case "user_reply": {
      const added = p.attachments ?? [];
      if (note.length < 3 && !added.length) throw new ComplaintError("Write a reply or attach evidence.");
      const attachments = validateAttachments(c.attachments, added);
      return next(c.status, entry("Driver Provided Information", c.status, note || `${added.length} file(s) attached`), { attachments, awaitingInfo: null });
    }
    case "accept":
      return next("investigating", entry("Investigation Started", "investigating", note));
    case "approve_refund": {
      const amount = Math.round(p.amount ?? c.txnAmount ?? 0);
      if (!(amount > 0)) throw new ComplaintError("Enter the refund amount.");
      if (c.txnAmount != null && amount > c.txnAmount) throw new ComplaintError(`Refund can't exceed the disputed charge (₹${c.txnAmount}).`);
      if (amount > 100_000) throw new ComplaintError("Refund amount looks wrong.");
      return next("investigating", entry("Refund Approved", "investigating", `₹${amount} to the driver's FASTag wallet${note ? ` · ${note}` : ""}`), { refund: { amount, approvedBy: a.id, at: now } });
    }
    case "command_reject":
      return next("rejected", entry("Complaint Rejected By Command Centre", "rejected", note), { commandCentreRemarks: note, resolution: "rejected", awaitingInfo: null });
    case "command_request_evidence":
      return next("investigating", entry("Additional Evidence Requested", "investigating", note), { awaitingInfo: { by: "command", note, at: now }, commandCentreRemarks: note });
    case "close":
      return next("resolved", entry("Case Closed", "resolved", note), { commandCentreRemarks: note || c.commandCentreRemarks, resolution: c.refund ? "refunded" : "no_refund", awaitingInfo: null });
  }
}
