import type { TimeWindow } from "./types";

/** All scheduling is in India Standard Time regardless of the laptop's timezone. */
const IST = 5.5 * 3600_000;

export const istDateKey = (t: number) => new Date(t + IST).toISOString().slice(0, 10).replace(/-/g, "");
export const istHHMM = (t: number) => new Date(t + IST).toISOString().slice(11, 16);
export const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Epoch ms of a window boundary on a given IST date key. */
export function at(dateKey: string, hhmm: string) {
  const d = `${dateKey.slice(0, 4)}-${dateKey.slice(4, 6)}-${dateKey.slice(6, 8)}`;
  return Date.parse(`${d}T${hhmm}:00+05:30`);
}

export function windowRange(dateKey: string, w: TimeWindow) {
  const s = at(dateKey, w.start);
  let e = at(dateKey, w.end);
  if (e <= s) e += 24 * 3600_000;
  return { start: s, end: e };
}

export const windowHours = (w: TimeWindow) => {
  const d = toMin(w.end) - toMin(w.start);
  return Math.round(((d > 0 ? d : d + 1440) / 60) * 10) / 10;
};

export const slotKey = (dateKey: string, windowId: string) => `${dateKey}_${windowId}`;

/** Today and tomorrow (IST) as selectable days. */
export function bookableDays(now: number) {
  return [
    { key: istDateKey(now), label: "Today" },
    { key: istDateKey(now + 24 * 3600_000), label: "Tomorrow" },
  ];
}

/** The window running right now, if any. */
export function currentWindow(windows: TimeWindow[], now: number) {
  const d = istDateKey(now);
  return windows.find((w) => {
    const r = windowRange(d, w);
    return now >= r.start && now < r.end;
  });
}

export const fmtTime = (t: number) =>
  new Date(t).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true });
export const fmtDate = (t: number) =>
  new Date(t).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });
export const fmtDateTime = (t: number) =>
  new Date(t).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
export const fmtDur = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ""}`.trim();
};
