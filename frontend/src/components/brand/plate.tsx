import { cn, normalizePlate } from "@/lib/utils";

/** Formats TN38AB1234 as "TN 38 AB 1234" on an HSRP-style plate. */
export function formatPlate(v: string) {
  const p = normalizePlate(v);
  const m = p.match(/^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{4})$/);
  return m ? [m[1], m[2], m[3], m[4]].filter(Boolean).join(" ") : p;
}

export function Plate({ value, className }: { value: string; className?: string }) {
  return <span className={cn("plate", className)}>{formatPlate(value)}</span>;
}
