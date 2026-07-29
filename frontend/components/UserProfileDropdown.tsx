"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  User,
  LogOut,
  Settings,
  ChevronDown,
  Shield,
  UserPlus,
  X,
  Copy,
  Check,
  Loader2,
  LifeBuoy,
} from "lucide-react";
import Link from "next/link";

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

interface InviteItem {
  id: string;
  email: string;
  url: string;
  expiresAt: string;
  acceptedAt: string | null;
  expired: boolean;
  createdAt: string;
}

export default function UserProfileDropdown() {
  const [isOpen, setIsOpen] = useState(false);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // ---- Send invite modal state ----
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteList, setInviteList] = useState<InviteItem[]>([]);
  const [inviteListLoading, setInviteListLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const loadInvites = useCallback(async () => {
    setInviteListLoading(true);
    try {
      const res = await fetch("/api/invites", { cache: "no-store" });
      if (res.ok) {
        const j = (await res.json()) as { invites: InviteItem[] };
        setInviteList(j.invites);
      }
    } finally {
      setInviteListLoading(false);
    }
  }, []);

  const openInviteModal = useCallback(() => {
    setIsOpen(false);
    setInviteOpen(true);
    setInviteError(null);
    void loadInvites();
  }, [loadInvites]);

  const sendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = inviteEmail.trim();
    if (!email || inviteSending) return;
    setInviteSending(true);
    setInviteError(null);
    try {
      const res = await fetch("/api/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        invite?: InviteItem;
        message?: string;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(j.message ?? j.error ?? `HTTP ${res.status}`);
      }
      setInviteEmail("");
      await loadInvites();
      if (j.invite) {
        await copyInviteLink(j.invite);
      }
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Failed to send invite");
    } finally {
      setInviteSending(false);
    }
  };

  const copyInviteLink = async (invite: InviteItem) => {
    try {
      await navigator.clipboard.writeText(invite.url);
      setCopiedId(invite.id);
      setTimeout(() => setCopiedId((prev) => (prev === invite.id ? null : prev)), 2000);
    } catch {
      // Clipboard unavailable (non-secure context) — the link stays visible
      // for manual selection.
    }
  };

  useEffect(() => {
    // Fetch user data
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

  // Handle click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  // Escape closes the invite modal (part of the "user can always exit"
  // contract alongside the X button and the backdrop click).
  useEffect(() => {
    if (!inviteOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setInviteOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [inviteOpen]);

  const handleLogout = async () => {
    try {
      const response = await fetch("/api/logout", {
        method: "POST",
      });

      if (response.ok) {
        router.push("/login");
      } else {
        console.error("Logout failed");
      }
    } catch (err) {
      console.error("Logout error:", err);
    }
  };

  const getInitials = (name: string): string => {
    const parts = name.trim().split(" ");
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  if (isLoading) {
    return <div className="kc-skeleton h-9 w-9 !rounded-full" />;
  }

  if (error || !userData) {
    return (
      <div className="flex h-9 w-9 items-center justify-center rounded-full border border-[rgba(196,74,48,0.3)] bg-[rgba(196,74,48,0.1)] text-xs font-bold text-[#8f2f1c]">
        !
      </div>
    );
  }

  const initials = getInitials(userData.user.name);
  const menuItemClass =
    "flex w-full items-center gap-3 px-4 py-2.5 text-sm text-[var(--kc-text)] transition-colors hover:bg-[rgba(241,216,197,0.4)] hover:text-[var(--kc-ink)]";

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--kc-ring)]"
        aria-label="User menu"
        aria-expanded={isOpen}
      >
        <span className="kc-mark h-9 w-9 !text-[0.72rem]">{initials}</span>
        <ChevronDown
          className={`h-4 w-4 text-[var(--kc-muted)] transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
          strokeWidth={1.8}
        />
      </button>

      {isOpen && (
        <div className="kc-rise absolute right-0 z-50 mt-2 w-72 overflow-hidden rounded-[18px] border border-[var(--kc-line)] bg-[#fffdf9] shadow-[var(--kc-shadow)]">
          <div className="border-b border-[var(--kc-line)] px-4 py-3.5">
            <div className="flex items-center gap-3">
              <span className="kc-mark h-10 w-10 !text-[0.8rem]">{initials}</span>
              <div className="min-w-0 flex-1">
                <p className="kc-display truncate text-[0.95rem]">
                  {userData.user.name}
                </p>
                <p className="truncate text-xs text-[var(--kc-muted)]">
                  {userData.user.email}
                </p>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <span className="kc-chip kc-chip--accent !text-[0.66rem]">
                    {userData.tenant.name}
                  </span>
                  <span className="kc-chip kc-chip--sage !text-[0.66rem] capitalize">
                    {userData.role}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="py-1">
            <Link
              href="/app/profile"
              onClick={() => setIsOpen(false)}
              className={menuItemClass}
            >
              <User className="h-4 w-4 text-[var(--kc-muted)]" strokeWidth={1.8} />
              Profile
            </Link>
            <Link
              href="/app/system-settings"
              onClick={() => setIsOpen(false)}
              className={menuItemClass}
            >
              <Settings
                className="h-4 w-4 text-[var(--kc-muted)]"
                strokeWidth={1.8}
              />
              System Settings
            </Link>
            <button onClick={openInviteModal} className={menuItemClass}>
              <UserPlus
                className="h-4 w-4 text-[var(--kc-muted)]"
                strokeWidth={1.8}
              />
              Send invite
            </button>
            {userData.role === "admin" && (
              <Link
                href="/app/access-control"
                onClick={() => setIsOpen(false)}
                className={menuItemClass}
              >
                <Shield
                  className="h-4 w-4 text-[var(--kc-muted)]"
                  strokeWidth={1.8}
                />
                Access Control
              </Link>
            )}
            <a
              href="mailto:customersupport@kindcaddy.com?subject=KindCaddy%20support%20request"
              onClick={() => setIsOpen(false)}
              className={menuItemClass}
            >
              <LifeBuoy
                className="h-4 w-4 text-[var(--kc-muted)]"
                strokeWidth={1.8}
              />
              Contact support
            </a>
            <div className="my-1 h-px bg-[var(--kc-line)]" />
            <button
              onClick={handleLogout}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-[#8f2f1c] transition-colors hover:bg-[rgba(196,74,48,0.08)]"
            >
              <LogOut className="h-4 w-4" strokeWidth={1.8} />
              Logout
            </button>
          </div>
        </div>
      )}

      {/* Portaled to <body>: .kc-appbar's backdrop-filter makes it the
          containing block for fixed-position descendants, which pinned this
          modal's backdrop to the 64px app bar strip (modal rendered off the
          top of the screen, no clickable outside area). Escaping the appbar
          subtree restores viewport-centering and backdrop-click dismissal. */}
      {inviteOpen &&
        createPortal(
          <div
            className="kc-theme kc-backdrop !z-[60]"
            onClick={() => setInviteOpen(false)}
          >
            <div
              className="kc-modal"
              role="dialog"
              aria-modal="true"
              aria-label="Invite an employee"
              onClick={(e) => e.stopPropagation()}
            >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <span className="kc-eyebrow">Invite</span>
                <h2 className="kc-display mt-2 text-[1.25rem]">
                  Invite an employee
                </h2>
              </div>
              <button
                onClick={() => setInviteOpen(false)}
                className="rounded-full p-1 text-[var(--kc-muted)] transition-colors hover:bg-[rgba(31,41,36,0.06)] hover:text-[var(--kc-ink)]"
                aria-label="Close"
              >
                <X className="h-5 w-5" strokeWidth={1.8} />
              </button>
            </div>

            <p className="mb-4 text-sm text-[var(--kc-muted)]">
              They&apos;ll join{" "}
              <span className="font-semibold text-[var(--kc-ink)]">
                {userData.tenant.name}
              </span>{" "}
              as an employee when they sign up through your link.
            </p>

            <form onSubmit={sendInvite} className="flex gap-2">
              <input
                type="email"
                required
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="teammate@company.com"
                className="kc-input kc-input--sm flex-1"
                disabled={inviteSending}
              />
              <button
                type="submit"
                disabled={inviteSending || !inviteEmail.trim()}
                className="kc-btn kc-btn-primary kc-btn--sm"
              >
                {inviteSending && <Loader2 className="h-4 w-4 animate-spin" />}
                Send invite
              </button>
            </form>

            {inviteError && (
              <div className="kc-note kc-note--danger mt-3">{inviteError}</div>
            )}

            <div className="mt-5">
              <h3 className="kc-label mb-2">Your invite links</h3>
              {inviteListLoading ? (
                <div className="flex items-center gap-2 py-2 text-sm text-[var(--kc-muted)]">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading…
                </div>
              ) : inviteList.length === 0 ? (
                <p className="py-1 text-sm text-[var(--kc-muted)]">
                  No invites yet.
                </p>
              ) : (
                <ul className="kc-scroll max-h-56 space-y-2 overflow-y-auto">
                  {inviteList.map((invite) => {
                    const status = invite.acceptedAt
                      ? "Accepted"
                      : invite.expired
                        ? "Expired"
                        : "Pending";
                    const statusClass = invite.acceptedAt
                      ? "kc-chip--sage"
                      : invite.expired
                        ? "kc-chip--muted"
                        : "kc-chip--accent";
                    return (
                      <li
                        key={invite.id}
                        className="rounded-[14px] border border-[var(--kc-line)] bg-white/60 px-3 py-2.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm text-[var(--kc-ink)]">
                            {invite.email}
                          </span>
                          <span className={`kc-chip ${statusClass}`}>
                            {status}
                          </span>
                        </div>
                        {!invite.acceptedAt && !invite.expired && (
                          <div className="mt-2 flex items-center gap-2">
                            <input
                              readOnly
                              value={invite.url}
                              onFocus={(e) => e.target.select()}
                              className="kc-input kc-input--sm min-w-0 flex-1 !py-1 !text-[0.72rem] !text-[var(--kc-muted)]"
                            />
                            <button
                              onClick={() => copyInviteLink(invite)}
                              className="kc-btn kc-btn-secondary kc-btn--sm !px-2.5 !py-1 !text-[0.72rem]"
                            >
                              {copiedId === invite.id ? (
                                <>
                                  <Check className="h-3 w-3 text-[var(--kc-sage)]" />
                                  Copied
                                </>
                              ) : (
                                <>
                                  <Copy className="h-3 w-3" />
                                  Copy
                                </>
                              )}
                            </button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
