import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

type Tone = "default" | "available" | "occupied" | "reserved" | "primary" | "accent";

const toneMap: Record<Tone, string> = {
  default: "bg-secondary text-foreground",
  available: "bg-status-available/15 text-status-available",
  occupied: "bg-status-occupied/15 text-status-occupied",
  reserved: "bg-status-reserved/20 text-[hsl(40_90%_32%)] dark:text-status-reserved",
  primary: "bg-primary/15 text-primary",
  accent: "bg-accent/20 text-[hsl(40_80%_30%)] dark:text-accent",
};

export function StatCard({
  label, value, sub, icon: Icon, tone = "default", className,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon: React.ElementType;
  tone?: Tone;
  className?: string;
}) {
  return (
    <Card className={cn("p-4", className)}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">{label}</p>
        <span className={cn("grid size-8 place-items-center rounded-lg", toneMap[tone])}>
          <Icon className="size-4" />
        </span>
      </div>
      <p className="mt-2 font-display text-2xl font-extrabold tabular-nums sm:text-3xl">{value}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </Card>
  );
}
