"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Building2, CarFront, Check, KeyRound, Loader2, Lock, Phone, Plus, Radar, ShieldCheck, Siren, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Logo } from "@/components/brand/logo";
import { CitySwitcher } from "@/components/layout/city-switcher";
import { useCity } from "@/lib/city";
import { ROLES, demoUsers, type RoleId } from "@/lib/command/rbac";
import { useCommand } from "@/lib/command/store";
import { VEHICLE_LABEL, useDriver, type Vehicle, type VehicleType } from "@/lib/driver";
import { cn, isValidPlate, normalizePlate } from "@/lib/utils";

export const PORTALS: { role: RoleId; slug: string; title: string; sub: string; icon: React.ElementType; accent: string; home: string }[] = [
  { role: "citizen", slug: "driver", title: "Driver", sub: "Find, book and pay for parking", icon: CarFront, accent: "from-sky-400/30 to-blue-600/10", home: "/user" },
  { role: "operator", slug: "operator", title: "Parking operator", sub: "Run your lots, slots and time windows", icon: Building2, accent: "from-emerald-400/30 to-teal-600/10", home: "/owner" },
  { role: "police", slug: "police", title: "Traffic police", sub: "Violations, enforcement, approvals", icon: Siren, accent: "from-orange-400/30 to-rose-600/10", home: "/police" },
  { role: "command", slug: "command", title: "Command centre", sub: "City-wide GIS, AI, incidents", icon: Radar, accent: "from-violet-400/30 to-indigo-600/10", home: "/command" },
];

/* ---------- shell: glass card, soft aurora, cursor glow ---------- */
export function PortalShell({ children, back = true }: { children: React.ReactNode; back?: boolean }) {
  const glow = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (glow.current) glow.current.style.transform = `translate(${e.clientX - 200}px, ${e.clientY - 200}px)`;
    };
    window.addEventListener("pointermove", move);
    return () => window.removeEventListener("pointermove", move);
  }, []);
  return (
    <div className="portal-root relative min-h-dvh overflow-hidden text-slate-100">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -left-40 -top-40 size-[34rem] rounded-full bg-blue-600/25 blur-[120px]" />
        <div className="absolute -right-32 top-1/3 size-[28rem] rounded-full bg-violet-600/20 blur-[120px]" />
        <div className="absolute bottom-[-12rem] left-1/3 size-[30rem] rounded-full bg-emerald-500/10 blur-[120px]" />
      </div>
      <div ref={glow} aria-hidden className="pointer-events-none fixed left-0 top-0 hidden size-[400px] rounded-full bg-sky-400/10 blur-3xl transition-transform duration-150 ease-out md:block" />
      <header className="relative z-10 flex h-16 items-center justify-between px-4 sm:px-8">
        <Logo className="text-slate-100" />
        <CitySwitcher compact className="border-white/10 bg-white/5 text-slate-100" />
      </header>
      <main className="relative z-10 mx-auto w-full max-w-5xl px-4 pb-16 pt-4 sm:px-8">
        {back && (
          <Link href="/login" className="mb-5 inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-100">
            <ArrowLeft className="size-4" /> All portals
          </Link>
        )}
        {children}
      </main>
    </div>
  );
}

export function GlassCard({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("glass-card rounded-3xl p-6 sm:p-8", className)}>{children}</div>;
}

export const field = "h-12 w-full rounded-2xl border border-white/10 bg-white/[0.06] px-4 text-[15px] text-slate-50 outline-none placeholder:text-slate-500 transition focus:border-sky-400/60 focus:bg-white/[0.09] focus:ring-4 focus:ring-sky-400/10";
export const primaryBtn = "inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-sky-400 to-blue-600 text-[15px] font-semibold text-white shadow-[0_8px_30px_-8px_rgba(56,189,248,.6)] transition hover:brightness-110 active:scale-[.99] disabled:opacity-40 disabled:shadow-none";

