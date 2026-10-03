import type { Metadata } from "next";
import { CommandShell } from "@/components/command/shell";

export const metadata: Metadata = { title: "Command Centre" };

export default function CommandLayout({ children }: { children: React.ReactNode }) {
  return <CommandShell>{children}</CommandShell>;
}
