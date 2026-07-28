"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import {
  AlertCircle,
  ArrowRight,
  ArrowUpRight,
  Brain,
  Cpu,
  GitBranch,
  Loader2,
  Mail,
  ShieldCheck,
  UserPlus,
  type LucideIcon,
} from "lucide-react";

interface LoginFormProps {
  googleEnabled: boolean;
  devLoginEnabled: boolean;
}

interface InviteInfo {
  email: string;
  tenantName: string;
  inviterName: string;
  expired: boolean;
  accepted: boolean;
}

interface Pillar {
  icon: LucideIcon;
  title: string;
  body: string;
}

const ERROR_COPY: Record<string, string> = {
  signin_failed:
    "Something went wrong while signing you in. Please try again — if it keeps happening, contact support.",
  Verification:
    "That sign-in link is invalid or has expired. Request a new one below.",
  AccessDenied: "Access was denied for that account.",
  Configuration:
    "Sign-in is not fully configured on this server. Contact support.",
  invite_invalid: "That invite link is invalid. Ask your teammate for a new one.",
  invite_used: "That invite link has already been used. Ask your teammate for a new one.",
  invite_expired: "That invite link has expired. Ask your teammate for a new one.",
  invite_email_mismatch:
    "That invite was sent to a different email address. Sign in with the email the invite was sent to.",
};

const LEFT_PILLARS: Pillar[] = [
  {
    icon: Brain,
    title: "Own the intelligence",
    body: "Context, governance, and workflow logic are the layers that compound. They stay inside your business — not inside a vendor's roadmap.",
  },
  {
    icon: Cpu,
    title: "Rent the model",
    body: "Frontier models are a utility. Call them when capability earns the cost, keep the routine volume private, and swap either without a rewrite.",
  },
];

const RIGHT_PILLARS: Pillar[] = [
  {
    icon: GitBranch,
    title: "Open source at the core",
    body: "The idea, the design, and the system are public. Read it, run it, fork it — the code is the credibility, not the marketing layer.",
  },
  {
    icon: ShieldCheck,
    title: "Auditable by construction",
    body: "Role-based access, department-scoped data, and a full tool-use trail behind every action. Private by default, provable on request.",
  },
];

const TRUST_ITEMS = [
  "Open framework at the core",
  "Private by design",
  "Your data, your AI",
  "Ownership stays with you",
];

// `--kc-delay` drives the staggered rise-in defined in globals.css.
const rise = (seconds: number) =>
  ({ "--kc-delay": `${seconds}s` }) as React.CSSProperties;

function PillarCard({ pillar, delay }: { pillar: Pillar; delay: number }) {
  const Icon = pillar.icon;
  return (
    <article className="kc-surface kc-rise p-5" style={rise(delay)}>
      <span className="mb-3 grid h-9 w-9 place-items-center rounded-xl border border-[var(--kc-line)] bg-[linear-gradient(145deg,var(--kc-accent-soft),var(--kc-sage-soft))] text-[var(--kc-accent)]">
        <Icon className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden />
      </span>
      <h2 className="kc-display text-[1.05rem]">{pillar.title}</h2>
      <p className="mt-1.5 text-[0.88rem] leading-relaxed text-[var(--kc-muted)]">
        {pillar.body}
      </p>
    </article>
  );
}

