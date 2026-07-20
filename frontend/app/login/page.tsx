import LoginForm from "./login-form";

export default function LoginPage() {
  // Server component: feature flags come from env so the client bundle never
  // needs to know about credentials.
  const googleEnabled = Boolean(
    (process.env.AUTH_GOOGLE_ID ?? process.env.GOOGLE_CLIENT_ID) &&
      (process.env.AUTH_GOOGLE_SECRET ?? process.env.GOOGLE_CLIENT_SECRET),
  );
  const devLoginEnabled = process.env.NODE_ENV !== "production";

  return <LoginForm googleEnabled={googleEnabled} devLoginEnabled={devLoginEnabled} />;
}
