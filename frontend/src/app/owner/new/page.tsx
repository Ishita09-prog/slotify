"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowLeft, Check, Loader2, MapPin } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/dashboard-shell";
import { PickMap } from "@/components/map";
import { DEFAULT_WINDOWS, ModesPicker, WindowsEditor } from "@/components/owner/windows-editor";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useCity } from "@/lib/city";
import { useLive } from "@/lib/live/provider";
import { createLot } from "@/lib/live/service";
import type { TimeWindow } from "@/lib/live/types";
import type { LotCategory } from "@/lib/types";
import { cn, formatINR } from "@/lib/utils";

const CATEGORIES: { key: LotCategory; label: string }[] = [
  { key: "mall", label: "Shopping mall" },
  { key: "commercial", label: "Market / shops" },
  { key: "office", label: "IT park / office" },
  { key: "transit", label: "Metro / railway / bus" },
  { key: "hospital", label: "Hospital" },
  { key: "recreation", label: "Beach / park / theatre" },
  { key: "religious", label: "Temple / church / mosque" },
];
const FEATURES = ["Covered", "CCTV", "Security guard", "EV charging", "Valet", "24×7"];

export default function NewLotPage() {
  const { city } = useCity();
  const live = useLive();
  const router = useRouter();
  const places = useMemo(() => city.commandZones.flatMap((z) => z.localities.map((l) => ({ ...l, zone: z.name }))), [city]);

  const [placeId, setPlaceId] = useState(places[0]?.id ?? "");
  const place = places.find((p) => p.id === placeId) ?? places[0];
  const [pos, setPos] = useState({ lat: place.lat, lng: place.lng });
  const [fly, setFly] = useState<{ lat: number; lng: number } | null>(null);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [category, setCategory] = useState<LotCategory>("mall");
  const [price, setPrice] = useState(40);
  const [ev, setEv] = useState(20);
  const [rows, setRows] = useState(2);
  const [perRow, setPerRow] = useState(8);
  const [evBays, setEvBays] = useState(2);
  const [accBays, setAccBays] = useState(1);
  const [bikes, setBikes] = useState(6);
  const [bikePrice, setBikePrice] = useState(15);
  const [modes, setModes] = useState({ allowTimed: true, allowOpen: true });
  const [windows, setWindows] = useState<TimeWindow[]>(DEFAULT_WINDOWS);
  const [hours, setHours] = useState("08:00 – 23:00");
  const [features, setFeatures] = useState<string[]>(["CCTV"]);
  const [busy, setBusy] = useState(false);

  const total = rows * perRow;
  const valid = name.trim().length >= 3 && total > 0 && total <= 300 && price > 0 && (!modes.allowTimed || windows.length > 0) && evBays + accBays <= total;

  const pickPlace = (id: string) => {
    setPlaceId(id);
    const p = places.find((x) => x.id === id);
    if (p) {
      setPos({ lat: p.lat, lng: p.lng });
      setFly({ lat: p.lat, lng: p.lng });
    }
  };

  const save = async () => {
    if (!live.store || !live.account) return;
    setBusy(true);
    try {
      const lot = await createLot(
        live.store,
        live.account,
        {
          name: name.trim(),
          category,
          area: place.name,
          zone: place.zone,
          address: address.trim() || `${place.name}, ${place.zone}, Chennai`,
          lat: pos.lat,
          lng: pos.lng,
          pricePerHour: price,
          evPerHour: ev,
          bikePerHour: bikePrice,
          allowOpen: modes.allowOpen,
          allowTimed: modes.allowTimed,
          windows: modes.allowTimed ? windows : [],
          openHours: hours,
          features: evBays > 0 && !features.includes("EV charging") ? [...features, "EV charging"] : features,
        },
        { rows, perRow, ev: evBays, accessible: accBays, bikes }
      );
      toast.success(`${lot.name} is live with ${total} bays`);
      router.replace(`/owner/lot?id=${lot.id}`);
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <>
      <Link href="/owner" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> My locations</Link>
      <PageHeader title="Add a parking location" description="Drivers see it the moment you publish." />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-4">
          <Card className="p-5">
            <h2 className="font-display text-lg font-bold">1 · Where is it?</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="lname">Parking name</Label>
                <Input id="lname" placeholder="e.g. Phoenix Mall Basement P2" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="area">Area</Label>
                <Select id="area" value={placeId} onChange={(e) => pickPlace(e.target.value)}>
                  {city.commandZones.map((z) => (
                    <optgroup key={z.id} label={z.name}>
                      {z.localities.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </optgroup>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="addr">Address (optional)</Label>
                <Input id="addr" placeholder={`${place.name}, ${place.zone}, Chennai`} value={address} onChange={(e) => setAddress(e.target.value)} />
              </div>
            </div>
            <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground"><MapPin className="size-3.5" /> Tap the map (or drag the pin) to mark the entrance.</p>
            <div className="mt-2 h-72 overflow-hidden rounded-xl border">
              <PickMap value={pos} onPick={setPos} flyTo={fly} />
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="font-display text-lg font-bold">2 · How do drivers book?</h2>
            <div className="mt-4"><ModesPicker allowTimed={modes.allowTimed} allowOpen={modes.allowOpen} onChange={setModes} /></div>
            {modes.allowTimed && (
              <div className="mt-4">
                <p className="mb-2 text-sm font-semibold">Your time slots</p>
                <WindowsEditor windows={windows} onChange={setWindows} pricePerHour={price} />
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-4 xl:sticky xl:top-24 xl:self-start">
          <Card className="p-5">
            <h2 className="font-display text-lg font-bold">3 · Bays & price</h2>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Num label="Rows" value={rows} set={setRows} min={1} max={12} />
              <Num label="Bays per row" value={perRow} set={setPerRow} min={1} max={30} />
              <Num label="EV bays" value={evBays} set={setEvBays} min={0} max={total} />
              <Num label="Accessible bays" value={accBays} set={setAccBays} min={0} max={total} />
              <Num label="Price / hour (₹)" value={price} set={setPrice} min={5} max={500} />
              <Num label="EV charge / hour (₹)" value={ev} set={setEv} min={0} max={200} />
              <Num label="Two-wheeler bays" value={bikes} set={setBikes} min={0} max={48} />
              <Num label="Bike price / hour (₹)" value={bikePrice} set={setBikePrice} min={0} max={200} />
            </div>
            <div className="mt-3 space-y-1.5">
              <Label htmlFor="hours">Open hours</Label>
              <Input id="hours" value={hours} onChange={(e) => setHours(e.target.value)} />
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {FEATURES.map((f) => (
                <button key={f} type="button" onClick={() => setFeatures((a) => (a.includes(f) ? a.filter((x) => x !== f) : [...a, f]))} className={cn("rounded-full border px-3 py-1 text-xs font-semibold", features.includes(f) ? "border-primary bg-primary/15 text-primary" : "text-muted-foreground")}>
                  {f}
                </button>
              ))}
            </div>
            <div className="mt-4 rounded-xl bg-secondary/50 p-3 text-sm">
              <p><b className="font-display text-2xl">{total}</b> car bays{bikes ? <> + <b className="font-display text-2xl">{bikes}</b> 🛵</> : null} · {category && CATEGORIES.find((c) => c.key === category)?.label}</p>
              <p className="text-xs text-muted-foreground">{formatINR(price)}/h car · {formatINR(bikePrice)}/h bike · cover ₹25 car / ₹10 bike · {[modes.allowTimed && "time slots", modes.allowOpen && "no time limit"].filter(Boolean).join(" + ")}</p>
            </div>
            <div className="mt-3 space-y-1.5">
              <Label htmlFor="cat">Type of place (used by the AI forecast)</Label>
              <Select id="cat" value={category} onChange={(e) => setCategory(e.target.value as LotCategory)}>
                {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </Select>
            </div>
            <Button size="lg" className="mt-5 w-full" disabled={!valid || busy} onClick={save}>
              {busy ? <Loader2 className="animate-spin" /> : <Check />} Publish to drivers
            </Button>
          </Card>
        </div>
      </div>
    </>
  );
}

function Num({ label, value, set, min, max }: { label: string; value: number; set: (n: number) => void; min: number; max: number }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <div className="flex h-10 items-center rounded-lg border">
        <button type="button" className="h-full w-9 text-lg text-muted-foreground hover:text-foreground" onClick={() => set(Math.max(min, value - 1))} aria-label={`Less ${label}`}>−</button>
        <input aria-label={label} inputMode="numeric" className="h-full w-full min-w-0 bg-transparent text-center font-semibold tabular-nums outline-none" value={value} onChange={(e) => set(Math.min(max, Math.max(min, Number(e.target.value.replace(/\D/g, "")) || 0)))} />
        <button type="button" className="h-full w-9 text-lg text-muted-foreground hover:text-foreground" onClick={() => set(Math.min(max, value + 1))} aria-label={`More ${label}`}>+</button>
      </div>
    </div>
  );
}
