"use client";

import { useEffect, useMemo, useState } from "react";
import ConnectPanel from "./connect-panel";
import {
  Activity, ArrowUpRight, CalendarDays, Check, ChevronRight, CircleHelp,
  Clock3, Flame, Gauge, House, Leaf, MoreHorizontal, Power, Settings2,
  ShieldCheck, Snowflake, Thermometer, Wifi, Zap
} from "lucide-react";

type Tab = "home" | "schedule" | "energy" | "settings";

const days = ["ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ", "НД"];

export default function HomePage() {
  const [tab, setTab] = useState<Tab>("home");
  const [power, setPower] = useState(false);
  const [temperature, setTemperature] = useState(21);
  const [roomTemperature, setRoomTemperature] = useState<number | null>(null);
  const [energyConsumption, setEnergyConsumption] = useState<number | null>(null);
  const [mode, setMode] = useState("normal");
  const [heaterStates, setHeaterStates] = useState<Record<string, unknown>>({});
  const [controlBusy, setControlBusy] = useState(false);
  const [controlError, setControlError] = useState("");
  const [selectedDay, setSelectedDay] = useState(0);
  const [liveDevice, setLiveDevice] = useState<{name:string; modelId:string|null; isAvailable:boolean|null} | null>(null);
  const [liveLoading, setLiveLoading] = useState(true);
  useEffect(() => {
    let active = true;
    const readValue = (value: unknown) => {
      if (value && typeof value === "object" && "value" in value) return (value as {value: unknown}).value;
      return value;
    };
    const refresh = async () => {
      try {
        const response = await fetch("/api/cozytouch/state", { cache: "no-store" });
        if (!response.ok) throw new Error("state_unavailable");
        const data = await response.json();
        if (!active) return;
        const heater = data?.heater;
        const states = heater?.states ?? {};
        setHeaterStates(states);
        const target = Number(readValue(states.TargetTemperature));
        if (Number.isFinite(target) && target >= 7 && target <= 30) setTemperature(target);
        const onOff = String(readValue(states.OnOff));
        setPower(onOff === "on");
        const operatingMode = String(readValue(states.OperatingMode) ?? "normal");
        setMode(operatingMode);
        const room = Number(readValue(data?.telemetry?.roomTemperature));
        setRoomTemperature(Number.isFinite(room) ? room : null);
        const energy = Number(readValue(data?.telemetry?.energyConsumption));
        setEnergyConsumption(Number.isFinite(energy) ? energy : null);
        setLiveDevice({
          name: heater?.name ?? "Atlantic Altis Eco Boost",
          modelId: heater?.modelId ?? null,
          isAvailable: heater?.isAvailable ?? null
        });
        setControlError("");
      } catch {
        if (active) setLiveDevice(null);
      } finally {
        if (active) setLiveLoading(false);
      }
    };
    refresh();
    const interval = window.setInterval(refresh, 30000);
    return () => { active = false; window.clearInterval(interval); };
  }, []);

  async function sendControl(action: string, value: unknown) {
    if (controlBusy) return;
    setControlBusy(true);
    setControlError("");
    try {
      const response = await fetch("/api/cozytouch/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, value })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не вдалося виконати команду.");
      await fetch("/api/cozytouch/state", { cache: "no-store" }).then(async r => {
        if (!r.ok) return;
        const fresh = await r.json();
        const states = fresh?.heater?.states ?? {};
        setHeaterStates(states);
        const target = Number(states.TargetTemperature);
        if (Number.isFinite(target)) setTemperature(target);
        setPower(String(states.OnOff) === "on");
        setMode(String(states.OperatingMode ?? "normal"));
      });
    } catch (error) {
      setControlError(error instanceof Error ? error.message : "Помилка керування Cozytouch.");
    } finally {
      setControlBusy(false);
    }
  }

  const estimatedPower = useMemo(() => energyConsumption === null ? "—" : energyConsumption.toLocaleString("uk-UA"), [energyConsumption]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" onClick={() => setTab("home")}>
          <span className="brand-mark"><Flame size={19} fill="currentColor" /></span>
          <span>atlantic<span className="brand-light">home</span></span>
        </a>
        <div className="top-actions">
          <span className="demo-pill"><span /> {liveLoading ? "З’ЄДНАННЯ" : liveDevice ? "COZYTOUCH" : "НЕ ПІДКЛЮЧЕНО"}</span>
          <button className="icon-button" aria-label="Налаштування" onClick={() => setTab("settings")}><Settings2 size={19}/></button>
        </div>
      </header>

      <section className="page-content">
        {tab === "home" && <>
          <div className="welcome-row">
            <div><p className="eyebrow">МІЙ ДІМ · КЛІМАТ</p><h1>Комфорт<br/><span>починається тут.</span></h1></div>
            <div className="weather-mark"><Thermometer size={19}/><span>Кімната</span></div>
          </div>

          <div className="device-card">
            <div className="device-head">
              <div className="device-name"><span className="device-icon"><Flame size={18}/></span><div><strong>{liveDevice?.name ?? "Atlantic Altis Eco Boost"}</strong><small>Конвектор · 1000 Вт · {liveDevice ? "Cozytouch" : "очікує з’єднання"}</small></div></div>
              <button className="more-button" aria-label="Додатково"><MoreHorizontal size={21}/></button>
            </div>
            <div className="device-status"><span className={liveDevice?.isAvailable ? "status-dot active" : "status-dot"}/>{liveLoading ? "Перевіряємо зв’язок…" : liveDevice ? (liveDevice.isAvailable === false ? "Пристрій зараз недоступний" : "Знайдено в Cozytouch · стан живлення ще не зчитано") : "Немає активного з’єднання з пристроєм"}</div>
            <div className="temperature-area">
              <div className="temp-ring">
                <div className="temp-inner">
                  <span className="temp-caption">ЦІЛЬОВА</span>
                  <div className="temp-value">{temperature}<span>°</span></div>
                  <span className="temp-unit">Цельсія</span>
                </div>
              </div>
              <div className="temp-controls">
                <button disabled={controlBusy || temperature <= 7} onClick={() => sendControl("temperature", Math.max(7, temperature - 0.5))} aria-label="Зменшити температуру">−</button>
                <button disabled={controlBusy || temperature >= 30} onClick={() => sendControl("temperature", Math.min(30, temperature + 0.5))} aria-label="Збільшити температуру">+</button>
              </div>
            </div>
            <div className="range-wrap">
              <input aria-label="Цільова температура" type="range" min="7" max="30" step="0.5" value={temperature} disabled={controlBusy} onChange={e=>setTemperature(Number(e.target.value))} onMouseUp={e=>sendControl("temperature", Number((e.target as HTMLInputElement).value))} onTouchEnd={e=>sendControl("temperature", Number((e.target as HTMLInputElement).value))}/>
              <div className="range-labels"><span>7°</span><span>30°</span></div>
            </div>
            <div className="device-divider"/>
            <div className="device-bottom">
              <div className="mode-block"><span>РЕЖИМ РОБОТИ</span><div className="mode-select">
                {[{label:"Комфорт",value:"normal"},{label:"ECO",value:"eco"},{label:"Антизамерзання",value:"antifreeze"}].map(item => <button key={item.value} className={mode === item.value ? "selected" : ""} disabled={controlBusy} onClick={()=>sendControl("mode", item.value)}>{item.label}</button>)}
              </div></div>
              <button className={power ? "power-button power-active" : "power-button"} disabled={controlBusy || liveDevice?.isAvailable === false} onClick={()=>sendControl("power", !power)} aria-label={power ? "Вимкнути конвектор" : "Увімкнути конвектор"}><Power size={20}/></button>
            </div>
            <div className="demo-note"><CircleHelp size={14}/> {controlError || (liveDevice ? "Керування через Cozytouch. Стан автоматично оновлюється кожні 30 секунд." : "Підключи Cozytouch у налаштуваннях.")}</div>
          </div>

          <div className="section-heading"><div><p className="eyebrow">СТАН ПРИСТРОЮ</p><h2>Зараз у кімнаті</h2></div><span className="muted-tag">{liveDevice ? "Дані Cozytouch" : "Немає з'єднання"}</span></div>
          <div className="metrics-grid">
            <div className="metric-card"><div className="metric-icon mint"><Thermometer size={17}/></div><span>Температура</span><strong>{roomTemperature === null ? "—" : roomTemperature.toLocaleString("uk-UA")} °C</strong><small>Датчик кімнатної температури</small></div>
            <div className="metric-card"><div className="metric-icon amber"><Zap size={17}/></div><span>Потужність</span><strong>{energyConsumption === null ? "—" : energyConsumption.toLocaleString("uk-UA")}</strong><small>Лічильник Cozytouch · значення API</small></div>
            <div className="metric-card"><div className="metric-icon blue"><Wifi size={17}/></div><span>З'єднання</span><strong>{liveDevice ? "Cozytouch" : "Не підключено"}</strong><small>{liveDevice ? "Пристрій знайдено" : "Потрібна авторизація"}</small></div>
            <div className="metric-card"><div className="metric-icon violet"><Activity size={17}/></div><span>Нагрівання</span><strong>{String(heaterStates.TargetHeatingLevel ?? "—")}</strong><small>Рівень нагрівання</small></div>
          </div>

          <div className="tip-card"><div className="tip-icon"><ShieldCheck size={20}/></div><div><strong>Керування буде безпечним</strong><p>Спершу перевіримо можливості саме твого конвектора в Cozytouch. Жодних команд навмання.</p></div><ChevronRight size={18}/></div>
        </>}

        {tab === "schedule" && <div className="subpage">
          <p className="eyebrow">АВТОМАТИЗАЦІЯ</p><h1>Твій розклад<span>.</span></h1>
          <p className="subcopy">Розклад поки не зчитується з API цієї моделі. Показуємо лише підтверджені дані, без фіктивного графіка.</p>
          <div className="schedule-card">
            <div className="schedule-title"><CalendarDays size={19}/><strong>Тижневий графік</strong><span className="muted-tag">Недоступно</span></div>
            <div className="day-picker">{days.map((d,i)=><button key={d} onClick={()=>setSelectedDay(i)} className={selectedDay===i?"day-active":""}>{d}</button>)}</div>
            <div className="timeline"><div className="timeline-labels"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div><div className="timeline-track"><i/><i/><i/></div></div>
            <div className="schedule-legend"><span><i className="legend-comfort"/> Комфорт · 21°</span><span><i className="legend-eco"/> ECO · 17°</span></div>
            <button className="wide-outline" onClick={()=>setTab("settings")}>Налаштувати підключення <ArrowUpRight size={16}/></button>
          </div>
        </div>}

        {tab === "energy" && <div className="subpage">
          <p className="eyebrow">ЕФЕКТИВНІСТЬ</p><h1>Енергія<span>.</span></h1>
          <p className="subcopy">Статистика з'явиться після перевірки, чи передає твій пристрій дані споживання через Cozytouch.</p>
          <div className="energy-card"><div className="energy-top"><div><span>СПОЖИВАННЯ СЬОГОДНІ</span><strong>{energyConsumption === null ? "—" : energyConsumption.toLocaleString("uk-UA")} <small>API</small></strong></div><div className="metric-icon amber"><Zap size={18}/></div></div><div className="empty-caption">Немає фактичних даних споживання від Atlantic.</div><div className="chart-labels"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div><p className="empty-caption">Поки немає даних для побудови графіка</p></div>
          <div className="metric-card tariff"><span>Твій тариф</span><strong>Недоступно</strong><small>Немає фактичного споживання для розрахунку</small></div>
        </div>}

        {tab === "settings" && <div className="subpage">
          <p className="eyebrow">КОНФІГУРАЦІЯ</p><h1>Налаштування<span>.</span></h1>
          <div className="settings-card"><div className="settings-row"><div className="settings-symbol"><Wifi size={19}/></div><div><strong>Обліковий запис Cozytouch</strong><small>{liveDevice ? "Підключено до Atlantic Home" : "Перевірка підключення"}</small></div><span className="settings-state">{liveDevice ? "Підключено" : "Очікує"}</span></div><div className="settings-row"><div className="settings-symbol"><Flame size={19}/></div><div><strong>Мій конвектор</strong><small>{liveDevice?.name ?? "Altis Eco Boost 3 Wi-Fi · 1000 Вт"}</small></div><span className="settings-state">{liveDevice ? "Знайдено" : "Не перевірено"}</span></div><div className="settings-row"><div className="settings-symbol"><ShieldCheck size={19}/></div><div><strong>Безпека</strong><small>Облікові дані зберігатимуться лише на сервері</small></div><Check size={17} className="check-icon"/></div></div>
        </div>}
      </section>

      <div style={{ display: tab === "settings" ? "block" : "none" }} aria-hidden={tab !== "settings"}><ConnectPanel /></div>

      <nav className="bottom-nav" aria-label="Основна навігація">
        <button className={tab==="home"?"nav-active":""} onClick={()=>setTab("home")}><House size={19}/><span>Дім</span></button>
        <button className={tab==="schedule"?"nav-active":""} onClick={()=>setTab("schedule")}><CalendarDays size={19}/><span>Розклад</span></button>
        <button className={tab==="energy"?"nav-active":""} onClick={()=>setTab("energy")}><Gauge size={19}/><span>Енергія</span></button>
        <button className={tab==="settings"?"nav-active":""} onClick={()=>setTab("settings")}><Settings2 size={19}/><span>Профіль</span></button>
      </nav>
    </main>
  );
}