function LoginFormInner({ googleEnabled, devLoginEnabled }: LoginFormProps) {
  const router = useRouter();
  const params = useSearchParams();
  const verifyRequested = params.get("verify") === "1";
  const urlError = params.get("error");
  const inviteToken = params.get("invite");

  const [email, setEmail] = useState("");
  const [devEmail, setDevEmail] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [inviteGone, setInviteGone] = useState(false);

  // Resolve the invite token (if any): show who invited the user, prefill the
  // target email, and stash the token in a short-lived cookie that survives
  // the sign-in redirect chain so /api/auth/bridge can redeem it.
  useEffect(() => {
    if (!inviteToken) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/invites/${inviteToken}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          if (!cancelled) setInviteGone(true);
          return;
        }
        const info = (await res.json()) as InviteInfo;
        if (cancelled) return;
        if (info.expired || info.accepted) {
          setInviteGone(true);
          return;
        }
        setInvite(info);
        setEmail((prev) => prev || info.email);
        // 1-hour ride-along cookie; SameSite=Lax so it survives the OAuth /
        // magic-link top-level navigations back to /api/auth/bridge.
        document.cookie = `kc_invite=${encodeURIComponent(
          inviteToken,
        )}; path=/; max-age=3600; samesite=lax`;
      } catch {
        if (!cancelled) setInviteGone(true);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [inviteToken]);

  const errorMessage =
    error || (urlError ? (ERROR_COPY[urlError] ?? "Sign-in failed. Please try again.") : "");

  const handleEmailSignIn = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      await signIn("resend", { email, redirectTo: "/api/auth/bridge" });
    } catch {
      setError("Could not start sign-in. Please try again.");
      setIsLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError("");
    setIsLoading(true);
    try {
      await signIn("google", { redirectTo: "/api/auth/bridge" });
    } catch {
      setError("Could not start Google sign-in. Please try again.");
      setIsLoading(false);
    }
  };

  const handleDevLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      const response = await fetch("/api/dev/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: devEmail }),
      });
      if (response.ok) {
        router.push("/app");
        router.refresh();
      } else {
        const data = await response.json().catch(() => ({}));
        setError((data as { error?: string }).error || "Dev login failed");
        setIsLoading(false);
      }
    } catch {
      setError("An error occurred. Please try again.");
      setIsLoading(false);
    }
  };

  return (
    <div className="kc-theme kc-canvas relative flex min-h-screen min-h-[100svh] w-full flex-col overflow-hidden">
      <div
        aria-hidden
        className="kc-orbit -right-[22vw] -top-[40vh] w-[min(780px,116vw)]"
      />
      <div
        aria-hidden
        className="kc-orbit kc-orbit--sage -bottom-[38vh] -left-[24vw] w-[min(660px,104vw)]"
      />

      <header className="relative z-10 mx-auto flex w-full max-w-[1360px] items-center justify-between gap-4 px-5 py-5 sm:px-8">
        <Link href="/" className="inline-flex items-center gap-3">
          <span className="kc-mark h-11 w-11 text-[0.92rem]" aria-hidden>
            KC
          </span>
          <span className="flex flex-col">
            <span className="kc-display text-[1.3rem] leading-none">
              KindCaddy
            </span>
            <span className="kc-mono mt-1 text-[0.55rem] uppercase leading-none tracking-[0.24em] text-[var(--kc-muted)]">
              Applied AI Solutions
            </span>
          </span>
        </Link>
        <a
          href="https://kindcaddy.com"
          className="kc-mono hidden items-center gap-1.5 rounded-full border border-[var(--kc-line)] bg-white/55 px-3.5 py-2 text-[0.62rem] uppercase tracking-[0.16em] text-[var(--kc-muted)] transition-colors hover:border-[var(--kc-ring)] hover:text-[var(--kc-ink)] sm:inline-flex"
        >
          kindcaddy.com
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
        </a>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-[1360px] flex-1 items-center px-5 py-6 sm:px-8 sm:py-10">
        <div className="grid w-full items-center gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_minmax(0,27rem)_minmax(0,1fr)] xl:gap-10">
          {/* Login card first in the DOM so small screens lead with the task. */}
          <div className="relative order-1 mx-auto w-full max-w-[27rem] lg:order-2">
            <div className="kc-halo" aria-hidden />

            <div className="relative">
              <div className="kc-rise mb-5 text-center" style={rise(0)}>
                <span className="kc-eyebrow">Sign in</span>
                <h1 className="kc-display kc-headline mt-3 text-[clamp(1.7rem,4.4vw,2.3rem)]">
                  The intelligence is yours.
                </h1>
                <p className="mt-2 text-[0.95rem] text-[var(--kc-muted)]">
                  Own the workflow. Rent the model. Read the source.
                </p>
              </div>

              <div
                className="kc-card kc-rise p-6 sm:p-7"
                style={rise(0.08)}
              >
                {verifyRequested ? (
                  <div className="py-4 text-center">
                    <span className="kc-mark mx-auto mb-4 h-12 w-12" aria-hidden>
                      <Mail
                        className="h-5 w-5 text-[var(--kc-accent)]"
                        strokeWidth={1.8}
                      />
                    </span>
                    <h2 className="kc-display text-[1.3rem]">
                      Check your email
                    </h2>
                    <p className="mt-2 text-[0.92rem] text-[var(--kc-muted)]">
                      We sent a sign-in link to your inbox. Click it to
                      continue — you can close this tab.
                    </p>
                  </div>
                ) : (
                  <>
                    <h2 className="kc-display text-[1.45rem]">Welcome</h2>
                    <p className="mt-1.5 text-[0.93rem] text-[var(--kc-muted)]">
                      Sign in or create your workspace to continue.
                    </p>

                    {invite && (
                      <div className="mt-5 flex items-start gap-3 rounded-[14px] border border-[rgba(103,121,95,0.28)] bg-[rgba(216,224,210,0.45)] p-3">
                        <UserPlus
                          className="mt-0.5 h-[18px] w-[18px] flex-none text-[var(--kc-sage)]"
                          strokeWidth={1.8}
                          aria-hidden
                        />
                        <p className="text-[0.86rem] leading-relaxed text-[var(--kc-ink)]">
                          <span className="font-semibold">
                            {invite.inviterName}
                          </span>{" "}
                          invited you to join{" "}
                          <span className="font-semibold">
                            {invite.tenantName}
                          </span>
                          . Sign in with{" "}
                          <span className="font-semibold">{invite.email}</span>{" "}
                          to accept.
                        </p>
                      </div>
                    )}

                    {inviteGone && !urlError && (
                      <div className="mt-5 rounded-[14px] border border-[rgba(187,106,69,0.28)] bg-[rgba(241,216,197,0.5)] p-3">
                        <p className="text-[0.86rem] leading-relaxed text-[var(--kc-ink)]">
                          That invite link is invalid, expired, or already
                          used. You can still sign in to create your own
                          workspace.
                        </p>
                      </div>
                    )}

                    {errorMessage && (
                      <div
                        role="alert"
                        className="mt-5 flex items-start gap-2.5 rounded-[14px] border border-[#e0b0a1] bg-[#fdf0eb] p-3"
                      >
                        <AlertCircle
                          className="mt-0.5 h-[18px] w-[18px] flex-none text-[#a8452a]"
                          strokeWidth={1.8}
                          aria-hidden
                        />
                        <p className="text-[0.86rem] leading-relaxed text-[#8a3b21]">
                          {errorMessage}
                        </p>
                      </div>
                    )}

                    <form onSubmit={handleEmailSignIn} className="mt-6">
                      <label
                        htmlFor="email"
                        className="kc-mono mb-2 block text-[0.62rem] uppercase tracking-[0.18em] text-[var(--kc-muted)]"
                      >
                        Email address
                      </label>
                      <input
                        type="email"
                        id="email"
                        name="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="kc-input"
                        placeholder="you@example.com"
                        autoComplete="email"
                        required
                        disabled={isLoading}
                      />
                      <button
                        type="submit"
                        disabled={isLoading || !email.trim()}
                        className="kc-btn kc-btn--block kc-btn-primary mt-4"
                      >
                        {isLoading ? (
                          <>
                            <Loader2
                              className="h-4 w-4 animate-spin"
                              aria-hidden
                            />
                            Sending link...
                          </>
                        ) : (
                          <>
                            Email me a sign-in link
                            <ArrowRight className="h-4 w-4" aria-hidden />
                          </>
                        )}
                      </button>
                    </form>

                    {googleEnabled && (
                      <>
                        <div className="my-5 flex items-center gap-3">
                          <span className="h-px flex-1 bg-[var(--kc-line)]" />
                          <span className="kc-mono text-[0.6rem] uppercase tracking-[0.2em] text-[var(--kc-muted)]">
                            or
                          </span>
                          <span className="h-px flex-1 bg-[var(--kc-line)]" />
                        </div>
                        <button
                          type="button"
                          onClick={handleGoogleSignIn}
                          disabled={isLoading}
                          className="kc-btn kc-btn--block kc-btn-secondary"
                        >
                          <svg
                            className="h-4 w-4"
                            viewBox="0 0 24 24"
                            aria-hidden
                          >
                            <path
                              fill="#4285F4"
                              d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47a5.55 5.55 0 0 1-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"
                            />
                            <path
                              fill="#34A853"
                              d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09A12 12 0 0 0 12 24z"
                            />
                            <path
                              fill="#FBBC05"
                              d="M5.27 14.29A7.16 7.16 0 0 1 4.89 12c0-.8.14-1.57.38-2.29V6.62H1.29a12 12 0 0 0 0 10.76l3.98-3.09z"
                            />
                            <path
                              fill="#EA4335"
                              d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42A11.97 11.97 0 0 0 12 0 12 12 0 0 0 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z"
                            />
                          </svg>
                          Continue with Google
                        </button>
                      </>
                    )}

                    <p className="mt-5 text-center text-[0.78rem] leading-relaxed text-[var(--kc-muted)]">
                      No password to steal — we email you a single-use link.
                      After that, you stay signed in on this device.
                    </p>

                    {devLoginEnabled && (
                      <div className="mt-5 border-t border-dashed border-[var(--kc-line)] pt-5">
                        <p className="kc-mono mb-2 text-[0.58rem] uppercase tracking-[0.18em] text-[var(--kc-muted)]">
                          Dev quick login (local only)
                        </p>
                        <form onSubmit={handleDevLogin} className="flex gap-2">
                          <input
                            type="email"
                            value={devEmail}
                            onChange={(e) => setDevEmail(e.target.value)}
                            placeholder="alice@example.com"
                            className="kc-input kc-input--sm flex-1"
                            disabled={isLoading}
                          />
                          <button
                            type="submit"
                            disabled={isLoading || !devEmail.trim()}
                            className="kc-btn kc-btn-secondary kc-btn--sm"
                          >
                            Go
                          </button>
                        </form>
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="mt-5 flex justify-center">
                <span className="kc-badge kc-rise" style={rise(0.34)}>
                  MIT licensed · Open source at the core
                </span>
              </div>
            </div>
          </div>

          <div className="order-2 grid gap-4 sm:grid-cols-2 lg:order-1 lg:grid-cols-1">
            {LEFT_PILLARS.map((pillar, i) => (
              <PillarCard
                key={pillar.title}
                pillar={pillar}
                delay={0.16 + i * 0.08}
              />
            ))}
          </div>

          <div className="order-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
            {RIGHT_PILLARS.map((pillar, i) => (
              <PillarCard
                key={pillar.title}
                pillar={pillar}
                delay={0.24 + i * 0.08}
              />
            ))}
          </div>
        </div>
      </main>

      <footer className="relative z-10 mx-auto w-full max-w-[1360px] px-5 pb-7 sm:px-8">
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2.5">
          {TRUST_ITEMS.map((item) => (
            <span
              key={item}
              className="inline-flex items-center gap-2 text-[0.78rem] text-[var(--kc-muted)]"
            >
              <span className="kc-dot" aria-hidden />
              {item}
            </span>
          ))}
        </div>
      </footer>
    </div>
  );
}

export default function LoginForm(props: LoginFormProps) {
  return (
    <Suspense fallback={null}>
      <LoginFormInner {...props} />
    </Suspense>
  );
}
