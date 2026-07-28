import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getRequestContext } from "@/lib/context";
import { auth } from "@/lib/auth-provider";
import LoginForm from "./login-form";

type LoginPageProps = {
  searchParams: { [key: string]: string | string[] | undefined };
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  // Server component: feature flags come from env so the client bundle never
  // needs to know about credentials.
  const googleEnabled = Boolean(
    (process.env.AUTH_GOOGLE_ID ?? process.env.GOOGLE_CLIENT_ID) &&
      (process.env.AUTH_GOOGLE_SECRET ?? process.env.GOOGLE_CLIENT_SECRET),
  );
  const devLoginEnabled = process.env.NODE_ENV !== "production";

  // Signed-in short-circuit: never show the "email me a link" form to someone
  // who can already get in — that trains the belief that every visit needs a
  // fresh link.
  //
  // Both checks are skipped when the URL carries an error/verify state: those
  // mean "something just happened, show the outcome". Auto-redirecting after
  // a FAILED bridge attempt would loop /login → /api/auth/bridge → /login
  // forever, and the verify screen ("check your email") must survive reloads.
  const hasError = typeof searchParams.error === "string";
  const verifyRequested = searchParams.verify === "1";

  if (!hasError && !verifyRequested) {
    // 1. Live app session: straight into the app. DB-checked via
    //    getRequestContext so a stale cookie (deleted user/membership) falls
    //    through to the form instead of bouncing /app → /login in a loop.
    const context = await getRequestContext(cookies());
    if (context) {
      redirect("/app");
    }

    // 2. App cookie expired but the Auth.js session (30-day, database
    //    strategy) is still alive: re-mint the app cookie through the bridge.
    //    No email round-trip needed.
    const session = await auth();
    if (session?.user?.id) {
      redirect("/api/auth/bridge");
    }
  }

  return <LoginForm googleEnabled={googleEnabled} devLoginEnabled={devLoginEnabled} />;
}
