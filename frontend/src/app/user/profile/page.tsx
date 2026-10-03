"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogOut, Phone, Plus, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/dashboard-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { VehicleRow } from "@/components/auth/portal";
import { useLive } from "@/lib/live/provider";
import { saveAccount } from "@/lib/live/service";
import { COVER, VEHICLE_LABEL, type Vehicle } from "@/lib/live/types";
import { cn, isValidPlate } from "@/lib/utils";

export default function ProfilePage() {
  const live = useLive();
  const router = useRouter();
  const a = live.account;
  const [draft, setDraft] = useState<Vehicle>({ number: "", type: "car" });
  if (!a || !live.store) return null;
  const store = live.store;

  const save = (patch: Partial<typeof a>) => saveAccount(store, { ...a, ...patch });
  const add = async () => {
    if (!isValidPlate(draft.number)) return toast.error("Enter a valid registration like TN09AB1234");
    if (a.vehicles.some((v) => v.number === draft.number)) return toast.error("Already saved");
    await save({ vehicles: [...a.vehicles, draft] });
    toast.success(`${draft.number} added`);
    setDraft({ number: "", type: "car" });
  };

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Profile" />
      <Card className="flex items-center gap-4 p-5">
        <span className="grid size-14 place-items-center rounded-full bg-gradient-to-br from-sky-400 to-blue-600 font-display text-xl font-extrabold text-white">
          {a.name.split(" ").map((x) => x[0]).slice(0, 2).join("").toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-xl font-extrabold">{a.name}</h2>
          <p className="text-sm text-muted-foreground">@{a.username} · <Phone className="inline size-3" /> +91 {a.phone}</p>
        </div>
        <Button variant="outline" size="sm" onClick={async () => { await live.signOut(); router.replace("/login"); }}><LogOut /> Sign out</Button>
      </Card>

      <Card className="mt-4 p-5">
        <h2 className="font-display text-lg font-bold">My vehicles</h2>
        <p className="text-xs text-muted-foreground">The starred vehicle is picked first when you book.</p>
        <ul className="mt-4 space-y-2">
          {a.vehicles.map((v) => {
            const def = a.defaultVehicle === v.number;
            return (
              <li key={v.number} className={cn("flex items-center gap-3 rounded-xl border p-3", def && "border-primary bg-primary/5")}>
                <span className="rounded-md border-2 border-foreground/80 bg-white px-2 py-0.5 font-display text-sm font-extrabold tracking-wider text-slate-900">{v.number}</span>
                <span className="flex-1 text-sm text-muted-foreground">{VEHICLE_LABEL[v.type]}{a.fastag?.vehicle === v.number ? " · FASTag" : ""}</span>
                <button onClick={() => save({ defaultVehicle: v.number })} aria-label="Make default" className={cn("grid size-9 place-items-center rounded-lg hover:bg-secondary", def ? "text-amber-500" : "text-muted-foreground")}><Star className={cn("size-4", def && "fill-current")} /></button>
                <button
                  onClick={() => save({ vehicles: a.vehicles.filter((x) => x.number !== v.number), defaultVehicle: def ? a.vehicles.find((x) => x.number !== v.number)?.number : a.defaultVehicle })}
                  disabled={a.vehicles.length <= 1}
                  aria-label="Remove"
                  className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-secondary disabled:opacity-30"
                ><Trash2 className="size-4" /></button>
              </li>
            );
          })}
        </ul>
        <div className="mt-4 space-y-2 border-t pt-4">
          <p className="text-sm font-semibold">Add a vehicle</p>
          <VehicleRow v={draft} onChange={setDraft} light />
          <Button onClick={add}><Plus /> Add vehicle</Button>
        </div>
      </Card>

      <Card className="mt-4 p-5 text-sm leading-relaxed text-muted-foreground">
        <b className="text-foreground">How booking works.</b> A ₹{COVER} cover charge confirms your bay. It&apos;s adjusted against the parking fee at the exit gate.
        If you don&apos;t arrive within 15 minutes, the bay is released for others and the cover charge is kept.
      </Card>
    </div>
  );
}
