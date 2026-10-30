"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Check, Flame, ShieldCheck, Wifi } from "lucide-react";

type Device = {
  id: string;
  name: string;
  modelId: string | number | null;
  productId: string | number | null;
  isAvailable: boolean | null;
  capabilities?: { id: number; value: string | null; updatedAt?: string | number | null }[];
  diagnostics?: Record<string, unknown>;
};

export default function ConnectPanel() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [device, setDevice] = useState<Device | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    fetch("/api/cozytouch/state", { cache: "no-store" })
      .then(async r => r.ok ? r.json() : null)
      .then(data => {
        const d = data?.devices?.[0];
        if (d) setDevice({
          id: d.id, name: d.name, modelId: d.modelId, productId: d.productId,
          isAvailable: d.isAvailable,
          capabilities: d.capabilities ?? [],
          diagnostics: { device: d, zones: data?.zones ?? [], gateways: data?.gateways ?? [] }
        });
      }).catch(() => undefined)
      .finally(() => setCheckingSession(false));
  }, []);

  async function connect(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/cozytouch/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не вдалося підключитися.");
      const d = data.devices?.[0];
      if (!d) {
        throw new Error("Cozytouch прийняв авторизацію, але не повернув пристроїв. Перевір, чи конвектор доданий до цього акаунта Cozytouch, і спробуй оновити сторінку.");
      }
      setDevice({
        id: d.id, name: d.name, modelId: d.modelId, productId: d.productId,
        isAvailable: d.isAvailable, capabilities: d.capabilities ?? [],
        diagnostics: { device: d, zones: data?.zones ?? [], gateways: data?.gateways ?? [] }
      });
      setPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка підключення.");
    } finally {
      setBusy(false);
    }
  }

  async function copyDiagnostics() {
    if (!device) return;
    const report = {
      modelId: device.modelId,
      productId: device.productId,
      isAvailable: device.isAvailable,
      capabilities: device.capabilities ?? [],
      ...device.diagnostics
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("Не вдалося скопіювати дані. Зроби скриншот технічного списку.");
    }
  }

  async function disconnect() {
    await fetch("/api/cozytouch/disconnect", { method: "POST" });
    setDevice(null);
    setError("");
  }

  return <section className="live-connect">
    <div className="live-connect-head">
      <div className="connect-badge"><Wifi size={21}/></div>
      <div><strong>Підключення Cozytouch</strong><small>{device ? "Акаунт авторизовано" : "Потрібна авторизація"}</small></div>
      {device && <span className="connected-label">ПІДКЛЮЧЕНО</span>}
    </div>
    {device ? <>
      <div className="detected-device">
        <Flame size={18}/>
        <div><strong>{device.name}</strong><small>modelId: {device.modelId ?? "—"} · productId: {device.productId ?? "—"}</small></div>
        <span className={device.isAvailable === false ? "device-offline" : "device-online"}>{device.isAvailable === false ? "Офлайн" : "Знайдено"}</span>
      </div>
      <p className="connect-description">Зчитано {device.capabilities?.length ?? 0} параметрів із хмари Atlantic. На наступному кроці зіставимо їх із керуванням саме цієї моделі. До перевірки значень команди не надсилаються.</p>
      <details className="capability-details">
        <summary>Технічні дані пристрою та шлюзу</summary>
        <div className="capability-list">
          {(device.capabilities ?? []).map(cap => <div key={cap.id}><span>Capability {cap.id}</span><strong>{cap.value ?? "—"}</strong></div>)}
          <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 11, lineHeight: 1.45, maxHeight: 360, overflow: "auto" }}>{JSON.stringify(device.diagnostics ?? {}, null, 2)}</pre>
        </div>
      </details>
      <button className="copy-diagnostics" onClick={copyDiagnostics}>{copied ? "Дані скопійовано" : "Скопіювати технічні дані"}</button>
      <button className="disconnect-button" onClick={disconnect}>Від’єднати Cozytouch</button>
    </> : checkingSession ? <>
      <p className="connect-description">Перевіряємо збережене підключення Cozytouch…</p>
    </> : <>
      <p className="connect-description">Дані вводяться лише для авторизації в Atlantic. Пароль не записується в браузері чи базі даних; сесія зберігається в зашифрованій HttpOnly cookie.</p>
      <form className="connect-form" action="/api/cozytouch/connect" method="post" onSubmit={connect}>
        <label>Email Cozytouch<input type="email" name="email" required autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} placeholder="name@example.com"/></label>
        <label>Пароль Cozytouch<input type="password" name="password" required autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Пароль від Cozytouch"/></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="connect-submit" type="submit" disabled={busy}>{busy ? "Підключення…" : "Підключити акаунт"}</button>
      </form>
    </>}
    <div className="security-note"><ShieldCheck size={15}/> Серверна авторизація · пароль не зберігається <Check size={14}/></div>
  </section>;
}
