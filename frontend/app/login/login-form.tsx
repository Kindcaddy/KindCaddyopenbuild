"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { Mail, Sparkles } from "lucide-react";

interface LoginFormProps {
  googleEnabled: boolean;
  devLoginEnabled: boolean;
}

const ERROR_COPY: Record<string, string> = {
  signin_failed:
    "Something went wrong while signing you in. Please try again — if it keeps happening, contact support.",
  Verification:
    "That sign-in link is invalid or has expired. Request a new one below.",
  AccessDenied: "Access was denied for that account.",
  Configuration:
    "Sign-in is not fully configured on this server. Contact support.",
};

function LoginFormInner({ googleEnabled, devLoginEnabled }: LoginFormProps) {
  const router = useRouter();
  const params = useSearchParams();
  const verifyRequested = params.get("verify") === "1";
  const urlError = params.get("error");

  const [email, setEmail] = useState("");
  const [devEmail, setDevEmail] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

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
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 flex items-center justify-center px-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center">
            <Sparkles className="h-10 w-10 text-blue-600" />
            <span className="ml-2 text-2xl font-bold text-gray-900 dark:text-white">
              KindCaddy
            </span>
          </Link>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 p-8">
          {verifyRequested ? (
            <div className="text-center py-4">
              <Mail className="h-10 w-10 text-blue-600 mx-auto mb-3" />
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
                Check your email
              </h2>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                We sent a sign-in link to your inbox. Click it to continue —
                you can close this tab.
              </p>
            </div>
          ) : (
            <>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                Welcome
              </h2>
              <p className="text-gray-600 dark:text-gray-400 mb-6">
                Sign in or create your workspace to continue
              </p>

              {errorMessage && (
                <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                  <p className="text-sm text-red-800 dark:text-red-300">
                    {errorMessage}
                  </p>
                </div>
              )}

              <form onSubmit={handleEmailSignIn} className="space-y-4">
                <div>
                  <label
                    htmlFor="email"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                  >
                    Email address
                  </label>
                  <input
                    type="email"
                    id="email"
                    name="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    placeholder="you@example.com"
                    required
                    disabled={isLoading}
                  />
                </div>
                <button
                  type="submit"
                  disabled={isLoading || !email.trim()}
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed text-white font-semibold py-2 px-4 rounded-lg transition-colors"
                >
                  {isLoading ? "Sending link..." : "Email me a sign-in link"}
                </button>
              </form>

              {googleEnabled && (
                <>
                  <div className="flex items-center gap-3 my-5">
                    <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
                    <span className="text-xs text-gray-400">or</span>
                    <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
                  </div>
                  <button
                    type="button"
                    onClick={handleGoogleSignIn}
                    disabled={isLoading}
                    className="w-full flex items-center justify-center gap-2 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 text-gray-700 dark:text-gray-200 font-medium py-2 px-4 rounded-lg transition-colors"
                  >
                    <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden>
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

              {devLoginEnabled && (
                <div className="mt-6 pt-5 border-t border-dashed border-gray-200 dark:border-gray-700">
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-2 font-medium">
                    Dev quick login (local only)
                  </p>
                  <form onSubmit={handleDevLogin} className="flex gap-2">
                    <input
                      type="email"
                      value={devEmail}
                      onChange={(e) => setDevEmail(e.target.value)}
                      placeholder="alice@example.com"
                      className="flex-1 px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      disabled={isLoading}
                    />
                    <button
                      type="submit"
                      disabled={isLoading || !devEmail.trim()}
                      className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
                    >
                      Go
                    </button>
                  </form>
                </div>
              )}
            </>
          )}
        </div>
      </div>
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
