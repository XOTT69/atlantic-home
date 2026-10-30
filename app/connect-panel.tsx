"use client";

import { useEffect, useState } from "react";
import { Check, Flame, ShieldCheck, Wifi } from "lucide-react";

type Device = {
  id: string;
  name: string;
  modelId: string | number | null;
  productId: string | number | null;
  isAvailable: boolean | null;
  capabilityIds?: number[];
};

export default function ConnectPanel() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [device, setDevice] = useState<Device | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/cozytouch/state", { cache: "no-store" })
      .then(async r => r.ok ? r.json() : null)
      .then(data => {
        const d = data?.devices?.[0];
        if (d) setDevice({
          id: d.id, name: d.name, modelId: d.modelId, productId: d.productId,
          isAvailable: d.isAvailable,
          capabilityIds: d.capabilities?.map((c: {id:number}) => c.id) ?? []
        });
      }).catch(() => undefined);
  }, []);

  async function connect(e: React.FormEvent<HTMLFormElement>) {
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
      if (d) setDevice({
        id: d.id, name: d.name, modelId: d.modelId, productId: d.productId,
        isAvailable: d.isAvailable, capabilityIds: d.capabilityIds ?? []
      });
      setPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка підключення.");
    } finally {
      setBusy(false);
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
      <p className="connect-description">Отримано {device.capabilityIds?.length ?? 0} ідентифікаторів можливостей. Тепер перевіримо, які з них відповідають температурі, режимам та розкладу саме цієї моделі. Команди поки не надсилаються.</p>
      <button className="disconnect-button" onClick={disconnect}>Від’єднати Cozytouch</button>
    </> : <>
      <p className="connect-description">Дані вводяться лише для авторизації в Atlantic. Пароль не записується в браузері чи базі даних; сесія зберігається в зашифрованій HttpOnly cookie.</p>
      <form className="connect-form" onSubmit={connect}>
        <label>Email Cozytouch<input type="email" required autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} placeholder="name@example.com"/></label>
        <label>Пароль Cozytouch<input type="password" required autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Пароль від Cozytouch"/></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="connect-submit" disabled={busy}>{busy ? "Підключення…" : "Підключити акаунт"}</button>
      </form>
    </>}
    <div className="security-note"><ShieldCheck size={15}/> Серверна авторизація · пароль не зберігається <Check size={14}/></div>
  </section>;
}
