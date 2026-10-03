import type { Booking, ParkingLot, Prediction, Violation, Zone } from "./types";
import { predictLocal } from "./predict";
import { cityZones } from "./mock-data";
import type { CityConfig } from "./cities";

/**
 * Thin client for the FastAPI backend. Every call degrades gracefully to the
 * on-device simulator, so the demo keeps working with no network or backend.
 */
export const API_URL = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "";
export const backendEnabled = Boolean(API_URL);

async function request<T>(path: string, init?: RequestInit, timeoutMs = 4000): Promise<T | null> {
  if (!backendEnabled) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_URL}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  async prediction(lot: ParkingLot, currentOccupancy: number, totalSlots: number, arrivalInMin: number, rainMm = 0): Promise<Prediction> {
    const remote = await request<Omit<Prediction, "source">>(
      `/api/predictions/${lot.id}?arrival_in_minutes=${arrivalInMin}&current_occupancy=${currentOccupancy.toFixed(3)}&rain_mm=${rainMm}`
    );
    if (remote) return { ...remote, source: "backend" };
    return predictLocal(lot, currentOccupancy, totalSlots, arrivalInMin, rainMm);
  },

  async zones(city: CityConfig): Promise<Zone[]> {
    return (await request<Zone[]>(`/api/police/zones?city=${city.id}`)) ?? cityZones(city);
  },

  async violations(): Promise<Violation[] | null> {
    return request<Violation[]>("/api/police/violations");
  },

  async createBooking(b: Booking) {
    return request<{ id: string }>("/api/bookings", {
      method: "POST",
      body: JSON.stringify({
        lot_id: b.lotId,
        slot_id: b.slotId,
        vehicle_number: b.vehicleNumber,
        start_time: new Date(b.startTime).toISOString(),
        duration_hours: b.durationHours,
        payment_method: b.paymentMethod,
      }),
    });
  },

  async updateSlots(lotId: string, slotIds: string[], status: string) {
    return request(`/api/owner/lots/${lotId}/slots/status`, {
      method: "PATCH",
      body: JSON.stringify({ slot_ids: slotIds, status }),
    });
  },

  async fastagExit(vehicle: string, lotId: string, durationMin: number) {
    return request(`/api/fastag/${vehicle}/exit`, {
      method: "POST",
      body: JSON.stringify({ lot_id: lotId, duration_minutes: durationMin }),
    });
  },
};
