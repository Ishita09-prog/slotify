import type { CityId } from "../cities";

/**
 * Demo drills. They only change the SIMULATED world (demand pressure, camera health, weather,
 * illegal parking events). Detection, forecasting and recommendations then run exactly as they
 * would on real camera data — nothing downstream is scripted.
 */
export interface Scenario {
  id: string;
  title: string;
  description: string;
  icon: "flame" | "waves" | "laptop" | "camera" | "rain" | "server";
  /** push lots to at least `target` occupancy (time-of-day independent) */
  pressure?: { lotIds: string[]; target: number }[];
  violationBurst?: { localityId: string; count: number };
  offlineLotIds?: string[];
  rainMm?: number;
  apiDown?: boolean;
}

export const SCENARIOS: Record<CityId, Scenario[]> = {
  "chennai-south": [
    {
      id: "tnagar-festival",
      title: "Festival rush · T. Nagar",
      description: "Pre-Deepavali shopping crowd floods Pondy Bazaar and Ranganathan St; double parking starts on Sir Theagaraya Rd.",
      icon: "flame",
      pressure: [{ lotIds: ["tn-pondy", "tn-ranganathan", "tn-panagal", "tn-mlcp"], target: 0.995 }],
      violationBurst: { localityId: "l-pondy", count: 4 },
    },
    {
      id: "besant-surge",
      title: "Unplanned crowd · Elliot's Beach",
      description: "A social-media event draws a crowd to Besant Nagar on a weekday — demand no calendar predicts.",
      icon: "waves",
      pressure: [{ lotIds: ["ad-besant", "ad-ashtalakshmi"], target: 0.86 }],
    },
    {
      id: "omr-shift",
      title: "Shift change · OMR IT corridor",
      description: "Two IT parks change shifts together; Sholinganallur and Thoraipakkam park-and-ride fill up.",
      icon: "laptop",
      pressure: [{ lotIds: ["omr-sholinganallur", "omr-thoraipakkam", "omr-tidel"], target: 0.995 }],
      violationBurst: { localityId: "l-sholinganallur", count: 3 },
    },
    {
      id: "camera-failure",
      title: "Camera node failure · Velachery MRTS",
      description: "Edge node at Velachery MRTS stops sending frames (power cut).",
      icon: "camera",
      offlineLotIds: ["vl-mrts"],
    },
    {
      id: "heavy-rain",
      title: "Heavy rain alert",
      description: "NE monsoon cell over the city: 18 mm/h. Beach demand collapses, malls fill.",
      icon: "rain",
      rainMm: 18,
    },
    {
      id: "api-outage",
      title: "Backend outage",
      description: "Central API cluster unreachable. Dashboards must keep working on edge data and the on-device model.",
      icon: "server",
      apiDown: true,
    },
  ],
  coimbatore: [
    {
      id: "townhall-festival",
      title: "Festival rush · Town Hall",
      description: "Festival shopping crowds at Town Hall & Gandhipuram; double parking on Big Bazaar St.",
      icon: "flame",
      pressure: [{ lotIds: ["town-hall", "gandhipuram", "junction"], target: 0.995 }],
      violationBurst: { localityId: "l-townhall", count: 4 },
    },
    {
      id: "racecourse-surge",
      title: "Unplanned crowd · Race Course",
      description: "A weekday rally draws an unexpected crowd to Race Course.",
      icon: "waves",
      pressure: [{ lotIds: ["race-course"], target: 0.85 }],
    },
    {
      id: "camera-failure",
      title: "Camera node failure · Gandhipuram",
      description: "Edge node at Gandhipuram multi-level stops sending frames.",
      icon: "camera",
      offlineLotIds: ["gandhipuram"],
    },
    { id: "heavy-rain", title: "Heavy rain alert", description: "Heavy showers: 15 mm/h.", icon: "rain", rainMm: 15 },
    { id: "api-outage", title: "Backend outage", description: "Central API cluster unreachable.", icon: "server", apiDown: true },
  ],
};
