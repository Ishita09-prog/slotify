"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { firebaseStore, loadConfig, localStore, type Store } from "./store";
import type { Account, Bay, LiveBooking, LiveLot, Txn } from "./types";

interface LiveCtx {
  store: Store | null;
  ready: boolean;
  /** auth resolved (signed in or not) */
  authReady: boolean;
  uid: string | null;
  account: Account | null;
  lots: LiveLot[];
  bays: Bay[];
  bookings: LiveBooking[];
  txns: Txn[];
  signOut: () => Promise<void>;
}

const Ctx = createContext<LiveCtx | null>(null);

export function LiveProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<Store | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [account, setAccount] = useState<Account | null>(null);
  const [lots, setLots] = useState<LiveLot[]>([]);
  const [bays, setBays] = useState<Bay[]>([]);
  const [bookings, setBookings] = useState<LiveBooking[]>([]);
  const [txns, setTxns] = useState<Txn[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const cfg = await loadConfig();
      let s: Store;
      try {
        s = cfg ? await firebaseStore(cfg) : localStore();
      } catch (e) {
        console.error("Firebase unavailable, falling back to single-laptop mode", e);
        s = localStore();
      }
      if (alive) setStore(s);
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!store) return;
    return store.auth.onChange((u) => {
      setUid(u);
      setAuthReady(true);
    });
  }, [store]);

  // Public data: every lot and bay (bay colours are what every user sees).
  useEffect(() => {
    if (!store || !uid) return;
    const a = store.watch<LiveLot>("lots", null, setLots);
    const b = store.watch<Bay>("bays", null, setBays);
    return () => {
      a();
      b();
    };
  }, [store, uid]);

  useEffect(() => {
    if (!store || !uid) {
      setAccount(null);
      return;
    }
    return store.watchDoc<Account>("accounts", uid, setAccount);
  }, [store, uid]);

  // Private data: my bookings (driver) or bookings at my lots (owner); my FASTag transactions.
  useEffect(() => {
    if (!store || !uid || !account) {
      setBookings([]);
      setTxns([]);
      return;
    }
    const a = store.watch<LiveBooking>("bookings", [account.role === "owner" ? "ownerUid" : "driverUid", uid], (l) =>
      setBookings(l.sort((x, y) => y.createdAt - x.createdAt))
    );
    const b = store.watch<Txn>("txns", ["uid", uid], (l) => setTxns(l.sort((x, y) => y.at - x.at)));
    return () => {
      a();
      b();
    };
  }, [store, uid, account?.role]); // eslint-disable-line react-hooks/exhaustive-deps

  const value = useMemo<LiveCtx>(
    () => ({
      store,
      ready: !!store,
      authReady,
      uid,
      account,
      lots: [...lots].sort((a, b) => a.createdAt - b.createdAt),
      bays,
      bookings,
      txns,
      signOut: async () => {
        await store?.auth.signOut();
      },
    }),
    [store, authReady, uid, account, lots, bays, bookings, txns]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLive() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useLive outside LiveProvider");
  return c;
}

/** Re-render every `ms` (for countdowns and "now" based colours). */
export function useTick(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const i = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(i);
  }, [ms]);
  return now;
}
