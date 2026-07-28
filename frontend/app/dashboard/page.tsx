import Link from "next/link";
import { Sparkles, Bell, Search, TrendingUp, Users, DollarSign, Activity } from "lucide-react";

export default function DashboardPage() {
  return (
    <div className="kc-theme kc-canvas relative min-h-screen overflow-hidden">
      <div
        aria-hidden
        className="kc-orbit -right-[24vw] -top-[46vh] w-[min(820px,120vw)]"
      />
      <div
        aria-hidden
        className="kc-orbit kc-orbit--sage -bottom-[42vh] -left-[26vw] w-[min(680px,108vw)]"
      />

      {/* Navigation */}
      <nav className="kc-appbar">
        <div className="kc-container flex h-16 items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <span className="kc-mark h-9 w-9 text-[0.78rem]" aria-hidden>
              KC
            </span>
            <span className="kc-display text-[1.1rem] leading-none">
              KindCaddy
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              aria-label="Search"
              className="rounded-full p-2 text-[var(--kc-muted)] transition-colors hover:bg-white/60 hover:text-[var(--kc-ink)]"
            >
              <Search className="h-5 w-5" strokeWidth={1.8} aria-hidden />
            </button>
            <button
              aria-label="Notifications"
              className="relative rounded-full p-2 text-[var(--kc-muted)] transition-colors hover:bg-white/60 hover:text-[var(--kc-ink)]"
            >
              <Bell className="h-5 w-5" strokeWidth={1.8} aria-hidden />
              <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-[var(--kc-accent)]"></span>
            </button>
            <span className="kc-mark ml-1 h-9 w-9 text-[0.78rem]" aria-hidden>
              JD
            </span>
          </div>
        </div>
      </nav>

      {/* Sidebar & Main Content */}
      <div className="relative z-10 flex">
        {/* Sidebar */}
        <aside className="w-64 min-h-[calc(100vh-4rem)] border-r border-[var(--kc-line)] bg-white/45 backdrop-blur">
          <nav className="flex flex-col gap-1 p-4">
            <Link
              href="/dashboard"
              className="kc-nav-link"
              aria-current="page"
            >
              <Activity className="h-4 w-4" strokeWidth={1.8} aria-hidden />
              Dashboard
            </Link>
            <Link href="/dashboard/analytics" className="kc-nav-link">
              <TrendingUp className="h-4 w-4" strokeWidth={1.8} aria-hidden />
              Analytics
            </Link>
            <Link href="/dashboard/users" className="kc-nav-link">
              <Users className="h-4 w-4" strokeWidth={1.8} aria-hidden />
              Users
            </Link>
            <Link href="/dashboard/settings" className="kc-nav-link">
              <Sparkles className="h-4 w-4" strokeWidth={1.8} aria-hidden />
              Settings
            </Link>
          </nav>
        </aside>

        {/* Main Content */}
        <main className="flex-1 p-8">
          <div className="mx-auto max-w-7xl">
            <h1 className="kc-title kc-rise mb-8">Dashboard</h1>

            {/* Stats Grid */}
            <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-3">
              <div
                className="kc-panel kc-rise p-5"
                style={{ "--kc-delay": "0.05s" } as React.CSSProperties}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="kc-label">Total Revenue</p>
                    <p className="kc-display mt-2 text-[1.8rem] leading-none text-[var(--kc-ink)]">
                      $45,231
                    </p>
                    <p className="mt-2 text-sm text-[var(--kc-sage)]">
                      +20.1% from last month
                    </p>
                  </div>
                  <span className="grid h-11 w-11 flex-none place-items-center rounded-[14px] border border-[rgba(103,121,95,0.28)] bg-[rgba(216,224,210,0.6)]">
                    <DollarSign
                      className="h-5 w-5 text-[var(--kc-sage)]"
                      strokeWidth={1.8}
                      aria-hidden
                    />
                  </span>
                </div>
              </div>

              <div
                className="kc-panel kc-rise p-5"
                style={{ "--kc-delay": "0.1s" } as React.CSSProperties}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="kc-label">Active Users</p>
                    <p className="kc-display mt-2 text-[1.8rem] leading-none text-[var(--kc-ink)]">
                      2,350
                    </p>
                    <p className="mt-2 text-sm text-[var(--kc-sage)]">
                      +180.1% from last month
                    </p>
                  </div>
                  <span className="grid h-11 w-11 flex-none place-items-center rounded-[14px] border border-[rgba(187,106,69,0.28)] bg-[rgba(241,216,197,0.6)]">
                    <Users
                      className="h-5 w-5 text-[var(--kc-accent)]"
                      strokeWidth={1.8}
                      aria-hidden
                    />
                  </span>
                </div>
              </div>

              <div
                className="kc-panel kc-rise p-5"
                style={{ "--kc-delay": "0.15s" } as React.CSSProperties}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="kc-label">Growth Rate</p>
                    <p className="kc-display mt-2 text-[1.8rem] leading-none text-[var(--kc-ink)]">
                      12.5%
                    </p>
                    <p className="mt-2 text-sm text-[var(--kc-sage)]">
                      +2.4% from last month
                    </p>
                  </div>
                  <span className="grid h-11 w-11 flex-none place-items-center rounded-[14px] border border-[rgba(187,106,69,0.28)] bg-[rgba(241,216,197,0.6)]">
                    <TrendingUp
                      className="h-5 w-5 text-[var(--kc-accent)]"
                      strokeWidth={1.8}
                      aria-hidden
                    />
                  </span>
                </div>
              </div>
            </div>

            {/* Recent Activity */}
            <section
              className="kc-panel kc-rise overflow-hidden"
              style={{ "--kc-delay": "0.2s" } as React.CSSProperties}
            >
              <div className="kc-panel-head">
                <h2 className="kc-panel-title">Recent Activity</h2>
              </div>
              <div className="p-2">
                <div className="flex items-center justify-between gap-3 border-b border-[var(--kc-line)] px-3 py-3">
                  <div>
                    <p className="font-medium text-[var(--kc-ink)]">
                      New user registered
                    </p>
                    <p className="text-sm text-[var(--kc-muted)]">
                      2 minutes ago
                    </p>
                  </div>
                  <span className="kc-chip kc-chip--sage">User</span>
                </div>
                <div className="flex items-center justify-between gap-3 border-b border-[var(--kc-line)] px-3 py-3">
                  <div>
                    <p className="font-medium text-[var(--kc-ink)]">
                      Payment received
                    </p>
                    <p className="text-sm text-[var(--kc-muted)]">
                      15 minutes ago
                    </p>
                  </div>
                  <span className="kc-chip kc-chip--accent">Payment</span>
                </div>
                <div className="flex items-center justify-between gap-3 px-3 py-3">
                  <div>
                    <p className="font-medium text-[var(--kc-ink)]">
                      System update completed
                    </p>
                    <p className="text-sm text-[var(--kc-muted)]">1 hour ago</p>
                  </div>
                  <span className="kc-chip kc-chip--muted">System</span>
                </div>
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
