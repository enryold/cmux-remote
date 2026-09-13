import { type FormEvent, useState } from "react";

interface LoginProps {
  error: string | null;
  onLogin(token: string): Promise<void>;
}

export function Login({ error, onLogin }: LoginProps) {
  const [token, setToken] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!token || submitting) return;
    setSubmitting(true);
    const submittedToken = token;
    setToken("");
    try {
      await onLogin(submittedToken);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="login-page">
      <form className="login-card" onSubmit={submit}>
        <h1>cmux Remote</h1>
        <p>Connect to the private bridge on this Mac.</p>
        <label htmlFor="access-token">Access token</label>
        <input
          autoComplete="current-password"
          autoFocus
          id="access-token"
          onChange={(event) => setToken(event.target.value)}
          required
          type="password"
          value={token}
        />
        {error ? <p role="alert">{error}</p> : null}
        <button disabled={submitting} type="submit">
          {submitting ? "Connecting…" : "Connect"}
        </button>
      </form>
    </main>
  );
}
