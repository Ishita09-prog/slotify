import { DashboardShell } from "@/components/layout/dashboard-shell";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <DashboardShell role="police">{children}</DashboardShell>;
}
