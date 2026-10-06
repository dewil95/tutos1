const ERRORS: Record<string, string> = {
  not_allowed: "That Google account is not on the Ascend team list. Ask an admin to add you.",
  missing_code: "Sign-in was cancelled.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <section className="login">
      <h1>Sign in</h1>
      <p>Use your @{process.env.ALLOWED_EMAIL_DOMAIN ?? "ascendfund.co"} Google account.</p>
      {error ? <p className="error">{ERRORS[error] ?? error}</p> : null}
      <a className="button primary" href="/auth/login">
        Continue with Google
      </a>
    </section>
  );
}
