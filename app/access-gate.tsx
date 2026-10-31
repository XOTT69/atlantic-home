"use client";

import { FormEvent, useState } from "react";
import { LockKeyhole, ShieldCheck } from "lucide-react";

export default function AccessGate({configured=true,configurationError}:{configured?:boolean;configurationError?:string}) {
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
    <p className="access-copy">{configurationError ? `Не вдалося підготувати захищений вхід: ${configurationError} Перевір Vercel → Project → Settings → Environment Variables і зроби Redeploy.` : configured ? "Ця панель керує домашнім опаленням. Введи пароль доступу до застосунку." : "Захист ще не налаштований. У Vercel → Project → Settings → Environment Variables додай ATLANTIC_APP_PASSWORD (від 4 символів) і SESSION_PASSWORD (від 32 символів), потім зроби Redeploy."}</p>
    {configured && <label className="access-label">Пароль<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} minLength={4} maxLength={128} required autoFocus/></label>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {configurationError ? <button className="connect-submit" type="button" onClick={()=>window.location.reload()}>Перевірити знову</button> : <button className="connect-submit" disabled={busy || !configured}>{busy ? "Перевіряємо…" : "Увійти"}</button>}
    <div className="security-note"><ShieldCheck size={15}/> Захищена сесія · HttpOnly cookie</div>
  </form></main>;
}
