"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Building2, CarFront, Database, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { useLive } from "@/lib/live/provider";
import { registerAccount } from "@/lib/live/service";
import { UserError } from "@/lib/live/store";
import type { Role, Vehicle } from "@/lib/live/types";
import { cn, isValidPlate } from "@/lib/utils";
import { GlassCard, PortalShell, VehicleRow, field, primaryBtn } from "./portal";

const HOME: Record<Role, string> = { driver: "/user", owner: "/owner" };

export function LiveAuth({ role }: { role: Role }) {
  const router = useRouter();
  const live = useLive();
  const [tab, setTab] = useState<"in" | "up">("in");
  const [busy, setBusy] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [business, setBusiness] = useState("");
  const [vehicles, setVehicles] = useState<Vehicle[]>([{ number: "", type: "car" }]);
  const Icon = role === "driver" ? CarFront : Building2;

  // Already signed in with the right role → straight in.
  useEffect(() => {
    if (live.account?.role === role) router.replace(HOME[role]);
  }, [live.account, role, router]);

  const fail = (e: unknown) => {
    toast.error(e instanceof UserError ? e.message : (e as Error)?.message ?? "Something went wrong");
    setBusy(false);
  };

  const signIn = async () => {
    if (!live.store) return;
    setBusy(true);
    try {
      const uid = await live.store.auth.signIn(username, password);
      const acc = await live.store.get<{ role: Role; name: string }>("accounts", uid);
      if (acc && acc.role !== role) {
        await live.store.auth.signOut();
        throw new UserError(`This is a ${acc.role === "owner" ? "parking operator" : "driver"} account. Use the ${acc.role === "owner" ? "Parking operator" : "Driver"} portal.`);
      }
      toast.success(`Welcome back${acc ? `, ${acc.name.split(" ")[0]}` : ""}`);
      router.replace(HOME[role]);
    } catch (e) {
      fail(e);
    }
  };

  const plates = vehicles.map((v) => v.number);
  const upValid =
    name.trim().length >= 2 &&
    /^[6-9]\d{9}$/.test(phone) &&
    username.trim().length >= 3 &&
    password.length >= 6 &&
    (role === "owner" ? business.trim().length >= 2 : vehicles.every((v) => isValidPlate(v.number)) && new Set(plates).size === plates.length);

  const signUp = async () => {
    if (!live.store) return;
    setBusy(true);
    try {
      await registerAccount(live.store, { username, password, role, name, phone, business, vehicles: role === "driver" ? vehicles : [] });
      toast.success("Account created");
      router.replace(HOME[role]);
    } catch (e) {
      fail(e);
    }
  };

  return (
    <PortalShell>
      <div className="mx-auto max-w-md">
        <GlassCard>
          <div className="flex items-center justify-between">
            <span className="grid size-11 place-items-center rounded-2xl border border-white/15 bg-white/10"><Icon className="size-5" /></span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-slate-400">
              <Database className="size-3" /> {live.store?.label ?? "Connecting…"}
            </span>
          </div>
          <h1 className="portal-title mt-4 text-3xl font-semibold">{role === "driver" ? "Park smarter." : "Run your parking."}</h1>
          <p className="mt-1.5 text-[15px] text-slate-400">{role === "driver" ? "Driver portal" : "Parking operator portal"}</p>

          <div className="mt-6 grid grid-cols-2 rounded-2xl border border-white/10 bg-white/5 p-1 text-sm font-semibold">
            {(["in", "up"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={cn("h-10 rounded-xl transition", tab === t ? "bg-white/15 text-white" : "text-slate-400 hover:text-slate-200")}>
                {t === "in" ? "Sign in" : "Create account"}
              </button>
            ))}
          </div>

          <AnimatePresence mode="wait">
            {tab === "in" ? (
              <motion.form key="in" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} className="mt-5 space-y-3" onSubmit={(e) => { e.preventDefault(); void signIn(); }}>
                <input aria-label="Username" autoComplete="username" placeholder="Username" className={field} value={username} onChange={(e) => setUsername(e.target.value)} />
                <input aria-label="Password" type="password" autoComplete="current-password" placeholder="Password" className={field} value={password} onChange={(e) => setPassword(e.target.value)} />
                <button type="submit" className={cn(primaryBtn, "!mt-5")} disabled={busy || !live.store || !username || !password}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />} Sign in
                </button>
                <p className="text-center text-xs text-slate-500">New here? <button type="button" onClick={() => setTab("up")} className="text-sky-300">Create an account</button></p>
              </motion.form>
            ) : (
              <motion.form key="up" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} className="mt-5 space-y-3" onSubmit={(e) => { e.preventDefault(); if (upValid) void signUp(); }}>
                <input aria-label="Full name" placeholder="Full name" className={field} value={name} onChange={(e) => setName(e.target.value)} />
                {role === "owner" && <input aria-label="Business name" placeholder="Parking business name (e.g. Velachery Mall Parking)" className={field} value={business} onChange={(e) => setBusiness(e.target.value)} />}
                <div className="flex gap-2">
                  <span className={cn(field, "flex w-16 shrink-0 items-center justify-center px-0 text-slate-300")}>+91</span>
                  <input aria-label="Mobile number" inputMode="tel" placeholder="Mobile number" className={field} value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input aria-label="Choose username" autoComplete="username" placeholder="Username" className={field} value={username} onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9._]/g, ""))} />
                  <input aria-label="Choose password" type="password" autoComplete="new-password" placeholder="Password (6+)" className={field} value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
                {role === "driver" && (
                  <>
                    <p className="pt-1 text-xs font-medium text-slate-400">My vehicles · a FASTag is linked to the first one</p>
                    {vehicles.map((v, i) => (
                      <VehicleRow key={i} v={v} onChange={(nv) => setVehicles((a) => a.map((x, j) => (j === i ? nv : x)))} onRemove={vehicles.length > 1 ? () => setVehicles((a) => a.filter((_, j) => j !== i)) : undefined} />
                    ))}
                    {vehicles.length < 4 && (
                      <button type="button" onClick={() => setVehicles((a) => [...a, { number: "", type: "bike" }])} className="inline-flex items-center gap-1 text-sm font-medium text-sky-300 hover:text-sky-200">
                        <Plus className="size-4" /> Add another vehicle
                      </button>
                    )}
                  </>
                )}
                <button type="submit" className={cn(primaryBtn, "!mt-5")} disabled={busy || !upValid || !live.store}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />} Create account
                </button>
              </motion.form>
            )}
          </AnimatePresence>
        </GlassCard>
      </div>
    </PortalShell>
  );
}
