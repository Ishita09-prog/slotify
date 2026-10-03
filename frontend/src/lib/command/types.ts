export type IncidentType = "saturation" | "anomaly" | "illegal_cluster" | "sensor_outage";
export type Severity = "critical" | "high" | "medium" | "low";
export type IncidentStatus =
  | "awaiting_approval"
  | "dispatched"
  | "on_scene"
  | "monitoring"
  | "resolved"
  | "rejected";

export type RecKind = "redirect" | "vms" | "warden" | "tow" | "patrol" | "pricing" | "maintenance" | "fallback" | "challan" | "verify";

export interface Recommendation {
  id: string;
  kind: RecKind;
  title: string;
  detail: string;
  /** what we expect to happen if approved */
  expected: string;
  /** enforcement actions can be approved by police; others need the command officer */
  enforcement: boolean;
  /** pre-selected in the approval form */
  suggested: boolean;
  params?: {
    lotId?: string;
    altLotIds?: string[];
    unitId?: string;
    vmsIds?: string[];
    violationIds?: string[];
    message?: string;
  };
}

export interface RiskFactor {
  label: string;
  value: string;
  /** points contributed to the 0-100 risk score */
  points: number;
}

export interface TimelineItem {
  at: number;
  label: string;
  actor: string;
  kind: "system" | "ai" | "human" | "unit" | "notify";
}

export interface Incident {
  id: string;
  /** dedupe key from the detector, e.g. "sat:z-tnagar" */
  key: string;
  type: IncidentType;
  severity: Severity;
  status: IncidentStatus;
  title: string;
  summary: string;
  zoneId: string;
  localityId?: string;
  lotId?: string;
  lat: number;
  lng: number;
  detectedAt: number;
  source: string;
  evidence: { label: string; value: string }[];
  risk: { score: number; factors: RiskFactor[] };
  confidence: number;
  forecast?: { horizonMin: number; occupancy: number; low: number; high: number; confidence?: number; factors: { label: string; value?: string; points: number }[]; modelVersion: string };
  recommendations: Recommendation[];
  approved?: { by: string; role: string; at: number; recIds: string[]; note?: string };
  rejected?: { by: string; at: number; reason: string };
  unitId?: string;
  unitEtaAt?: number;
  escalated?: boolean;
  timeline: TimelineItem[];
  resolved?: { by: string; at: number; note: string };
  /** occupancy of the watched lots at detection (for before/after) */
  watchLotIds: string[];
  occAtDetection?: number;
  occAtResolution?: number;
  /** forecast made at detection = what would have happened without action */
  counterfactual?: number;
  readyToClose?: boolean;
  /** demo clock: when the assigned unit set off */
  unitDepartAt?: number;
}

export interface Notification {
  id: string;
  at: number;
  incidentId?: string;
  to: string;
  channel: "Field app push" | "SMS" | "VMS board" | "Citizen app" | "Email" | "Vendor ticket";
  message: string;
  status: "sent" | "delivered" | "acknowledged";
}

export interface UnitState {
  id: string;
  status: "available" | "dispatched" | "en_route" | "on_scene";
  incidentId?: string;
  lat: number;
  lng: number;
}