/* ---------- chooser ---------- */
export function PortalChooser() {
  const { city } = useCity();
  return (
    <PortalShell back={false}>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mx-auto max-w-3xl pt-6 text-center sm:pt-12">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-300/80">{city.authority}</p>
        <h1 className="portal-title mt-3 text-4xl font-semibold sm:text-6xl">Who&apos;s signing in?</h1>
        <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-slate-400">Each portal shows only what that role is allowed to see. Every sign-in is written to the audit trail.</p>
      </motion.div>
      <div className="mx-auto mt-10 grid max-w-3xl gap-3 sm:grid-cols-2">
        {PORTALS.map((p, i) => {
          const Icon = p.icon;
          return (
            <motion.div key={p.slug} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.06 * i }}>
              <Link href={`/login/${p.slug}`} className="glass-card group relative flex items-center gap-4 overflow-hidden rounded-3xl p-5 transition hover:-translate-y-0.5 hover:border-white/25">
                <span className={cn("absolute inset-0 bg-gradient-to-br opacity-60 transition group-hover:opacity-100", p.accent)} aria-hidden />
                <span className="relative grid size-12 shrink-0 place-items-center rounded-2xl border border-white/15 bg-white/10"><Icon className="size-6" /></span>
                <span className="relative min-w-0 flex-1 text-left">
                  <span className="block text-lg font-semibold tracking-tight">{p.title}</span>
                  <span className="block truncate text-sm text-slate-300/80">{p.sub}</span>
                </span>
                <ArrowRight className="relative size-5 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-white" />
              </Link>
            </motion.div>
          );
        })}
      </div>
      <p className="mx-auto mt-8 flex max-w-3xl items-start gap-2 text-xs leading-relaxed text-slate-500">
        <KeyRound className="mt-0.5 size-3.5 shrink-0" /> Prototype sign-in. Production: drivers use mobile OTP; officials use the state SSO (OpenID Connect) with OTP / hardware-key MFA, and the API checks the same role permissions on every request.
      </p>
    </PortalShell>
  );
}

/* ---------- official portals (operator / police / command) ---------- */
export function OfficialLogin({ slug }: { slug: "operator" | "police" | "command" }) {
  const p = PORTALS.find((x) => x.slug === slug)!;
  const { city } = useCity();
  const cmd = useCommand();
  const router = useRouter();
  const user = demoUsers(city).find((u) => u.role === p.role)!;
  const [stage, setStage] = useState<"creds" | "otp" | "busy">("creds");
  const [id, setId] = useState(user.id);
  const [pw, setPw] = useState("demo@1234");
  const [otp, setOtp] = useState("");
  useEffect(() => setId(user.id), [user.id]);
  const Icon = p.icon;

  const finish = async () => {
    setStage("busy");
    await new Promise((r) => setTimeout(r, 700));
    cmd.login(user.id);
    toast.success(`Signed in as ${user.name}`);
    router.push(p.home);
  };

  return (
    <PortalShell>
      <div className="mx-auto grid max-w-4xl items-center gap-8 md:grid-cols-[1fr_420px]">
        <div className="hidden md:block">
          <span className="grid size-14 place-items-center rounded-2xl border border-white/15 bg-white/10"><Icon className="size-7" /></span>
          <h1 className="portal-title mt-5 text-5xl font-semibold">{p.title}</h1>
          <p className="mt-3 max-w-sm text-[15px] leading-relaxed text-slate-400">{ROLES[p.role].description}</p>
          <div className="mt-6 flex flex-wrap gap-1.5">
            {ROLES[p.role].permissions.map((x) => <span key={x} className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 font-mono text-[10px] text-slate-400">{x}</span>)}
          </div>
        </div>
        <GlassCard>
          <div className="mb-6 md:hidden">
            <span className="grid size-11 place-items-center rounded-2xl border border-white/15 bg-white/10"><Icon className="size-5" /></span>
            <h1 className="portal-title mt-3 text-3xl font-semibold">{p.title}</h1>
          </div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{slug === "operator" ? city.demoOwnerName : slug === "police" ? city.police : city.authority}</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight">{stage === "otp" ? "Verify it's you" : "Sign in"}</h2>
          <AnimatePresence mode="wait">
            {stage === "creds" ? (
              <motion.form key="c" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} className="mt-6 space-y-3" onSubmit={(e) => { e.preventDefault(); setStage("otp"); }}>
                <label className="block text-xs font-medium text-slate-400">Employee ID<input className={cn(field, "mt-1.5 font-mono")} value={id} onChange={(e) => setId(e.target.value)} /></label>
                <label className="block text-xs font-medium text-slate-400">Password<input type="password" className={cn(field, "mt-1.5")} value={pw} onChange={(e) => setPw(e.target.value)} /></label>
                <button type="submit" className={cn(primaryBtn, "!mt-5")} disabled={!id || pw.length < 4}>Continue <ArrowRight className="size-4" /></button>
                <p className="text-center text-xs text-slate-500">Demo: {user.name} · {user.title}</p>
              </motion.form>
            ) : (
              <motion.form key="o" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} className="mt-6 space-y-3" onSubmit={(e) => { e.preventDefault(); void finish(); }}>
                <p className="text-sm text-slate-400">We sent a 6-digit code to the registered mobile. <span className="text-slate-200">Demo code: 123456</span></p>
                <OtpInput value={otp} onChange={setOtp} />
                <button type="submit" className={cn(primaryBtn, "!mt-5")} disabled={otp !== "123456" || stage === "busy"}>
                  {stage === "busy" ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />} Verify & sign in
                </button>
                <button type="button" onClick={() => setOtp("123456")} className="w-full text-center text-xs text-sky-300 hover:text-sky-200">Autofill demo code</button>
              </motion.form>
            )}
          </AnimatePresence>
          <p className="mt-6 flex items-center gap-1.5 border-t border-white/10 pt-4 text-[11px] text-slate-500"><Lock className="size-3" /> SSO + OTP in production · session logged to the audit trail</p>
        </GlassCard>
      </div>
    </PortalShell>
  );
}

function OtpInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      autoFocus
      inputMode="numeric"
      autoComplete="one-time-code"
      aria-label="One-time code"
      className={cn(field, "text-center font-mono text-2xl tracking-[0.6em]")}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
      placeholder="••••••"
    />
  );
}

/* ---------- driver portal: phone → OTP → profile ---------- */
export function DriverLogin() {
  const router = useRouter();
  const cmd = useCommand();
  const driver = useDriver();
  const [stage, setStage] = useState<"phone" | "otp" | "profile">("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [name, setName] = useState("");
  const [vehicles, setVehicles] = useState<Vehicle[]>([{ number: "", type: "car" }]);

  const enter = (profileName: string) => {
    cmd.login("citizen.demo");
    toast.success(`Welcome, ${profileName.split(" ")[0]}`);
    router.push("/user");
  };

  const verify = () => {
    if (driver.profile && driver.profile.phone === phone) return enter(driver.profile.name);
    setStage("profile");
  };

  const valid = name.trim().length >= 2 && vehicles.every((v) => isValidPlate(v.number)) && new Set(vehicles.map((v) => v.number)).size === vehicles.length;

  const save = () => {
    driver.saveProfile({ phone, name: name.trim(), vehicles, defaultVehicle: vehicles[0].number, createdAt: Date.now() });
    enter(name);
  };

  return (
    <PortalShell>
      <div className="mx-auto max-w-md">
        <GlassCard>
          <span className="grid size-11 place-items-center rounded-2xl border border-white/15 bg-white/10"><CarFront className="size-5" /></span>
          <AnimatePresence mode="wait">
            {stage === "phone" && (
              <motion.form key="p" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} onSubmit={(e) => { e.preventDefault(); setStage("otp"); }}>
                <h1 className="portal-title mt-4 text-3xl font-semibold">Park smarter.</h1>
                <p className="mt-1.5 text-[15px] text-slate-400">Sign in with your mobile number.</p>
                <div className="mt-6 flex gap-2">
                  <span className={cn(field, "flex w-20 shrink-0 items-center justify-center font-medium text-slate-300")}>+91</span>
                  <input autoFocus inputMode="tel" aria-label="Mobile number" placeholder="98765 43210" className={cn(field, "tracking-wide")} value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))} />
                </div>
                <button type="submit" className={cn(primaryBtn, "mt-4")} disabled={!/^[6-9]\d{9}$/.test(phone)}><Phone className="size-4" /> Send OTP</button>
                <button type="button" onClick={() => setPhone(driver.profile?.phone ?? "9876543210")} className="mt-3 w-full text-center text-xs text-sky-300 hover:text-sky-200">Use demo number</button>
              </motion.form>
            )}
            {stage === "otp" && (
              <motion.form key="o" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} onSubmit={(e) => { e.preventDefault(); verify(); }}>
                <h1 className="portal-title mt-4 text-3xl font-semibold">Enter the code</h1>
                <p className="mt-1.5 text-[15px] text-slate-400">Sent to +91 {phone.slice(0, 5)} {phone.slice(5)}. <span className="text-slate-200">Demo: 123456</span></p>
                <div className="mt-6"><OtpInput value={otp} onChange={setOtp} /></div>
                <button type="submit" className={cn(primaryBtn, "mt-4")} disabled={otp !== "123456"}><ShieldCheck className="size-4" /> Verify</button>
                <div className="mt-3 flex justify-between text-xs">
                  <button type="button" onClick={() => setStage("phone")} className="text-slate-400 hover:text-slate-200">Change number</button>
                  <button type="button" onClick={() => setOtp("123456")} className="text-sky-300 hover:text-sky-200">Autofill demo code</button>
                </div>
              </motion.form>
            )}
            {stage === "profile" && (
              <motion.form key="f" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} onSubmit={(e) => { e.preventDefault(); if (valid) save(); }}>
                <h1 className="portal-title mt-4 text-3xl font-semibold">Set up your profile</h1>
                <p className="mt-1.5 text-[15px] text-slate-400">One time. Your vehicle is matched at the gate.</p>
                <label className="mt-6 block text-xs font-medium text-slate-400">Your name<input autoFocus className={cn(field, "mt-1.5")} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ishita S" /></label>
                <p className="mt-5 text-xs font-medium text-slate-400">My vehicles</p>
                <div className="mt-1.5 space-y-2">
                  {vehicles.map((v, i) => (
                    <VehicleRow key={i} v={v} onChange={(nv) => setVehicles((all) => all.map((x, j) => (j === i ? nv : x)))} onRemove={vehicles.length > 1 ? () => setVehicles((all) => all.filter((_, j) => j !== i)) : undefined} />
                  ))}
                </div>
                {vehicles.length < 4 && (
                  <button type="button" onClick={() => setVehicles((a) => [...a, { number: "", type: "bike" }])} className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-sky-300 hover:text-sky-200"><Plus className="size-4" /> Add another vehicle</button>
                )}
                <button type="submit" className={cn(primaryBtn, "mt-6")} disabled={!valid}><Check className="size-4" /> Start parking</button>
              </motion.form>
            )}
          </AnimatePresence>
        </GlassCard>
      </div>
    </PortalShell>
  );
}

