import { type FormEvent, useState } from "react";
import type { AuthMode } from "../hooks/useAuth";

interface LoginProps {
  mode: AuthMode;
  deviceAuthorized: boolean;
  error: string | null;
  onLogin(credential: string): Promise<void>;
}

export function Login({ mode, deviceAuthorized, error, onLogin }: LoginProps) {
  const [credential, setCredential] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const pairing = mode === "pairing";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (
      submitting ||
      !credential ||
      (pairing && !/^\d{6}$/.test(credential))
    ) {
      return;
    }
    setSubmitting(true);
    const submittedCredential = credential;
    setCredential("");
    try {
      await onLogin(submittedCredential);
    } finally {
      setSubmitting(false);
    }
  };

  if (pairing && !deviceAuthorized) {
    return (
      <main className="login-page">
        <section className="login-card">
          <h1>cmux Remote</h1>
          <p role="alert">Device not authorized</p>
        </section>
      </main>
    );
  }

  return (
    <main className="login-page">
      <form className="login-card" onSubmit={submit}>
        <h1>cmux Remote</h1>
        <p>Connect to the private bridge on this Mac.</p>
        <label htmlFor="access-credential">
          {pairing ? "Pairing code" : "Access token"}
        </label>
        <input
          autoComplete={pairing ? "one-time-code" : "current-password"}
          id="access-credential"
          inputMode={pairing ? "numeric" : undefined}
          maxLength={pairing ? 6 : undefined}
          onChange={(event) => setCredential(event.target.value)}
          pattern={pairing ? "[0-9]{6}" : undefined}
          required
          type={pairing ? "text" : "password"}
          value={credential}
        />
        {error ? <p role="alert">{error}</p> : null}
        <button disabled={submitting} type="submit">
          {submitting ? "Connecting…" : pairing ? "Pair" : "Connect"}
        </button>
      </form>
    </main>
  );
}
