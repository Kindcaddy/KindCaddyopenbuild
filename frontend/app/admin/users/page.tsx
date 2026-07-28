import { Search, Filter, Edit, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/AppShell";

export default function UsersManagementPage() {
  const users = [
    { id: 1, name: "John Doe", email: "john@example.com", role: "Admin", status: "Active", joined: "2024-01-15" },
    { id: 2, name: "Jane Smith", email: "jane@example.com", role: "User", status: "Active", joined: "2024-02-20" },
    { id: 3, name: "Bob Johnson", email: "bob@example.com", role: "User", status: "Inactive", joined: "2024-03-10" },
    { id: 4, name: "Alice Brown", email: "alice@example.com", role: "Moderator", status: "Active", joined: "2024-04-05" },
  ];

  return (
    <div className="kc-container py-8">
      <PageHeader
        eyebrow="Admin"
        title="User Management"
        description="Manage all platform users and their permissions"
        actions={
          <button className="kc-btn kc-btn-primary kc-btn--sm">Add User</button>
        }
      />

      {/* Search and Filter */}
      <div className="mb-6 flex items-center gap-3">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--kc-muted)]"
            strokeWidth={1.8}
            aria-hidden
          />
          <input
            type="text"
            placeholder="Search users..."
            aria-label="Search users"
            className="kc-input !pl-10"
          />
        </div>
        <button className="kc-btn kc-btn-secondary">
          <Filter className="h-4 w-4" strokeWidth={1.8} aria-hidden />
          Filter
        </button>
      </div>

      {/* Users Table */}
      <div className="kc-panel overflow-hidden">
        <div className="kc-scroll overflow-x-auto">
          <table className="kc-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Status</th>
                <th>Joined</th>
                <th className="!text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td className="whitespace-nowrap">
                    <div className="flex items-center gap-3">
                      <span className="kc-mark h-10 w-10 text-[0.72rem]" aria-hidden>
                        {user.name.split(" ").map((n) => n[0]).join("")}
                      </span>
                      <div>
                        <div className="font-medium text-[var(--kc-ink)]">
                          {user.name}
                        </div>
                        <div className="text-[var(--kc-muted)]">
                          {user.email}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="whitespace-nowrap">
                    <span className="kc-chip kc-chip--accent">{user.role}</span>
                  </td>
                  <td className="whitespace-nowrap">
                    <span
                      className={`kc-chip ${
                        user.status === "Active"
                          ? "kc-chip--sage"
                          : "kc-chip--muted"
                      }`}
                    >
                      {user.status}
                    </span>
                  </td>
                  <td className="whitespace-nowrap">
                    <span className="text-[var(--kc-muted)]">{user.joined}</span>
                  </td>
                  <td className="whitespace-nowrap text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        aria-label={`Edit ${user.name}`}
                        className="rounded-lg p-1.5 text-[var(--kc-muted)] transition-colors hover:bg-white/60 hover:text-[var(--kc-accent)]"
                      >
                        <Edit className="h-4 w-4" strokeWidth={1.8} aria-hidden />
                      </button>
                      <button
                        aria-label={`Delete ${user.name}`}
                        className="rounded-lg p-1.5 text-[var(--kc-muted)] transition-colors hover:bg-white/60 hover:text-[#8f2f1c]"
                      >
                        <Trash2 className="h-4 w-4" strokeWidth={1.8} aria-hidden />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