export function VehicleRow({ v, onChange, onRemove, light }: { v: Vehicle; onChange: (v: Vehicle) => void; onRemove?: () => void; light?: boolean }) {
  const ok = !v.number || isValidPlate(v.number);
  return (
    <div className="flex gap-2">
      <select
        aria-label="Vehicle type"
        value={v.type}
        onChange={(e) => onChange({ ...v, type: e.target.value as VehicleType })}
        className={cn(light ? "h-11 rounded-xl border bg-background px-2 text-sm" : cn(field, "w-32 shrink-0 px-2 text-sm"))}
      >
        {(Object.keys(VEHICLE_LABEL) as VehicleType[]).map((t) => <option key={t} value={t} className="text-slate-900">{VEHICLE_LABEL[t]}</option>)}
      </select>
      <input
        aria-label="Vehicle number"
        placeholder="TN09AB1234"
        value={v.number}
        onChange={(e) => onChange({ ...v, number: normalizePlate(e.target.value).slice(0, 12) })}
        className={cn(light ? "h-11 flex-1 rounded-xl border bg-background px-3 font-display font-bold tracking-wider" : cn(field, "font-semibold tracking-wider"), !ok && "border-rose-400/70")}
      />
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label="Remove vehicle" className={cn("grid w-11 shrink-0 place-items-center rounded-xl", light ? "border hover:bg-secondary" : "border border-white/10 text-slate-400 hover:text-rose-300")}><Trash2 className="size-4" /></button>
      )}
    </div>
  );
}
