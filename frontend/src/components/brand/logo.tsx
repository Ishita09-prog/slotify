import Link from "next/link";
import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden className={cn("size-8", className)}>
      <rect width="64" height="64" rx="16" fill="hsl(var(--primary))" />
      <path d="M22 48V16h13a10 10 0 0 1 0 20h-6v12z" fill="none" stroke="#fff" strokeWidth="6" strokeLinejoin="round" />
      <rect x="29" y="23" width="6" height="6" fill="hsl(var(--accent))" />
    </svg>
  );
}

export function Logo({ className, href = "/" }: { className?: string; href?: string }) {
  return (
    <Link href={href} className={cn("flex items-center gap-2.5", className)} aria-label="Slotify home">
      <LogoMark />
      <span className="font-display text-xl font-extrabold tracking-tight" style={{ fontVariationSettings: '"wdth" 92' }}>
        Slotify
      </span>
    </Link>
  );
}
