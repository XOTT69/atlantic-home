"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import ConnectPanel from "./connect-panel";
import {
  Activity, ArrowUpRight, CalendarDays, Check, ChevronRight, CircleHelp,
  Clock3, Flame, Gauge, House, Leaf, MoreHorizontal, Power, Settings2,
  ShieldCheck, Snowflake, Thermometer, Wifi, Zap, RefreshCw
} from "lucide-react";

type Tab = "home" | "schedule" | "energy" | "settings";


export default function HomePage() {
  const [tab, setTab] = useState<Tab>("home");
  const [power, setPower] = useState(false);
  const [temperature, setTemperature] = useState(21);
  const [roomTemperature, setRoomTemperature] = useState<number | null>(null);
  const [energyConsumption, setEnergyConsumption] = useState<number | null>(null);
  const [energyDate, setEnergyDate] = useState<string | null>(null);
  const [energyDayKwh, setEnergyDayKwh] = useState<number | null>(null);
  const [energyNightKwh, setEnergyNightKwh] = useState<number | null>(null);
  const [winterTier, setWinterTier] = useState<"discount" | "standard">("discount");
  const [winterTierReady, setWinterTierReady] = useState(false);
  const [hourlyEnergy, setHourlyEnergy] = useState<{timestamp:number;quantityKwh:number;mode:number}[]>([]);
  const [instantaneousPowerW, setInstantaneousPowerW] = useState<number | null>(null);
  const [energyDiagnostics, setEnergyDiagnostics] = useState<any>(null);
  const [temperatureDragging, setTemperatureDragging] = useState(false);
  const [roomTemperatureStatus, setRoomTemperatureStatus] = useState<"online" | "unknown">("unknown");
  const [deviceLastSuccessAt, setDeviceLastSuccessAt] = useState<string | null>(null);
  const [roomTemperatureLastSuccessAt, setRoomTemperatureLastSuccessAt] = useState<string | null>(null);
  const [mode, setMode] = useState("normal");
  const [heaterStates, setHeaterStates] = useState<Record<string, unknown>>({});
  const [controlBusy, setControlBusy] = useState(false);
  const [gatewayOnline, setGatewayOnline] = useState(false);
  const [deviceStatus, setDeviceStatus] = useState<"online" | "offline" | "unknown">("unknown");
  const [controlError, setControlError] = useState("");
  const [refreshTick, setRefreshTick] = useState(0);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [liveDevice, setLiveDevice] = useState<{name:string; modelId:string|null; isAvailable:boolean|null} | null>(null);
  const [liveLoading, setLiveLoading] = useState(true);
  const [connectionRecovered, setConnectionRecovered] = useState(false);
  const gatewayWasOffline = useRef(false);
  const pendingControl = useRef<{action:string;value:unknown;until:number}|null>(null);
  useEffect(() => {
    const saved = window.localStorage.getItem("atlantic-home-winter-tier");
    if (saved === "discount" || saved === "standard") setWinterTier(saved);
    setWinterTierReady(true);
  }, []);
  useEffect(() => {
    if (winterTierReady) window.localStorage.setItem("atlantic-home-winter-tier", winterTier);
  }, [winterTier, winterTierReady]);
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
        setLastUpdatedAt(new Date().toISOString());
        const currentGatewayOnline = data?.gatewayOnline === true;
        if (currentGatewayOnline && gatewayWasOffline.current) setConnectionRecovered(true);
        if (!currentGatewayOnline) gatewayWasOffline.current = true;
        setGatewayOnline(currentGatewayOnline);
        setDeviceLastSuccessAt(data?.deviceLastSuccessAt ?? null);
        setRoomTemperatureStatus(data?.telemetry?.roomTemperatureStatus === "online" ? "online" : "unknown");
        setRoomTemperatureLastSuccessAt(data?.telemetry?.roomTemperatureLastSuccessAt ?? null);
        setDeviceStatus(data?.deviceStatus === "online" ? "online" : data?.deviceStatus === "offline" ? "offline" : "unknown");
        const pending = pendingControl.current;
        const pendingIsActive = !!pending && Date.now() < pending.until;
        const target = Number(readValue(states.TargetTemperature));
        if (pendingIsActive && pending?.action === "temperature" && target !== Number(pending.value)) {
          // Cozytouch may acknowledge the command before its read-state endpoint catches up.
        } else {
          if (pending?.action === "temperature" && target === Number(pending.value)) pendingControl.current = null;
          if (Number.isFinite(target) && target >= 7 && target <= 30) setTemperature(target);
        }
        const onOff = String(readValue(states.OnOff)).toLowerCase();
        if (!(pendingIsActive && pending?.action === "power" && (onOff === "on") !== Boolean(pending.value))) {
          if (pending?.action === "power" && (onOff === "on") === Boolean(pending.value)) pendingControl.current = null;
          setPower(onOff === "on");
        }
        const operatingMode = String(readValue(states.OperatingMode) ?? "normal");
        if (!(pendingIsActive && pending?.action === "mode" && operatingMode !== String(pending.value))) {
          if (pending?.action === "mode" && operatingMode === String(pending.value)) pendingControl.current = null;
          setMode(operatingMode);
        }
        if (pending && Date.now() >= pending.until) pendingControl.current = null;
        const room = Number(readValue(data?.telemetry?.roomTemperature));
        setRoomTemperature(Number.isFinite(room) ? room : null);
        const dailyEnergy = data?.telemetry?.dailyEnergy;
        const energy = dailyEnergy?.available === true && dailyEnergy?.totalKwh !== null ? Number(dailyEnergy.totalKwh) : NaN;
        setEnergyConsumption(Number.isFinite(energy) ? energy : null);
        setEnergyDate(dailyEnergy?.date ?? null);
        setEnergyDayKwh(typeof dailyEnergy?.peakKwh === "number" ? dailyEnergy.peakKwh : null);
        setEnergyNightKwh(typeof dailyEnergy?.offPeakKwh === "number" ? dailyEnergy.offPeakKwh : null);
        const hourly = data?.telemetry?.hourlyEnergy;
        setHourlyEnergy(hourly?.available === true && Array.isArray(hourly.periods) ? hourly.periods : []);
        const powerW = data?.telemetry?.instantaneousPowerW;
        setInstantaneousPowerW(typeof powerW === "number" && Number.isFinite(powerW) ? powerW : null);
        setEnergyDiagnostics(data?.telemetry?.energyDiagnostics ?? null);
        setLiveDevice({
          name: heater?.name ?? "Atlantic Altis Eco Boost",
          modelId: heater?.modelId ?? null,
          isAvailable: heater?.isAvailable ?? null
        });
        setControlError("");
      } catch {
        if (active) { gatewayWasOffline.current = true; setLiveDevice(null); setDeviceStatus("unknown"); setGatewayOnline(false); }
      } finally {
        if (active) setLiveLoading(false);
      }
    };
    refresh();
    const interval = window.setInterval(refresh, 30000);
    return () => { active = false; window.clearInterval(interval); };
  }, [refreshTick]);

  function temperatureFromPointer(event: ReactPointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left - rect.width / 2;
    const y = event.clientY - rect.top - rect.height / 2;
    const angle = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    const progress = Math.max(0, Math.min(270, (angle - 135 + 360) % 360));
    return Math.round((7 + progress / 270 * 23) * 2) / 2;
  }

  async function sendControl(action: string, value: unknown) {
    if (controlBusy) return;
    const previous = { temperature, power, mode };
    // Update the interface immediately: the heater often applies the command
    // before Cozytouch's read-state endpoint reflects the new value.
    if (action === "temperature") setTemperature(Number(value));
    if (action === "power") setPower(Boolean(value));
    if (action === "mode") setMode(String(value));
    pendingControl.current = { action, value, until: Date.now() + 20000 };
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
      // Do not immediately replace the optimistic value with a potentially stale
      // Cozytouch read. Reconcile on the next poll, while protecting it for 20 sec.
      window.setTimeout(() => setRefreshTick(tick => tick + 1), 2500);
    } catch (error) {
      pendingControl.current = null;
      setTemperature(previous.temperature);
      setPower(previous.power);
      setMode(previous.mode);
      setControlError(error instanceof Error ? error.message : "Помилка керування Cozytouch.");
    } finally {
      setControlBusy(false);
    }
  }


  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" onClick={() => setTab("home")}>
          <span className="brand-mark"><Flame size={19} fill="currentColor" /></span>
          <span>atlantic<span className="brand-light">home</span></span>
        </a>
        <div className="top-actions">
          <span className="demo-pill"><span /> {liveLoading ? "ПЕРЕВІРКА" : deviceStatus === "online" ? "ОНЛАЙН" : deviceStatus === "offline" ? "ОФЛАЙН" : liveDevice ? "СТАН НЕВІДОМИЙ" : "НЕ ПІДКЛЮЧЕНО"}</span>
          <button className="icon-button" aria-label="Налаштування" onClick={() => setTab("settings")}><Settings2 size={19}/></button>
        </div>
      </header>

      <section className="page-content">
        {tab === "home" && <>
          <div className="welcome-row">
            <div><p className="eyebrow">МІЙ ДІМ · КЛІМАТ</p><h1>Комфорт<br/><span>починається тут.</span></h1></div>
            <div className="weather-mark"><Thermometer size={19}/><span>Кімната</span></div>
          </div>

          {connectionRecovered && <div className="tip-card"><div className="tip-icon"><Wifi size={20}/></div><div><strong>Зв’язок із Cozytouch відновлено</strong><p>Шлюз знову відповідає. Перевір актуальний стан конвектора та цільову температуру.</p></div><button className="more-button" onClick={()=>setConnectionRecovered(false)} aria-label="Закрити">×</button></div>}
          {!gatewayOnline && !liveLoading && <div className="tip-card"><div className="tip-icon"><Wifi size={20}/></div><div><strong>Шлюз Cozytouch недоступний</strong><p>Можливе знеструмлення або втрата інтернету. Стан конвектора поки не підтверджено. Після відновлення зв’язку перевіримо його автоматично.</p></div></div>}
          <div className="device-card">
            <div className="device-head">
              <div className="device-name"><span className="device-icon"><Flame size={18}/></span><div><strong>{liveDevice?.name ?? "Atlantic Altis Eco Boost"}</strong><small>Конвектор · 1000 Вт · {liveDevice ? "Cozytouch" : "очікує з’єднання"}</small></div></div>
              <button className="more-button" aria-label="Оновити стан" title="Оновити стан" disabled={liveLoading} onClick={()=>{setLiveLoading(true);setRefreshTick(value=>value+1);}}><RefreshCw size={18} className={liveLoading ? "spin" : ""}/></button>
            </div>
            <div className="device-status"><span className={deviceStatus === "online" ? "status-dot active" : "status-dot"}/>{liveLoading ? "Перевіряємо зв’язок…" : deviceStatus === "online" ? "Конвектор онлайн · зв’язок підтверджено" : deviceStatus === "offline" ? "Конвектор офлайн · немає зв’язку зі шлюзом або пристроєм" : liveDevice ? "Не вдалося достовірно визначити стан конвектора" : "Немає зв’язку з Cozytouch · стан невідомий"}{lastUpdatedAt && !liveLoading ? <small className="state-updated">Оновлено {new Date(lastUpdatedAt).toLocaleTimeString("uk-UA",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}</small> : null}</div>
            <div className="temperature-area">
              <div
                className={temperatureDragging ? "temp-dial dragging" : "temp-dial"}
                role="slider"
                aria-label="Цільова температура"
                aria-valuemin={7}
                aria-valuemax={30}
                aria-valuenow={temperature}
                tabIndex={deviceStatus === "online" ? 0 : -1}
                onKeyDown={e=>{if(e.key==="ArrowUp"||e.key==="ArrowRight"){e.preventDefault();sendControl("temperature",Math.min(30,temperature+0.5));}if(e.key==="ArrowDown"||e.key==="ArrowLeft"){e.preventDefault();sendControl("temperature",Math.max(7,temperature-0.5));}}}
                onPointerDown={e=>{if(controlBusy||deviceStatus!=="online")return;e.currentTarget.setPointerCapture(e.pointerId);setTemperatureDragging(true);const v=temperatureFromPointer(e);setTemperature(v);}}
                onPointerMove={e=>{if(temperatureDragging){setTemperature(temperatureFromPointer(e));}}}
                onPointerUp={e=>{if(!temperatureDragging)return;const v=temperatureFromPointer(e);setTemperatureDragging(false);sendControl("temperature",v);}}
                onPointerCancel={()=>setTemperatureDragging(false)}
              >
                <svg className="dial-svg" viewBox="0 0 260 260" aria-hidden="true">
                  <circle className="dial-track" cx="130" cy="130" r="108" />
                  <circle className="dial-progress" cx="130" cy="130" r="108" style={{strokeDasharray:"509 679",strokeDashoffset:String(509-(temperature-7)/23*509)}} />
                  <circle className="dial-thumb" cx={130+108*Math.cos((135+(temperature-7)/23*270)*Math.PI/180)} cy={130+108*Math.sin((135+(temperature-7)/23*270)*Math.PI/180)} r="9"/>
                </svg>
                <div className="temp-inner">
                  <span className="temp-caption">ЦІЛЬОВА</span>
                  <div className="temp-value">{temperature}<span>°</span></div>
                  <span className="temp-unit">Цельсія</span>
                  <span className="dial-hint">ПРОВЕДИ ПО КОЛУ</span>
                </div>
              </div>
              <div className="temp-controls">
                <button disabled={controlBusy || deviceStatus !== "online" || temperature <= 7} onClick={() => sendControl("temperature", Math.max(7, temperature - 0.5))} aria-label="Зменшити температуру">−</button>
                <button disabled={controlBusy || deviceStatus !== "online" || temperature >= 30} onClick={() => sendControl("temperature", Math.min(30, temperature + 0.5))} aria-label="Збільшити температуру">+</button>
              </div>
            </div>
            <div className="range-wrap">
              <input aria-label="Цільова температура" type="range" min="7" max="30" step="0.5" value={temperature} disabled={controlBusy || deviceStatus !== "online"} onChange={e=>setTemperature(Number(e.target.value))} onPointerUp={e=>sendControl("temperature", Number((e.target as HTMLInputElement).value))}/>
              <div className="range-labels"><span>7°</span><span>30°</span></div>
            </div>
            <div className="device-divider"/>
            <div className="device-bottom">
              <div className="mode-block"><span>РЕЖИМ РОБОТИ</span><div className="mode-select">
                {[{label:"Комфорт",value:"normal"},{label:"ECO",value:"eco"},{label:"Антизамерзання",value:"antifreeze"}].map(item => <button key={item.value} className={mode === item.value ? "selected" : ""} disabled={controlBusy || deviceStatus !== "online"} onClick={()=>sendControl("mode", item.value)}>{item.label}</button>)}
              </div></div>
              <button className={power ? "power-button on" : "power-button"} disabled={controlBusy || deviceStatus !== "online"} onClick={()=>sendControl("power", !power)} aria-label={power ? "Вимкнути конвектор" : "Увімкнути конвектор"}><Power size={20}/></button>
            </div>
            <div className="demo-note"><CircleHelp size={14}/> {controlError || (deviceStatus === "online" ? "Конвектор онлайн. Стан оновлюється кожні 30 секунд." : deviceStatus === "offline" ? "Конвектор офлайн. Керування заблоковано до відновлення зв’язку." : "Очікуємо підтвердження стану конвектора через Cozytouch.")}</div>
          </div>

          <div className="section-heading"><div><p className="eyebrow">СТАН ПРИСТРОЮ</p><h2>Зараз у кімнаті</h2></div><span className="muted-tag">{liveDevice ? "Дані Cozytouch" : "Немає з'єднання"}</span></div>
          <div className="metrics-grid">
            <div className="metric-card"><div className="metric-icon mint"><Thermometer size={17}/></div><span>Температура</span><strong>{roomTemperature === null ? "—" : roomTemperature.toLocaleString("uk-UA")} °C</strong><small>{roomTemperatureStatus === "online" ? (roomTemperatureLastSuccessAt ? "Оновлено " + new Date(roomTemperatureLastSuccessAt).toLocaleTimeString("uk-UA", {hour:"2-digit",minute:"2-digit"}) : "Датчик відповів") : "Немає свіжого підтвердження"}</small></div>
            <div className="metric-card"><div className="metric-icon amber"><Zap size={17}/></div><span>Споживання сьогодні</span><strong>{energyConsumption === null ? "—" : energyConsumption.toLocaleString("uk-UA")} {energyConsumption === null ? "" : "кВт·год"}</strong><small>Добовий лічильник Atlantic</small></div>
            <div className="metric-card"><div className="metric-icon blue"><Wifi size={17}/></div><span>З'єднання</span><strong>{deviceStatus === "online" ? "Онлайн" : deviceStatus === "offline" ? "Офлайн" : "Невідомо"}</strong><small>{gatewayOnline ? "Шлюз доступний" : "Шлюз не підтвердив зв’язок"}{deviceLastSuccessAt ? " · відповідь " + new Date(deviceLastSuccessAt).toLocaleTimeString("uk-UA", {hour:"2-digit",minute:"2-digit"}) : ""}</small></div>
            <div className="metric-card"><div className="metric-icon violet"><Activity size={17}/></div><span>Нагрівання</span><strong>{String(heaterStates.TargetHeatingLevel ?? "—")}</strong><small>Рівень нагрівання</small></div>
            <div className="metric-card"><div className="metric-icon amber"><Zap size={17}/></div><span>Потужність зараз</span><strong>{instantaneousPowerW === null ? "—" : instantaneousPowerW.toLocaleString("uk-UA") + " Вт"}</strong><small>{instantaneousPowerW === null ? "Датчик потужності не передає значення" : "Останнє вимірювання Cozytouch"}</small></div>
          </div>

          <div className="tip-card"><div className="tip-icon"><ShieldCheck size={20}/></div><div><strong>Керування буде безпечним</strong><p>Спершу перевіримо можливості саме твого конвектора в Cozytouch. Жодних команд навмання.</p></div><ChevronRight size={18}/></div>
        </>}

        {tab === "schedule" && <div className="subpage">
          <p className="eyebrow">АВТОМАТИЗАЦІЯ</p><h1>Твій розклад<span>.</span></h1>
          <p className="subcopy">Поки не вмикаємо автоматичний розклад: після знеструмлення годинник конвектора може скидатися, а це здатне змістити час нагрівання.</p>
          <div className="schedule-card">
            <div className="schedule-title"><CalendarDays size={19}/><strong>Розклад нагрівання</strong><span className="muted-tag">На паузі</span></div>
            <div className="empty-caption">Спочатку перевіримо, чи можна надійно синхронізувати час конвектора через Cozytouch. До цього жодних автоматичних команд за часом не надсилатимемо.</div>
            <button className="wide-outline" onClick={()=>setTab("home")}>Повернутися до керування <ArrowUpRight size={16}/></button>
          </div>
        </div>}

        {tab === "energy" && <div className="subpage">
          <p className="eyebrow">ЕФЕКТИВНІСТЬ</p><h1>Енергія<span>.</span></h1>
          <p className="subcopy">Показуємо добовий показник Atlantic, а не загальний накопичувальний лічильник пристрою.</p>
          <div className="energy-card"><div className="energy-top"><div><span>СПОЖИВАННЯ ЗА ДОБУ</span><strong>{energyConsumption === null ? "—" : energyConsumption.toLocaleString("uk-UA")} <small>кВт·год</small></strong></div><div className="metric-icon amber"><Zap size={18}/></div></div><div className="empty-caption">{energyDate ? "Дата показника: " + new Date(energyDate).toLocaleDateString("uk-UA") : "Atlantic поки не повернув добові дані для цієї установки."}</div></div>
          <div className="energy-card" style={{marginTop:12}}><div className="energy-top"><div><span>ПОГОДИННЕ СПОЖИВАННЯ</span><strong style={{fontSize:20}}>{hourlyEnergy.length ? "Остання доба" : "—"}</strong></div><span className="muted-tag">{hourlyEnergy.length ? hourlyEnergy.length + " інтервалів" : "Немає даних"}</span></div>{hourlyEnergy.length ? <><div className="hourly-chart">{hourlyEnergy.map((item,index)=>{const max=Math.max(...hourlyEnergy.map(x=>x.quantityKwh),0.001);return <div className="hourly-column" key={item.timestamp}><div className="hourly-bar" title={item.quantityKwh.toLocaleString("uk-UA")+" кВт·год"} style={{height:Math.max(3,item.quantityKwh/max*100)+"%"}}/><small>{index%3===0?new Date(item.timestamp*1000).toLocaleTimeString("uk-UA",{hour:"2-digit"}):""}</small></div>})}</div><p className="hourly-note">Інтервали з відповіді Atlantic; статистика може надходити із затримкою.</p></> : <div className="empty-caption">Погодинна статистика поки недоступна від API Atlantic або ще не накопичена.</div>}</div>
          <div className="energy-card" style={{marginTop:12}}>
            <div className="energy-top"><div><span>ВАРТІСТЬ ЗА ДОБУ</span><strong>{energyDayKwh !== null && energyNightKwh !== null ? (energyDayKwh * (new Date().getMonth() >= 9 || new Date().getMonth() <= 3 ? (winterTier === "discount" ? 2.64 : 4.32) : 4.32) + energyNightKwh * (new Date().getMonth() >= 9 || new Date().getMonth() <= 3 ? (winterTier === "discount" ? 1.32 : 2.16) : 2.16)).toLocaleString("uk-UA",{minimumFractionDigits:2,maximumFractionDigits:2}) : "—"} <small>грн</small></strong></div><div className="metric-icon mint"><Zap size={18}/></div></div>
            <div className="tariff-breakdown">
              <div><span>День · 07:00–23:00</span><strong>{energyDayKwh === null ? "—" : energyDayKwh.toLocaleString("uk-UA")} кВт·год</strong></div>
              <div><span>Ніч · 23:00–07:00</span><strong>{energyNightKwh === null ? "—" : energyNightKwh.toLocaleString("uk-UA")} кВт·год</strong></div>
            </div>
            <div className="tariff-choice">
              <span>Зимовий тариф · до 2000 кВт·год/міс.</span>
              <button type="button" className={winterTier === "discount" ? "selected" : ""} onClick={()=>setWinterTier("discount")}>Пільговий</button>
              <button type="button" className={winterTier === "standard" ? "selected" : ""} onClick={()=>setWinterTier("standard")}>Понад ліміт</button>
            </div>
            <p className="hourly-note">Тарифи: день 4,32 / ніч 2,16 грн; у сезон 1 жовтня — 30 квітня пільговий день 2,64 / ніч 1,32 грн. Перемикай «Понад ліміт», якщо загальне споживання квартири за місяць перевищило 2000 кВт·год. Вартість орієнтовна: Cozytouch може показувати споживання всієї установки, а не лише конвектора.</p>
          </div>
          <div className="energy-card" style={{marginTop:12}}>
            <div className="energy-top"><div><span>ПОТУЖНІСТЬ ЗА ОСТАННЮ ГОДИНУ</span><strong style={{fontSize:24}}>{hourlyEnergy.length ? Math.round(hourlyEnergy[hourlyEnergy.length-1].quantityKwh*1000).toLocaleString("uk-UA")+" Вт" : "—"}</strong></div><span className="muted-tag">Середня</span></div>
            <p className="hourly-note">Оцінка середньої потужності за останній погодинний інтервал: кВт·год × 1000. Це не миттєве вимірювання і не показник лише конвектора, якщо в Cozytouch є інші пристрої.</p>
          </div>
          <div className="metric-card tariff"><span>Джерело показника</span><strong>{energyConsumption === null ? "Недоступно" : "Atlantic Cozytouch"}</strong><small>Добовий і погодинний показники — для всієї установки Cozytouch. Миттєва потужність показується окремо лише за наявності відповідного датчика.</small></div>
        </div>}

        {tab === "settings" && <div className="subpage">
          <p className="eyebrow">КОНФІГУРАЦІЯ</p><h1>Налаштування<span>.</span></h1>
          <div className="settings-card"><div className="settings-row"><div className="settings-symbol"><Wifi size={19}/></div><div><strong>Обліковий запис Cozytouch</strong><small>{liveDevice ? "Підключено до Atlantic Home" : "Перевірка підключення"}</small></div><span className="settings-state">{liveDevice ? "Підключено" : "Очікує"}</span></div><div className="settings-row"><div className="settings-symbol"><Flame size={19}/></div><div><strong>Мій конвектор</strong><small>{liveDevice?.name ?? "Altis Eco Boost 3 Wi-Fi · 1000 Вт"}</small></div><span className="settings-state">{liveDevice ? "Знайдено" : "Не перевірено"}</span></div><div className="settings-row"><div className="settings-symbol"><ShieldCheck size={19}/></div><div><strong>Безпека</strong><small>Облікові дані зберігатимуться лише на сервері</small></div><Check size={17} className="check-icon"/></div></div>
          <button className="disconnect-button" onClick={async()=>{await fetch("/api/access/lock",{method:"POST"});window.location.reload();}}>Заблокувати Atlantic Home</button>
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
