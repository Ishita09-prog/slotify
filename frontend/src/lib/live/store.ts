/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Tiny document-store abstraction with two adapters:
 *  - "firebase": Cloud Firestore + Firebase Auth — real database shared by every laptop / phone.
 *  - "local":    localStorage + Web Locks + storage events — same API, syncs between windows of one browser
 *                (fallback so the demo never breaks if there is no internet / no Firebase config).
 * All business logic (lib/live/service.ts) is written once against this interface.
 */

export type Coll = "accounts" | "usernames" | "lots" | "bays" | "bookings" | "txns" | "footage" | "notices";
export type Filter = [field: string, value: unknown] | null;

export interface Tx {
  get<T>(coll: Coll, id: string): Promise<T | null>;
  set(coll: Coll, id: string, data: object): void;
}

export interface Store {
  kind: "firebase" | "local";
  label: string;
  watch<T>(coll: Coll, filter: Filter, cb: (docs: T[]) => void): () => void;
  watchDoc<T>(coll: Coll, id: string, cb: (doc: T | null) => void): () => void;
  get<T>(coll: Coll, id: string): Promise<T | null>;
  query<T>(coll: Coll, filter: Filter): Promise<T[]>;
  set(coll: Coll, id: string, data: object): Promise<void>;
  newId(): string;
  /** read-then-write atomically. Throws if `fn` throws; retried by Firestore on contention. */
  tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  auth: {
    signUp(username: string, password: string): Promise<string>;
    signIn(username: string, password: string): Promise<string>;
    signOut(): Promise<void>;
    onChange(cb: (uid: string | null) => void): () => void;
  };
}

export class UserError extends Error {}

const rid = () => {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 16; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
};
export const cleanUsername = (u: string) => u.trim().toLowerCase().replace(/[^a-z0-9._]/g, "");
const strip = (o: any): any => JSON.parse(JSON.stringify(o)); // drop undefined

/* ------------------------------------------------------------------ */
/* Local adapter                                                       */
/* ------------------------------------------------------------------ */
const LK = (c: string) => `slotify-live:${c}`;
const SESSION = "slotify-live:session";

async function sha(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export function localStore(): Store {
  const read = (c: string): Record<string, any> => {
    try {
      return JSON.parse(localStorage.getItem(LK(c)) || "{}");
    } catch {
      return {};
    }
  };
  const listeners = new Set<(c: string) => void>();
  const write = (c: string, id: string, data: object) => {
    const all = read(c);
    all[id] = strip({ ...data, id });
    localStorage.setItem(LK(c), JSON.stringify(all));
    listeners.forEach((l) => l(c));
  };
  window.addEventListener("storage", (e) => {
    if (e.key?.startsWith("slotify-live:")) listeners.forEach((l) => l(e.key!.slice(13)));
  });
  const match = (d: any, f: Filter) => !f || d[f[0]] === f[1];
  const authCbs = new Set<(u: string | null) => void>();
  const lock = <T,>(fn: () => Promise<T>): Promise<T> =>
    (navigator as any).locks?.request ? (navigator as any).locks.request("slotify-live", fn) : fn();

  const store: Store = {
    kind: "local",
    label: "Single-laptop mode",
    watch(coll, filter, cb) {
      const emit = () => cb(Object.values(read(coll)).filter((d) => match(d, filter)) as any);
      const l = (c: string) => c === coll && emit();
      listeners.add(l);
      emit();
      return () => void listeners.delete(l);
    },
    watchDoc(coll, id, cb) {
      const emit = () => cb((read(coll)[id] ?? null) as any);
      const l = (c: string) => c === coll && emit();
      listeners.add(l);
      emit();
      return () => void listeners.delete(l);
    },
    async get(coll, id) {
      return (read(coll)[id] ?? null) as any;
    },
    async query(coll, filter) {
      return Object.values(read(coll)).filter((d) => match(d, filter)) as any;
    },
    async set(coll, id, data) {
      write(coll, id, data);
    },
    newId: rid,
    tx(fn) {
      return lock(async () => {
        const writes: [Coll, string, object][] = [];
        const r = await fn({
          async get(c, id) {
            const pending = [...writes].reverse().find((w) => w[0] === c && w[1] === id);
            return (pending ? pending[2] : read(c)[id] ?? null) as any;
          },
          set(c, id, data) {
            writes.push([c, id, data]);
          },
        });
        for (const [c, id, d] of writes) write(c, id, d);
        return r;
      });
    },
    auth: {
      async signUp(username, password) {
        const u = cleanUsername(username);
        return lock(async () => {
          const creds = read("_auth");
          if (creds[u]) throw new UserError("That username is taken. Try another.");
          const uid = rid();
          creds[u] = { uid, hash: await sha(`${u}:${password}`) };
          localStorage.setItem(LK("_auth"), JSON.stringify(creds));
          sessionStorage.setItem(SESSION, uid);
          authCbs.forEach((c) => c(uid));
          return uid;
        });
      },
      async signIn(username, password) {
        const u = cleanUsername(username);
        const c = read("_auth")[u];
        if (!c || c.hash !== (await sha(`${u}:${password}`))) throw new UserError("Wrong username or password.");
        sessionStorage.setItem(SESSION, c.uid);
        authCbs.forEach((cb) => cb(c.uid));
        return c.uid;
      },
      async signOut() {
        sessionStorage.removeItem(SESSION);
        authCbs.forEach((cb) => cb(null));
      },
      onChange(cb) {
        authCbs.add(cb);
        cb(sessionStorage.getItem(SESSION));
        return () => void authCbs.delete(cb);
      },
    },
  };
  return store;
}

/* ------------------------------------------------------------------ */
/* Firebase adapter                                                    */
/* ------------------------------------------------------------------ */
export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  storageBucket?: string;
  messagingSenderId?: string;
}

