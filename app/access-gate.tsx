"use client";

import { FormEvent, useState } from "react";
import { LockKeyhole, ShieldCheck } from "lucide-react";

export default function AccessGate() {
  const [password,setPassword]=useState("");
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  async function unlock(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response=await fetch("/api/access/unlock",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password})});
      const data=await response.json();
      if(!response.ok) throw new Error(data.error || "Не вдалося увійти.");
      window.location.reload();
    } catch(e) { setError(e instanceof Error ? e.message : "Помилка входу."); }
    finally { setBusy(false); }
  }
  return <main className="access-shell"><form className="access-card" onSubmit={unlock}>
    <div className="access-icon"><LockKeyhole size={25}/></div>
    <p className="eyebrow">ATLANTIC HOME · PRIVATE</p><h1>Особистий доступ<span>.</span></h1>
    <p className="access-copy">Ця панель керує домашнім опаленням. Введи пароль доступу до застосунку.</p>
    <label className="access-label">Пароль<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required autoFocus/></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="connect-submit" disabled={busy}>{busy ? "Перевіряємо…" : "Увійти"}</button>
    <div className="security-note"><ShieldCheck size={15}/> Захищена сесія · HttpOnly cookie</div>
  </form></main>;
}
