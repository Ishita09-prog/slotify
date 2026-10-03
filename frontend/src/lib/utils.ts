import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
export const formatINR = (n: number) => inr.format(Math.round(n));

export const pct = (n: number) => `${Math.round(n * 100)}%`;

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** City driving ETA: road distance ≈ 1.3× straight line; average speed comes from the city config. */
export function etaMinutes(km: number, avgKmh = 22) {
  return Math.max(2, Math.round(((km * 1.3) / avgKmh) * 60));
}

/** External Google Maps directions — Slotify never does in-app navigation. */
export function googleMapsDirectionsUrl(dest: { lat: number; lng: number }, origin?: { lat: number; lng: number }) {
  const params = new URLSearchParams({ api: "1", destination: `${dest.lat},${dest.lng}`, travelmode: "driving" });
  if (origin) params.set("origin", `${origin.lat},${origin.lng}`);
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export function timeAgo(at: number, now: number | null) {
  if (!at || !now) return "—";
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function formatClock(at: number) {
  if (!at) return "—";
  return new Date(at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

export function formatDateTime(at: number) {
  if (!at) return "—";
  return new Date(at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function formatDuration(min: number) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export function normalizePlate(v: string) {
  return v.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Indian registration: TN38AB1234, KA01A1234, DL3CAB1234, BH series 22BH1234AA */
export function isValidPlate(v: string) {
  const p = normalizePlate(v);
  return /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}$/.test(p) || /^\d{2}BH\d{4}[A-Z]{1,2}$/.test(p);
}

export function uid(prefix = "") {
  return `${prefix}${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`.toUpperCase();
}

/** Deterministic PRNG so server and client render identical mock data. */
export function seeded(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