const EMAIL = (u: string) => `${cleanUsername(u)}@slotify.app`;

function authMessage(e: any): string {
  const code: string = e?.code ?? "";
  if (code.includes("email-already-in-use")) return "That username is taken. Try another.";
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) return "Wrong username or password.";
  if (code.includes("weak-password")) return "Password must be at least 6 characters.";
  if (code.includes("operation-not-allowed")) return "Turn on Email/Password sign-in in Firebase → Authentication.";
  if (code.includes("network")) return "No internet connection.";
  return e?.message ?? "Something went wrong.";
}

export async function firebaseStore(config: FirebaseConfig): Promise<Store> {
  const [{ initializeApp, getApps }, fs, fa] = await Promise.all([import("firebase/app"), import("firebase/firestore"), import("firebase/auth")]);
  const app = getApps().find((a) => a.name === "slotify-live") ?? initializeApp(config, "slotify-live");
  let db: import("firebase/firestore").Firestore;
  try {
    db = fs.initializeFirestore(app, { ignoreUndefinedProperties: true, experimentalAutoDetectLongPolling: true });
  } catch {
    db = fs.getFirestore(app);
  }
  if (typeof window !== "undefined" && (window as any).__SLOTIFY_EMULATOR__) {
    try {
      fs.connectFirestoreEmulator(db, "127.0.0.1", 8080);
    } catch {
      /* already connected */
    }
  }
  const auth = fa.getAuth(app);
  if (typeof window !== "undefined" && (window as any).__SLOTIFY_EMULATOR__) {
    try {
      fa.connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    } catch {
      /* noop */
    }
  }
  // One account per browser tab, so one laptop can also play several roles.
  await fa.setPersistence(auth, fa.browserSessionPersistence);
  const q = (coll: Coll, filter: Filter) =>
    filter ? fs.query(fs.collection(db, coll), fs.where(filter[0], "==", filter[1])) : fs.collection(db, coll);
  const data = (d: any) => ({ ...d.data(), id: d.id });

  return {
    kind: "firebase",
    label: `Live database · ${config.projectId}`,
    watch(coll, filter, cb) {
      return fs.onSnapshot(q(coll, filter), (s) => cb(s.docs.map(data) as any), (e) => console.error("watch", coll, e));
    },
    watchDoc(coll, id, cb) {
      return fs.onSnapshot(fs.doc(db, coll, id), (d) => cb(d.exists() ? (data(d) as any) : null), (e) => console.error("watchDoc", coll, e));
    },
    async get(coll, id) {
      const d = await fs.getDoc(fs.doc(db, coll, id));
      return d.exists() ? (data(d) as any) : null;
    },
    async query(coll, filter) {
      const s = await fs.getDocs(q(coll, filter));
      return s.docs.map(data) as any;
    },
    async set(coll, id, d) {
      await fs.setDoc(fs.doc(db, coll, id), strip({ ...d, id }));
    },
    newId: rid,
    tx(fn) {
      return fs.runTransaction(db, async (t) =>
        fn({
          async get(c, id) {
            const d = await t.get(fs.doc(db, c, id));
            return d.exists() ? (data(d) as any) : null;
          },
          set(c, id, d) {
            t.set(fs.doc(db, c, id), strip({ ...d, id }));
          },
        })
      );
    },
    auth: {
      async signUp(username, password) {
        try {
          return (await fa.createUserWithEmailAndPassword(auth, EMAIL(username), password)).user.uid;
        } catch (e) {
          throw new UserError(authMessage(e));
        }
      },
      async signIn(username, password) {
        try {
          return (await fa.signInWithEmailAndPassword(auth, EMAIL(username), password)).user.uid;
        } catch (e) {
          throw new UserError(authMessage(e));
        }
      },
      async signOut() {
        await fa.signOut(auth);
      },
      onChange(cb) {
        return fa.onAuthStateChanged(auth, (u) => cb(u?.uid ?? null));
      },
    },
  };
}

/** Config comes from /firebase-config.json (editable after build) or NEXT_PUBLIC_FIREBASE_* env vars. */
export async function loadConfig(): Promise<FirebaseConfig | null> {
  try {
    const r = await fetch("/firebase-config.json", { cache: "no-store" });
    if (r.ok) {
      const c = await r.json();
      if (c?.apiKey && c?.projectId && !String(c.apiKey).startsWith("PASTE")) return c;
    }
  } catch {
    /* ignore */
  }
  const env = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "",
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "",
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "",
  };
  return env.apiKey && env.projectId ? env : null;
}
