"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  User,
  Mail,
  Building2,
  Users,
  Shield,
  CheckCircle2,
  Download,
  Trash2,
  AlertTriangle,
  X,
  Loader2,
} from "lucide-react";
import { PageHeader } from "@/components/AppShell";

interface UserData {
  user: {
    id: string;
    email: string;
    name: string;
  };
  tenant: {
    id: string;
    name: string;
  };
  department: {
    id: string;
    name: string;
  };
  role: string;
  permissions: string[];
}

export default function ProfilePage() {
  const [userData, setUserData] = useState<UserData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  // ---- Data controls (export + self-service delete) ----
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDeleteAccount = async () => {
    if (!userData || deleteConfirm.trim().toLowerCase() !== userData.user.email.toLowerCase()) {
      setDeleteError("Type your email address exactly to confirm.");
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch("/api/me", { method: "DELETE" });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      // The user row is gone, so the session cookie is now invalid — clear it
      // via the logout route and land on the login page.
      await fetch("/api/logout", { method: "POST" }).catch(() => undefined);
      router.push("/login");
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete account");
      setDeleting(false);
    }
  };

  useEffect(() => {
    const fetchUserData = async () => {
      try {
        const response = await fetch("/api/me");
        if (!response.ok) {
          if (response.status === 401) {
            router.push("/login");
            return;
          }
          throw new Error("Failed to fetch user data");
        }
        const data = await response.json();
        setUserData(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred");
      } finally {
        setIsLoading(false);
      }
    };

    fetchUserData();
  }, [router]);

  // Escape closes the delete-account dialog (unless a delete is running).
  useEffect(() => {
    if (!deleteOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !deleting) setDeleteOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [deleteOpen, deleting]);

  const getInitials = (name: string): string => {
    const parts = name.trim().split(" ");
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  const getRoleColor = (role: string): string => {
    switch (role.toLowerCase()) {
      case "admin":
        return "kc-chip kc-chip--danger";
      case "employee":
        return "kc-chip kc-chip--accent";
      default:
        return "kc-chip kc-chip--muted";
    }
  };

  if (isLoading) {
    return (
      <div className="kc-container py-8">
        <div className="kc-panel p-6 sm:p-8">
          <div className="space-y-4">
            <div className="kc-skeleton h-8 w-1/3" />
            <div className="kc-skeleton h-24 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !userData) {
    return (
      <div className="kc-container py-8">
        <div className="kc-panel p-6 sm:p-8">
          <div className="py-8">
            <p className="kc-note kc-note--danger mb-4">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" strokeWidth={1.8} aria-hidden />
              {error || "Failed to load profile data"}
            </p>
            <Link
              href="/app"
              className="text-sm text-[var(--kc-accent)] hover:underline"
            >
              Return to Dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const initials = getInitials(userData.user.name);

  return (
    <div className="kc-container py-8">
      <Link
        href="/app"
        className="kc-mono mb-5 inline-flex items-center gap-2 text-[0.72rem] uppercase tracking-[0.16em] text-[var(--kc-muted)] transition-colors hover:text-[var(--kc-accent)]"
      >
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
        Back to workspace
      </Link>

      <PageHeader eyebrow="Your account" title="Profile" />

      <section
        className="kc-panel kc-rise p-6 sm:p-8"
        style={{ "--kc-delay": "0.06s" } as React.CSSProperties}
      >
        {/* Profile Picture */}
        <div className="mb-8">
          <div
            className="flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-[var(--kc-accent)] to-[var(--kc-accent-hover)] text-3xl font-bold text-white shadow-[var(--kc-glow)]"
            aria-hidden
          >
            {initials}
          </div>
        </div>

        {/* User Information */}
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div>
              <label className="kc-label mb-2">
                <User className="mr-2 inline h-3 w-3" strokeWidth={2} aria-hidden />
                Full Name
              </label>
              <div className="kc-input">
                {userData.user.name}
              </div>
            </div>

            <div>
              <label className="kc-label mb-2">
                <Mail className="mr-2 inline h-3 w-3" strokeWidth={2} aria-hidden />
                Email Address
              </label>
              <div className="kc-input">
                {userData.user.email}
              </div>
            </div>

            <div>
              <label className="kc-label mb-2">
                <Building2 className="mr-2 inline h-3 w-3" strokeWidth={2} aria-hidden />
                Tenant
              </label>
              <div className="kc-input">
                {userData.tenant.name}
              </div>
            </div>

            <div>
              <label className="kc-label mb-2">
                <Users className="mr-2 inline h-3 w-3" strokeWidth={2} aria-hidden />
                Department
              </label>
              <div className="kc-input">
                {userData.department.name}
              </div>
            </div>
          </div>

          {/* Role Badge */}
          <div>
            <label className="kc-label mb-2">
              <Shield className="mr-2 inline h-3 w-3" strokeWidth={2} aria-hidden />
              Role
            </label>
            <div className="inline-block">
              <span
                className={`capitalize ${getRoleColor(userData.role)}`}
              >
                {userData.role}
              </span>
            </div>
          </div>

          {/* Permissions */}
          <div>
            <label className="kc-label mb-3">Permissions</label>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {userData.permissions && userData.permissions.length > 0 ? (
                userData.permissions.map((permission, index) => (
                  <div
                    key={index}
                    className="kc-note kc-note--sage"
                  >
                    <CheckCircle2
                      className="h-4 w-4 flex-shrink-0 text-[var(--kc-sage)]"
                      strokeWidth={1.8}
                      aria-hidden
                    />
                    <span className="text-sm">{permission}</span>
                  </div>
                ))
              ) : (
                <p className="text-sm text-[var(--kc-muted)]">
                  No permissions assigned
                </p>
              )}
            </div>
          </div>

          {/* Your data: export + delete */}
          <div className="mt-6 border-t border-[var(--kc-line)] pt-6">
            <h2 className="kc-display mb-2 text-lg text-[var(--kc-ink)]">
              Your data
            </h2>
            <p className="mb-4 text-sm text-[var(--kc-muted)]">
              Download everything KindCaddy stores for you — every prompt and
              answer, with the model that produced each answer — or delete
              your account and all of its data.
            </p>
            <div className="flex flex-wrap gap-3">
              <a
                href="/api/me/export"
                download
                className="kc-btn kc-btn-secondary kc-btn--sm"
              >
                <Download className="h-4 w-4" strokeWidth={1.8} aria-hidden />
                Export my data (JSON)
              </a>
            </div>
          </div>

          {/* Danger zone */}
          <div className="mt-6 border-t border-[rgba(196,74,48,0.26)] pt-6">
            <h2 className="kc-display mb-2 text-lg text-[#8f2f1c]">
              Danger zone
            </h2>
            <p className="mb-4 text-sm text-[var(--kc-muted)]">
              Deleting your account permanently removes your conversations,
              memories, and workspace memberships. This cannot be undone.
            </p>
            <button
              onClick={() => {
                setDeleteOpen(true);
                setDeleteConfirm("");
                setDeleteError(null);
              }}
              className="kc-btn kc-btn-danger kc-btn--sm"
            >
              <Trash2 className="h-4 w-4" strokeWidth={1.8} aria-hidden />
              Delete my account
            </button>
          </div>
        </div>
      </section>

      {/* Portaled to <body>: this page's .kc-panel has backdrop-filter, which
          makes it the containing block for fixed-position descendants — an
          in-tree .kc-backdrop would be pinned to the panel instead of the
          viewport. kc-theme is re-applied on the backdrop because the portal
          leaves the themed subtree. */}
      {deleteOpen &&
        createPortal(
          <div
            className="kc-theme kc-backdrop"
            onClick={() => !deleting && setDeleteOpen(false)}
          >
          <div
            className="kc-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Delete account permanently?"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <AlertTriangle
                  className="h-6 w-6 flex-shrink-0 text-[#8f2f1c]"
                  strokeWidth={1.8}
                  aria-hidden
                />
                <h3 className="kc-display text-lg text-[var(--kc-ink)]">
                  Delete account permanently?
                </h3>
              </div>
              <button
                onClick={() => !deleting && setDeleteOpen(false)}
                className="-mr-1 -mt-1 rounded-full p-1.5 text-[var(--kc-muted)] transition-colors hover:bg-[rgba(31,41,36,0.06)] hover:text-[var(--kc-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--kc-accent)]"
                aria-label="Close"
              >
                <X className="h-5 w-5" strokeWidth={1.8} aria-hidden />
              </button>
            </div>
            <p className="mb-4 text-sm text-[var(--kc-muted)]">
              This deletes your profile, all conversations, saved memories, and
              memberships. Consider{" "}
              <a href="/api/me/export" download className="text-[var(--kc-accent)] hover:underline">
                exporting your data
              </a>{" "}
              first. Type{" "}
              <span className="kc-code font-semibold">
                {userData.user.email}
              </span>{" "}
              to confirm.
            </p>
            <input
              type="email"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder={userData.user.email}
              disabled={deleting}
              className="kc-input kc-input--sm mb-3"
            />
            {deleteError && (
              <p className="mb-3 text-sm text-[#8f2f1c]">
                {deleteError}
              </p>
            )}
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteOpen(false)}
                disabled={deleting}
                className="kc-btn kc-btn-secondary kc-btn--sm"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={
                  deleting ||
                  deleteConfirm.trim().toLowerCase() !==
                    userData.user.email.toLowerCase()
                }
                className="kc-btn kc-btn-danger kc-btn--sm"
              >
                {deleting && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} aria-hidden />}
                Delete forever
              </button>
            </div>
          </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
