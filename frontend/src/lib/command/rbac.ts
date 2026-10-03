import type { CityConfig } from "../cities";

export type RoleId = "command" | "police" | "operator" | "citizen";

export type Permission =
  | "command.view"
  | "incident.approve"
  | "incident.approve_enforcement"
  | "incident.assign"
  | "incident.resolve"
  | "scenario.run"
  | "health.chaos"
  | "report.generate"
  | "audit.view"
  | "audit.verify"
  | "slots.manage"
  | "challan.issue"
  | "dispute.manage";

export const ROLES: Record<RoleId, { label: string; description: string; permissions: Permission[]; home: string }> = {
  command: {
    label: "Command Officer",
    description: "City command centre (ULB). Full situational view, approves all actions, runs drills.",
    permissions: [
      "command.view", "incident.approve", "incident.approve_enforcement", "incident.assign", "incident.resolve",
      "scenario.run", "health.chaos", "report.generate", "audit.view", "audit.verify", "slots.manage", "dispute.manage",
    ],
    home: "/command",
  },
  police: {
    label: "Traffic Police Inspector",
    description: "Approves enforcement actions (tow, e-challan, patrol) in their division; cannot change pricing or capacity.",
    permissions: ["command.view", "incident.approve_enforcement", "incident.assign", "incident.resolve", "report.generate", "challan.issue"],
    home: "/command",
  },
  operator: {
    label: "Parking Operator",
    description: "Runs lots: bay maintenance, capacity changes, camera tickets. No enforcement powers.",
    permissions: ["slots.manage"],
    home: "/owner",
  },
  citizen: {
    label: "Citizen / Driver",
    description: "Finds, books and pays for parking. Sees only their own data.",
    permissions: [],
    home: "/user",
  },
};

export interface DemoUser {
  id: string;
  name: string;
  role: RoleId;
  title: string;
  org: string;
  /** login method shown in the audit trail */
  auth: string;
}

/** Fictional demo identities. Production: SSO via the state's identity provider (OIDC) with MFA. */
export function demoUsers(city: CityConfig): DemoUser[] {
  const chennai = city.id === "chennai-south";
  return [
    {
      id: chennai ? "gcc.cmd.0142" : "ccmc.cmd.0087",
      name: chennai ? "R. Meenakshi" : "K. Suresh",
      role: "command",
      title: "Duty Officer, Integrated Command & Control Centre",
      org: city.authority,
      auth: "SSO + OTP (demo)",
    },
    {
      id: chennai ? "gctp.insp.2291" : "cctp.insp.1180",
      name: chennai ? "Insp. A. Karthik" : "Insp. P. Lakshmi",
      role: "police",
      title: chennai ? "Inspector, Traffic South" : "Inspector, Traffic Central",
      org: city.police,
      auth: "SSO + OTP (demo)",
    },
    {
      id: chennai ? "gcc.op.0310" : "kovai.op.0021",
      name: chennai ? "S. Divya" : "M. Arun",
      role: "operator",
      title: "Lot Operations Lead",
      org: city.demoOwnerName,
      auth: "Password + OTP (demo)",
    },
    {
      id: "citizen.demo",
      name: "Demo Citizen",
      role: "citizen",
      title: `Driver · ${city.demoVehicle}`,
      org: "Public",
      auth: "Mobile OTP (demo)",
    },
  ];
}

export const can = (role: RoleId | undefined, p: Permission) => !!role && ROLES[role].permissions.includes(p);
