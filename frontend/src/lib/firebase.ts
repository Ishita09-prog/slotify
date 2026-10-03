import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { collection, getFirestore, onSnapshot, type Firestore } from "firebase/firestore";
import type { Slot } from "./types";

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const firebaseEnabled = Boolean(config.apiKey && config.projectId);

let app: FirebaseApp | null = null;
let db: Firestore | null = null;

export function getDb(): Firestore | null {
  if (!firebaseEnabled || typeof window === "undefined") return null;
  if (!app) app = getApps()[0] ?? initializeApp(config);
  if (!db) db = getFirestore(app);
  return db;
}

/**
 * Live slot feed: parking_lots/{lotId}/slots. The FastAPI detection worker
 * writes here; every dashboard re-renders from onSnapshot.
 */
export function subscribeToSlots(lotId: string, onChange: (slots: Slot[]) => void): () => void {
  const firestore = getDb();
  if (!firestore) return () => {};
  return onSnapshot(collection(firestore, "parking_lots", lotId, "slots"), (snap) => {
    const slots: Slot[] = snap.docs.map((d) => {
      const x = d.data();
      return {
        id: d.id,
        row: x.row,
        col: x.col,
        status: x.status,
        type: x.type ?? "standard",
        vehicleNumber: x.vehicle_number ?? undefined,
        heldBy: x.held_by ?? undefined,
        updatedAt: x.updated_at?.toMillis?.() ?? Date.now(),
      };
    });
    slots.sort((a, b) => (a.row === b.row ? a.col - b.col : a.row.localeCompare(b.row)));
    if (slots.length) onChange(slots);
  });
}
