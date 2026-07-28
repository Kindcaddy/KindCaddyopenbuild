import Link from "next/link";
import { Users, DollarSign, Activity, Shield } from "lucide-react";
import { PageHeader } from "@/components/AppShell";

export default function AdminDashboard() {
  return (
    <div className="kc-container py-8">
      <PageHeader
        eyebrow="Admin"
        title="Admin Dashboard"
        description="Manage your platform and monitor system health"
      />

      {/* Stats Grid */}
      <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-4">
        <div
          className="kc-panel kc-rise p-5"
          style={{ "--kc-delay": "0.04s" } as React.CSSProperties}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="kc-label">Total Revenue</p>
              <p className="kc-display mt-2 text-[1.8rem] leading-none text-[var(--kc-ink)]">
                $125,431
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
          style={{ "--kc-delay": "0.09s" } as React.CSSProperties}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="kc-label">Total Users</p>
              <p className="kc-display mt-2 text-[1.8rem] leading-none text-[var(--kc-ink)]">
                8,350
              </p>
              <p className="mt-2 text-sm text-[var(--kc-sage)]">
                +180 new users
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
          style={{ "--kc-delay": "0.14s" } as React.CSSProperties}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="kc-label">Active Sessions</p>
              <p className="kc-display mt-2 text-[1.8rem] leading-none text-[var(--kc-ink)]">
                1,234
              </p>
              <p className="mt-2 text-sm text-[var(--kc-muted)]">
                Currently online
              </p>
            </div>
            <span className="grid h-11 w-11 flex-none place-items-center rounded-[14px] border border-[rgba(187,106,69,0.28)] bg-[rgba(241,216,197,0.6)]">
              <Activity
                className="h-5 w-5 text-[var(--kc-accent)]"
                strokeWidth={1.8}
                aria-hidden
              />
            </span>
          </div>
        </div>

        <div
          className="kc-panel kc-rise p-5"
          style={{ "--kc-delay": "0.19s" } as React.CSSProperties}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="kc-label">System Health</p>
              <p className="kc-display mt-2 text-[1.8rem] leading-none text-[var(--kc-ink)]">
                99.9%
              </p>
              <p className="mt-2 text-sm text-[var(--kc-sage)]">
                All systems operational
              </p>
            </div>
            <span className="grid h-11 w-11 flex-none place-items-center rounded-[14px] border border-[rgba(103,121,95,0.28)] bg-[rgba(216,224,210,0.6)]">
              <Shield
                className="h-5 w-5 text-[var(--kc-sage)]"
                strokeWidth={1.8}
                aria-hidden
              />
            </span>
          </div>
        </div>
      </div>

      {/* Two Column Layout */}
      <div className="mb-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Recent Users */}
        <section
          className="kc-panel kc-rise overflow-hidden"
          style={{ "--kc-delay": "0.24s" } as React.CSSProperties}
        >
          <div className="kc-panel-head">
            <h2 className="kc-panel-title">Recent Users</h2>
            <Link
              href="/admin/users"
              className="text-sm font-semibold text-[var(--kc-accent)] transition-colors hover:text-[var(--kc-accent-hover)]"
            >
              View all
            </Link>
          </div>
          <div className="p-2">
            {[
              { name: "Sarah Johnson", email: "sarah@example.com", time: "2 min ago" },
              { name: "Mike Chen", email: "mike@example.com", time: "15 min ago" },
              { name: "Emily Davis", email: "emily@example.com", time: "1 hour ago" },
            ].map((user, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between gap-3 border-b border-[var(--kc-line)] px-3 py-3 last:border-0"
              >
                <div className="flex items-center gap-3">
                  <span className="kc-mark h-10 w-10 text-[0.72rem]" aria-hidden>
                    {user.name.split(" ").map((n) => n[0]).join("")}
                  </span>
                  <div>
                    <p className="font-medium text-[var(--kc-ink)]">
                      {user.name}
                    </p>
                    <p className="text-sm text-[var(--kc-muted)]">
                      {user.email}
                    </p>
                  </div>
                </div>
                <span className="kc-mono text-[0.68rem] uppercase tracking-[0.12em] text-[var(--kc-muted)]">
                  {user.time}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* System Alerts */}
        <section
          className="kc-panel kc-rise overflow-hidden"
          style={{ "--kc-delay": "0.29s" } as React.CSSProperties}
        >
          <div className="kc-panel-head">
            <h2 className="kc-panel-title">System Alerts</h2>
          </div>
          <div className="space-y-3 p-4">
            <div className="kc-note kc-note--sage">
              <span
                className="mt-1.5 h-2 w-2 flex-none rounded-full bg-[var(--kc-sage)]"
                aria-hidden
              />
              <div className="flex-1">
                <p className="font-medium text-[var(--kc-ink)]">
                  Backup completed successfully
                </p>
                <p className="text-sm text-[var(--kc-muted)]">5 minutes ago</p>
              </div>
            </div>
            <div className="kc-note kc-note--accent">
              <span
                className="mt-1.5 h-2 w-2 flex-none rounded-full bg-[var(--kc-accent)]"
                aria-hidden
              />
              <div className="flex-1">
                <p className="font-medium text-[var(--kc-ink)]">
                  High API usage detected
                </p>
                <p className="text-sm text-[var(--kc-muted)]">1 hour ago</p>
              </div>
            </div>
            <div className="kc-note">
              <span
                className="mt-1.5 h-2 w-2 flex-none rounded-full bg-[var(--kc-muted)]"
                aria-hidden
              />
              <div className="flex-1">
                <p className="font-medium text-[var(--kc-ink)]">
                  New feature deployed
                </p>
                <p className="text-sm text-[var(--kc-muted)]">2 hours ago</p>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Recent Activity */}
      <section
        className="kc-panel kc-rise overflow-hidden"
        style={{ "--kc-delay": "0.34s" } as React.CSSProperties}
      >
        <div className="kc-panel-head">
          <h2 className="kc-panel-title">Recent Activity</h2>
        </div>
        <div className="p-2">
          {[
            { action: "New user registered", type: "User", time: "2 minutes ago" },
            { action: "Payment received - $299", type: "Payment", time: "15 minutes ago" },
            { action: "System update completed", type: "System", time: "1 hour ago" },
            { action: "Security audit completed", type: "Security", time: "3 hours ago" },
          ].map((activity, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between gap-3 border-b border-[var(--kc-line)] px-3 py-3 last:border-0"
            >
              <div>
                <p className="font-medium text-[var(--kc-ink)]">
                  {activity.action}
                </p>
                <p className="text-sm text-[var(--kc-muted)]">
                  {activity.time}
                </p>
              </div>
              <span className="kc-chip kc-chip--muted">{activity.type}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
