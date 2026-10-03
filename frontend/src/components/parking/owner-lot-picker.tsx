"use client";

import { Select } from "@/components/ui/select";
import { useOwnedLots } from "@/hooks/use-owner-lot";

export function OwnerLotPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const owned = useOwnedLots();
  return (
    <div className="w-full sm:w-72">
      <Select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Choose a parking lot">
        {owned.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
      </Select>
    </div>
  );
}
