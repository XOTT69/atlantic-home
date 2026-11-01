"use client";
import { useState, type FormEvent } from "react";
import { Link2, ShieldCheck } from "lucide-react";

export default function ConnectPanel({
  connected,
  onConnected,
}: {
  connected: boolean;
  onConnected: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [edit, setEdit] = useState(false);
  async function connect(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/cozytouch/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
        signal: AbortSignal.timeout(90_000),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error ?? "Не вдалося підключитися.");
      setPassword("");
      setEdit(false);
      onConnected();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Не вдалося підключитися.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card connect-card">
      <div className="card-heading">
        <Link2 size={20} />
        <h2>Atlantic Cozytouch</h2>
        <span className="badge">
          {connected ? "Підключено" : "Потрібне підключення"}
        </span>
      </div>
      <p className="muted">
        Підключення до твого конвектора. Пароль використовується для входу в
        Atlantic і не записується в базу.
      </p>
      {connected && !edit ? (
        <button className="button secondary" onClick={() => setEdit(true)}>
          Оновити підключення
        </button>
      ) : (
        <form onSubmit={connect} className="form-grid">
          <label>
            Email Cozytouch
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={254}
            />
          </label>
          <label>
            Пароль Cozytouch
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              maxLength={512}
            />
          </label>
          <div className="button-row">
            <button className="button primary" disabled={busy}>
              {busy ? "Підключаємо…" : "Підключити"}
            </button>
            {connected && (
              <button
                className="button secondary"
                type="button"
                disabled={busy}
                onClick={() => {
                  setEdit(false);
                  setPassword("");
                }}
              >
                Скасувати
              </button>
            )}
          </div>
        </form>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <p className="small muted inline">
        <ShieldCheck size={16} /> Зашифроване серверне підключення
      </p>
    </section>
  );
}
