import AppShell from "@/components/AppShell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell variant="app">{children}</AppShell>;
}
