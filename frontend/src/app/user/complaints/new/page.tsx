"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/dashboard-shell";
import { EvidencePicker } from "@/components/live/complaint-ui";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { fileComplaint } from "@/lib/live/complaint-service";
import { COMPLAINT_TYPES, TYPE_LABEL, type Attachment, type ComplaintType } from "@/lib/live/complaints";
import { useLive } from "@/lib/live/provider";
import { useDriverLots } from "@/lib/live/public";

const IST = 5.5 * 3600_000;
const toInput = (t: number) => new Date(t + IST).toISOString().slice(0, 16);
const fromInput = (v: string) => Date.parse(`${v}:00+05:30`);

export default function NewComplaint() {
  const live = useLive();
  const router = useRouter();
  const dl = useDriverLots();
  const debits = useMemo(() => live.txns.filter((t) => t.kind === "debit"), [live.txns]);
  const [txnId, setTxnId] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [lotId, setLotId] = useState("");
  const [when, setWhen] = useState(toInput(Date.now() - 3600_000));
  const [type, setType] = useState<ComplaintType | "">("");
  const [desc, setDesc] = useState("");
  const [files, setFiles] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const vehicles = live.account?.vehicles ?? [];
  const vehicleNo = vehicle || live.account?.defaultVehicle || vehicles[0]?.number || "";

  // Pick a recent FASTag deduction to pre-fill the form (the driver can still edit everything).
  const pickTxn = (id: string) => {
    setTxnId(id);
    const t = debits.find((x) => x.id === id);
    if (!t) return;
    setWhen(toInput(t.at));
    const hit = dl.lots.find((l) => t.desc.includes(l.name));
    if (hit) setLotId(hit.id);
  };

  const submit = async () => {
    const lot = dl.lots.find((l) => l.id === lotId);
    if (!live.store || !live.account || !lot) return toast.error("Choose the parking location.");
    setBusy(true);
    try {
      const c = await fileComplaint(live.store, live.account, {
        lot: { id: lot.id, name: lot.name, area: lot.area, ownerUid: lot.ownerUid },
        transactionId: txnId, vehicleNumber: vehicleNo, incidentAt: fromInput(when), complaintType: type as ComplaintType, description: desc, attachments: files,
      });
      toast.success(`Complaint ${c.complaintId} submitted`);
      router.push(`/user/complaints/view?id=${c.id}`);
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  };

  const ready = txnId.trim() && vehicleNo && lotId && when && type && desc.trim().length >= 10;
  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/user/complaints" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Fraud complaints</Link>
      <PageHeader title="File a fraud complaint" description="For a FASTag charge you didn't cause, such as a cloned number plate or a vehicle that was never yours." />
      <Card className="space-y-4 p-5">
        {debits.length > 0 && (
          <div className="space-y-1.5">
            <Label htmlFor="recent">Pick from your recent FASTag deductions</Label>
            <Select id="recent" value={debits.some((d) => d.id === txnId) ? txnId : ""} onChange={(e) => pickTxn(e.target.value)}>
              <option value="">Choose a deduction (or type the ID below)</option>
              {debits.slice(0, 15).map((t) => <option key={t.id} value={t.id}>{t.id} · ₹{t.amount} · {t.desc.slice(0, 40)}</option>)}
            </Select>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="txn">Transaction ID</Label>
          <Input id="txn" placeholder="e.g. TX-ABCD1234" value={txnId} onChange={(e) => setTxnId(e.target.value)} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="veh">Vehicle number</Label>
            <Select id="veh" value={vehicleNo} onChange={(e) => setVehicle(e.target.value)}>
              {vehicles.map((v) => <option key={v.number} value={v.number}>{v.number}</option>)}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="when">Date &amp; time</Label>
            <Input id="when" type="datetime-local" value={when} max={toInput(Date.now())} onChange={(e) => setWhen(e.target.value)} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="loc">Parking location</Label>
          <Select id="loc" value={lotId} onChange={(e) => setLotId(e.target.value)}>
            <option value="">Choose the parking lot you were charged at</option>
            {dl.lots.map((l) => <option key={l.id} value={l.id}>{l.name} · {l.area}</option>)}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="type">Complaint type</Label>
          <Select id="type" value={type} onChange={(e) => setType(e.target.value as ComplaintType)}>
            <option value="">Choose a type</option>
            {COMPLAINT_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="desc">Additional description</Label>
          <textarea id="desc" rows={4} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="What happened? Where were you at that time?" className="w-full rounded-lg border border-input bg-background/60 px-3 py-2 text-sm placeholder:text-muted-foreground" />
        </div>
        <div className="space-y-1.5">
          <Label>Evidence (optional)</Label>
          <EvidencePicker value={files} onChange={setFiles} />
        </div>
        <div className="flex gap-2 pt-1">
          <Button variant="outline" className="flex-1" asChild><Link href="/user/complaints">Cancel</Link></Button>
          <Button className="flex-1" disabled={!ready || busy} onClick={() => void submit()}>{busy && <Loader2 className="animate-spin" />} Submit Complaint</Button>
        </div>
      </Card>
    </div>
  );
}
