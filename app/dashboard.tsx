"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  Flame,
  Gauge,
  House,
  LockKeyhole,
  Minus,
  Plus,
  RefreshCw,
  Settings2,
  Thermometer,
  Wifi,
  Zap,
  Download,
} from "lucide-react";
import Link from "next/link";
import ConnectPanel from "./connect-panel";
import { useAtlantic, modeLabel } from "./use-atlantic";
import {
  averagePowerW,
  buildDailyEnergy,
  calculateEnergyCost,
  numericReading,
  type EnergySample,
  type EnergyRates,
} from "@/lib/energy-pricing";

function useClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

type Tab = "home" | "schedule" | "energy" | "settings";
const TABS = [
  { id: "home", label: "Дім", icon: House },
  { id: "schedule", label: "Розклад", icon: CalendarDays },
  { id: "energy", label: "Енергія", icon: Gauge },
  { id: "settings", label: "Налаштування", icon: Settings2 },
] as const;
const RATES: EnergyRates = {
  discountDay: "2.64",
  discountNight: "1.32",
  standardDay: "4.32",
  standardNight: "2.16",
};
const DAYS = [
  ["Понеділок", "Monday"],
  ["Вівторок", "Tuesday"],
  ["Середа", "Wednesday"],
  ["Четвер", "Thursday"],
  ["П’ятниця", "Friday"],
  ["Субота", "Saturday"],
  ["Неділя", "Sunday"],
] as const;
const number = (value: number | null, digits = 1) =>
  value === null
    ? "—"
    : value.toLocaleString("uk-UA", { maximumFractionDigits: digits });
const time = (value: string | number | null | undefined) =>
  value
    ? new Date(value).toLocaleString("uk-UA", {
        timeZone: "Europe/Kyiv",
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "ще немає";
function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Cloud remains the primary store. */
  }
}
function read(key: string) {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}

function TemperatureControl({
  target,
  enabled,
  busy,
  send,
}: {
  target: number | null;
  enabled: boolean;
  busy: boolean;
  send: (value: number) => void;
}) {
  const [draft, setDraft] = useState(target ?? 21);
  const changed = draft !== target;
  return (
    <div className="temperature-control">
      <div className="target-header">
        <span>Цільова температура</span>
        <span className="small muted">Крок 0,5 °C</span>
      </div>
      <div className="temperature-adjust">
        <button
          className="round-button"
          aria-label="Зменшити температуру"
          disabled={!enabled || busy || draft <= 7}
          onClick={() => setDraft((v) => Math.max(7, v - 0.5))}
        >
          <Minus />
        </button>
        <div className="temperature-value">
          {target === null ? "—" : number(draft)}
          <span>°C</span>
        </div>
        <button
          className="round-button"
          aria-label="Збільшити температуру"
          disabled={!enabled || busy || draft >= 30}
          onClick={() => setDraft((v) => Math.min(30, v + 0.5))}
        >
          <Plus />
        </button>
      </div>
      <input
        className="temperature-range"
        aria-label="Цільова температура"
        type="range"
        min="7"
        max="30"
        step="0.5"
        value={draft}
        disabled={!enabled || busy}
        onChange={(e) => setDraft(Number(e.target.value))}
      />
      <div className="range-labels">
        <span>7 °C</span>
        <span>30 °C</span>
      </div>
      <div className="preset-row" aria-label="Швидкий вибір температури">
        {[18, 20, 22, 24].map((value) => (
          <button
            key={value}
            disabled={!enabled || busy}
            className={draft === value ? "selected" : ""}
            onClick={() => setDraft(value)}
          >
            {value}°
          </button>
        ))}
      </div>
      <button
        className="button primary full"
        disabled={!enabled || busy || !changed}
        onClick={() => send(draft)}
      >
        {busy
          ? "Очікуємо підтвердження…"
          : target === null
            ? "Очікуємо показів"
            : changed
              ? `Встановити ${number(draft)} °C`
              : "Температура встановлена"}
      </button>
      <p className="small muted">
        {target === null
          ? "Поточна ціль ще не отримана від конвектора."
          : `Підтверджено конвектором: ${number(target)} °C`}
      </p>
    </div>
  );
}

type Health = {
  lastSuccessAt?: string | null;
  lastStartedAt?: string | null;
  lastError?: string | null;
  running?: boolean;
};
function CollectionStatus() {
  const [result, setResult] = useState<{
    reason: string;
    health?: Health | null;
    checkedAt: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/cozytouch/background", {
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error();
      setResult({ ...(await response.json()), checkedAt: Date.now() });
    } catch {
      setError("Не вдалося перевірити стан збору.");
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    void Promise.resolve().then(refresh);
  }, [refresh]);
  const age = result?.health?.lastSuccessAt
    ? result.checkedAt - Date.parse(result.health.lastSuccessAt)
    : Infinity;
  const label = !result
    ? "Перевіряємо"
    : result.reason !== "ready"
      ? "Потребує уваги"
      : result.health?.lastError
        ? "Помилка останнього збору"
        : age <= 45 * 60_000
          ? "Покази надходять"
          : result.health?.lastSuccessAt
            ? "Є затримка збору"
            : "Очікуємо першого запуску";
  const reasons: Record<string, string> = {
    neon_missing: "Не підключено сховище історії.",
    session_password_missing:
      "Потрібно перевірити захищене сховище підключення.",
    credentials_missing: "Перепідключи Cozytouch, щоб дозволити збір історії.",
    refresh_token_missing:
      "Atlantic не надав довготривалий доступ. Перепідключи Cozytouch.",
    cron_secret_missing: "Не налаштовано ключ фонового збору.",
  };
  return (
    <section className="card">
      <div className="card-heading">
        <Activity size={20} />
        <h2>Фоновий збір</h2>
        <button
          className="icon-button"
          disabled={busy}
          onClick={refresh}
          aria-label="Перевірити фоновий збір"
        >
          <RefreshCw size={18} className={busy ? "spin" : ""} />
        </button>
      </div>
      <strong>{label}</strong>
      <p className="muted">
        {result?.reason === "ready"
          ? `Останній успішний запис: ${time(result.health?.lastSuccessAt)}. Плановий інтервал — 15 хвилин.`
          : (reasons[result?.reason ?? ""] ??
            "Перевіряємо підключення й останній запуск.")}
      </p>
      {result?.health?.lastError && (
        <p className="notice">
          Остання спроба не завершилась. Наступний запуск повторить зчитування;
          історія збережена.
        </p>
      )}
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      <details>
        <summary>Деталі роботи</summary>
        <p className="small muted">
          Планувальник може запускатися із затримкою. Статус враховує успішний
          збір, а не тільки наявність налаштувань.
        </p>
        <a
          href="https://github.com/XOTT69/atlantic-home/actions"
          target="_blank"
          rel="noreferrer"
        >
          Відкрити журнал запусків ↗
        </a>
      </details>
    </section>
  );
}

function EnergyPanel({
  samples,
  storage,
  installationId,
  loading,
  error,
}: {
  samples: EnergySample[];
  storage: string;
  installationId: string | null;
  loading: boolean;
  error: string;
}) {
  const [days, setDays] = useState<7 | 30>(7);
  const [selected, setSelected] = useState<string | null>(null);
  const [rates, setRates] = useState<EnergyRates>(RATES);
  const [winter, setWinter] = useState(true);
  const [monthly, setMonthly] = useState<Record<string, string>>({});
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [saveState, setSaveState] = useState("");
  const [saving, setSaving] = useState(false);
  const tariffDirty = useRef(false);
  useEffect(() => {
    let active = true;
    const hydrate = (
      saved: {
        rates?: EnergyRates;
        winterDiscountEnabled?: boolean;
        householdMonthlyKwh?: Record<string, string>;
      } | null,
    ) => {
      if (tariffDirty.current) return;
      if (saved?.rates) setRates({ ...RATES, ...saved.rates });
      if (typeof saved?.winterDiscountEnabled === "boolean")
        setWinter(saved.winterDiscountEnabled);
      if (saved?.householdMonthlyKwh) setMonthly(saved.householdMonthlyKwh);
    };
    const load = async () => {
      hydrate(read("atlantic-home-electricity-tariff-v2"));
      try {
        if (installationId) {
          const response = await fetch(
            `/api/cozytouch/energy/settings?installationId=${installationId}`,
            { cache: "no-store", signal: AbortSignal.timeout(15_000) },
          );
          if (!response.ok) throw new Error();
          const data = await response.json();
          if (active) hydrate(data.settings);
        }
      } catch {
        if (active)
          setSaveState(
            "Хмарні тарифи не завантажено. Доступна локальна копія.",
          );
      } finally {
        if (active) setSettingsLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [installationId]);
  const now = useClock();
  const series = useMemo(
    () => buildDailyEnergy(samples, days, now),
    [samples, days, now],
  );
  const total = series.reduce((sum, day) => sum + day.kwh, 0);
  const hasData = series.some(
    (day) => day.coveredMinutes + day.estimatedMinutes > 0,
  );
  const cost = calculateEnergyCost(series, monthly, rates, winter);
  const months = [
    ...new Set(
      series.filter((day) => day.kwh > 0).map((day) => day.key.slice(0, 7)),
    ),
  ].filter((key) => {
    const m = Number(key.slice(5));
    return winter && (m >= 10 || m <= 4);
  });
  const max = Math.max(...series.map((day) => day.kwh), 0.001);
  const day = series.find((day) => day.key === selected);
  async function save() {
    const settings = {
      rates,
      winterDiscountEnabled: winter,
      householdMonthlyKwh: monthly,
    };
    store("atlantic-home-electricity-tariff-v2", settings);
    setSaving(true);
    setSaveState("");
    try {
      if (!installationId)
        throw new Error("Тарифи збережено лише на цьому пристрої.");
      const response = await fetch("/api/cozytouch/energy/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ installationId, settings }),
        signal: AbortSignal.timeout(15_000),
      });
      const data = await response.json();
      if (!response.ok || !data.saved)
        throw new Error(
          data.error ??
            "Хмарне збереження недоступне. Локальна копія збережена.",
        );
      setSaveState("Тарифи збережено у хмарі.");
    } catch (cause) {
      setSaveState(
        cause instanceof Error ? cause.message : "Не вдалося зберегти тарифи.",
      );
    } finally {
      setSaving(false);
    }
  }
  function exportCsv() {
    const rows = [
      ["Дата", "кВт·год", "День", "Ніч", "Покриття, хв", "Оцінено, хв"],
      ...series.map((day) => [
        day.key,
        day.coveredMinutes + day.estimatedMinutes ? day.kwh.toFixed(3) : "",
        day.dayKwh.toFixed(3),
        day.nightKwh.toFixed(3),
        day.coveredMinutes.toFixed(0),
        day.estimatedMinutes.toFixed(0),
      ]),
    ];
    const csv = "\uFEFF" + rows.map((row) => row.join(";")).join("\r\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `atlantic-energy-${days}-days.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div className="screen-stack">
      <section className="card">
        <div className="card-heading">
          <Gauge size={20} />
          <h2>Споживання та вартість</h2>
        </div>
        <div className="segmented">
          {([7, 30] as const).map((value) => (
            <button
              key={value}
              aria-pressed={days === value}
              className={days === value ? "selected" : ""}
              onClick={() => {
                setDays(value);
                setSelected(null);
              }}
            >
              {value} днів
            </button>
          ))}
        </div>
        <div className="energy-totals">
          <div>
            <span className="muted">Збережений обсяг</span>
            <strong>
              {number(hasData ? total : null, 3)} <small>кВт·год</small>
            </strong>
          </div>
          <div>
            <span className="muted">Орієнтовна вартість</span>
            <strong>
              {number(hasData ? cost.cost : null, 2)} <small>грн</small>
            </strong>
          </div>
        </div>
        {loading && (
          <p className="muted" role="status">
            Завантажуємо історію…
          </p>
        )}
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {hasData ? (
          <>
            <div
              className="energy-chart"
              role="group"
              aria-label={`Споживання за ${days} днів. Торкнися стовпчика для деталей.`}
            >
              {series.map((item, index) => (
                <button
                  key={item.key}
                  className={`chart-column ${item.coveredMinutes + item.estimatedMinutes === 0 ? "missing" : ""} ${item.estimatedMinutes > 0 ? "estimated" : ""} ${selected === item.key ? "active" : ""}`}
                  aria-pressed={selected === item.key}
                  aria-label={`${item.label}: ${item.coveredMinutes + item.estimatedMinutes ? number(item.kwh, 3) + " кВт·год" : "немає даних"}`}
                  onClick={() => setSelected(item.key)}
                >
                  <span className="chart-track">
                    <span
                      className="chart-bar"
                      style={{
                        height: `${Math.max(2, (item.kwh / max) * 100)}%`,
                      }}
                    />
                  </span>
                  <span className="chart-date">
                    {days === 7 ||
                    index % 6 === 0 ||
                    index === series.length - 1
                      ? item.label
                      : ""}
                  </span>
                </button>
              ))}
            </div>
            <p className="small muted">
              Торкнися дня, щоб побачити деталі. Штрихування — розподіл через
              тривалу паузу; риска — немає даних.
            </p>
            {day && (
              <div className="notice" role="status">
                <strong>
                  {day.label}:{" "}
                  {number(
                    day.coveredMinutes + day.estimatedMinutes ? day.kwh : null,
                    3,
                  )}{" "}
                  кВт·год
                </strong>
                <br />
                День {number(day.dayKwh, 3)} · ніч {number(day.nightKwh, 3)}.
                Інтервали до 45 хв: {Math.round(day.coveredMinutes)} хв; довші
                паузи: {Math.round(day.estimatedMinutes)} хв.
              </div>
            )}
          </>
        ) : (
          !loading && (
            <div className="empty-state">
              <Gauge size={32} />
              <h3>Історія накопичується</h3>
              <p>
                Потрібно щонайменше два покази лічильника. Дані з’являться після
                наступного зчитування.
              </p>
            </div>
          )
        )}
        <details>
          <summary>Таблиця показів за днями</summary>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>кВт·год</th>
                  <th>Якість</th>
                </tr>
              </thead>
              <tbody>
                {series.map((day) => (
                  <tr key={day.key}>
                    <td>{day.label}</td>
                    <td>
                      {number(
                        day.coveredMinutes + day.estimatedMinutes
                          ? day.kwh
                          : null,
                        3,
                      )}
                    </td>
                    <td>
                      {day.estimatedMinutes
                        ? "Є довга пауза"
                        : day.coveredMinutes
                          ? "За інтервалами"
                          : "Немає даних"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
        <button
          className="button secondary"
          disabled={!hasData}
          onClick={exportCsv}
        >
          <Download size={17} /> Експорт CSV
        </button>
        <p className="small muted">
          Обсяг — різниця накопичувального лічильника. Розподіл між годинами
          оцінений. Ніч: 23:00–07:00, часовий пояс Києва.{" "}
          {storage === "ready"
            ? "Історія зберігається у хмарі."
            : "Хмарна історія недоступна."}
        </p>
      </section>
      <section className="card">
        <details>
          <summary className="section-summary">
            Тарифи та розрахунок <ChevronDown size={18} />
          </summary>
          <div className="form-grid tariff-form">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={winter}
                disabled={settingsLoading}
                onChange={(e) => {
                  tariffDirty.current = true;
                  setWinter(e.target.checked);
                }}
              />
              <span>
                Зимовий пільговий тариф
                <small>
                  Жовтень–квітень; за оформленої пільги та загального споживання
                  житла до 2000 кВт·год включно.
                </small>
              </span>
            </label>
            {months.map((key) => (
              <label key={key}>
                Споживання всього житла за {key}, кВт·год
                <input
                  inputMode="decimal"
                  disabled={settingsLoading}
                  placeholder="Наприклад, 1800"
                  value={monthly[key] ?? ""}
                  onChange={(e) => {
                    tariffDirty.current = true;
                    setMonthly((previous) => ({
                      ...previous,
                      [key]: e.target.value.replace(/[^0-9,.]/g, ""),
                    }));
                  }}
                />
              </label>
            ))}
            <div className="two-columns">
              {(Object.keys(RATES) as (keyof EnergyRates)[]).map((key) => (
                <label key={key}>
                  {
                    {
                      discountDay: "Пільговий · день",
                      discountNight: "Пільговий · ніч",
                      standardDay: "Стандартний · день",
                      standardNight: "Стандартний · ніч",
                    }[key]
                  }
                  <input
                    inputMode="decimal"
                    disabled={settingsLoading}
                    value={rates[key]}
                    onChange={(e) => {
                      tariffDirty.current = true;
                      setRates((previous) => ({
                        ...previous,
                        [key]: e.target.value.replace(/[^0-9,.]/g, ""),
                      }));
                    }}
                  />
                </label>
              ))}
            </div>
            <p className="small muted">
              Ціни в грн/кВт·год. Застосовуємо ставки й поріг, які ти задав.
              Понад 2000 кВт·год — стандартна ставка для місяця.
            </p>
            <button
              className="button primary"
              disabled={settingsLoading || saving}
              onClick={save}
            >
              {saving ? "Зберігаємо…" : "Зберегти тарифи"}
            </button>
            <p role="status" className="small">
              {saveState}
            </p>
          </div>
        </details>
        {hasData && cost.cost === null && (
          <p className="notice">
            Для розрахунку вартості внеси загальне споживання житла за місяць у
            тарифах. Порожнє значення не вважаємо нулем.
          </p>
        )}
      </section>
      <CollectionStatus />
    </div>
  );
}

function Diagnostics() {
  const [report, setReport] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function load() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/cozytouch/state?diagnostics=1", {
        cache: "no-store",
        signal: AbortSignal.timeout(45_000),
      });
      const data = await response.json();
      if (!response.ok) throw new Error();
      setReport(JSON.stringify(data, null, 2));
    } catch {
      setMessage("Не вдалося завантажити діагностику.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card">
      <details>
        <summary className="section-summary">
          Діагностика пристрою <ChevronDown size={18} />
        </summary>
        <p className="small muted">
          Повні покази й доступні команди зчитуються окремо, щоб звичайне
          оновлення працювало швидше.
        </p>
        <button className="button secondary" disabled={busy} onClick={load}>
          {busy ? "Зчитуємо…" : "Завантажити діагностику"}
        </button>
        {report && (
          <>
            <pre>{report}</pre>
            <button
              className="button secondary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(report);
                  setMessage("Діагностику скопійовано.");
                } catch {
                  setMessage("Копіювання недоступне в цьому браузері.");
                }
              }}
            >
              Скопіювати звіт
            </button>
          </>
        )}
        <p className="small" role="status">
          {message}
        </p>
      </details>
    </section>
  );
}

function ReadabilitySettings() {
  const [large, setLarge] = useState(false);
  useEffect(() => {
    void Promise.resolve().then(() => {
      const saved = read("atlantic-home-large-text") === true;
      setLarge(saved);
      document.documentElement.dataset.textSize = saved ? "large" : "normal";
    });
  }, []);
  function choose(value: boolean) {
    setLarge(value);
    document.documentElement.dataset.textSize = value ? "large" : "normal";
    store("atlantic-home-large-text", value);
  }
  return (
    <section className="card">
      <h2>Розмір тексту</h2>
      <p className="muted">Обери комфортний розмір для цього пристрою.</p>
      <div className="segmented">
        <button
          aria-pressed={!large}
          className={!large ? "selected" : ""}
          onClick={() => choose(false)}
        >
          Звичайний
        </button>
        <button
          aria-pressed={large}
          className={large ? "selected" : ""}
          onClick={() => choose(true)}
        >
          Збільшений
        </button>
      </div>
    </section>
  );
}

export default function Dashboard({ initialTab }: { initialTab?: string }) {
  const [tab, setTab] = useState<Tab>(
    TABS.some((item) => item.id === initialTab) ? (initialTab as Tab) : "home",
  );
  const atlantic = useAtlantic();
  const {
    snapshot,
    loading,
    error,
    reconnect,
    busy,
    commandMessage,
    events,
    refresh,
    send,
  } = atlantic;
  const [samples, setSamples] = useState<EnergySample[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [deviceName, setDeviceName] = useState("Atlantic Altis");
  const [room, setRoom] = useState("");
  const [profileMessage, setProfileMessage] = useState("");
  const [profileBusy, setProfileBusy] = useState(false);
  const [deviceRecords, setDeviceRecords] = useState<Record<string, unknown>[]>(
    [],
  );
  const [profileReady, setProfileReady] = useState(false);
  const profileDirty = useRef(false);
  const [profileCloudReady, setProfileCloudReady] = useState(false);
  const id = snapshot?.telemetry.energyHistoryId ?? null;
  useEffect(() => {
    const sync = () => {
      const value = new URLSearchParams(location.search).get("tab");
      setTab(TABS.some((tab) => tab.id === value) ? (value as Tab) : "home");
    };
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  function navigate(next: Tab) {
    setTab(next);
    const url = new URL(location.href);
    if (next === "home") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    history.pushState(null, "", url);
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      if (!id) return;
      if (document.visibilityState !== "visible") {
        timer = setTimeout(load, 300_000);
        return;
      }
      setHistoryLoading(true);
      try {
        const response = await fetch(
          `/api/cozytouch/energy?installationId=${id}`,
          {
            cache: "no-store",
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(15_000),
            ]),
          },
        );
        const data = await response.json();
        if (!response.ok) throw new Error();
        if (active) {
          setSamples(Array.isArray(data.samples) ? data.samples : []);
          setHistoryError("");
        }
      } catch {
        if (active)
          setHistoryError(
            "Історію не оновлено. Показуємо останні завантажені дані.",
          );
      } finally {
        if (active) {
          setHistoryLoading(false);
          timer = setTimeout(load, 300_000);
        }
      }
    };
    void load();
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [id]);
  useEffect(() => {
    let active = true;
    const load = async () => {
      const local = read("atlantic-home-heater-profile");
      if (!profileDirty.current) {
        if (local?.name) setDeviceName(String(local.name));
        if (local?.room) setRoom(String(local.room));
      }
      try {
        if (id) {
          const response = await fetch(
            `/api/cozytouch/devices?installationId=${id}`,
            { cache: "no-store", signal: AbortSignal.timeout(15_000) },
          );
          if (!response.ok) throw new Error();
          const data = await response.json();
          if (active) setProfileCloudReady(true);
          if (active && Array.isArray(data.devices)) {
            setDeviceRecords(data.devices);
            const heater = data.devices.find(
              (item: Record<string, unknown>) =>
                item.type === "atlantic-heater",
            );
            if (heater && !profileDirty.current) {
              setDeviceName(heater.name);
              setRoom(heater.room);
            }
          }
        }
      } catch {
        if (active)
          setProfileMessage(
            "Хмарні дані пристрою не завантажено. Доступна локальна копія.",
          );
      } finally {
        if (active) setProfileReady(true);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [id]);
  async function saveProfile() {
    const name = deviceName.trim();
    if (!name) {
      setProfileMessage("Вкажи назву конвектора.");
      return;
    }
    store("atlantic-home-heater-profile", { name, room });
    setProfileBusy(true);
    const heater = {
      id: "atlantic-altis",
      type: "atlantic-heater",
      name,
      room: room.trim(),
    };
    const records = [
      ...deviceRecords.filter((record) => record.type !== "atlantic-heater"),
      heater,
    ];
    try {
      if (!id || !profileCloudReady)
        throw new Error(
          "Збережено на цьому пристрої. Хмарне збереження стане доступним після зчитування лічильника.",
        );
      const response = await fetch("/api/cozytouch/devices", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ installationId: id, devices: records }),
        signal: AbortSignal.timeout(15_000),
      });
      const data = await response.json();
      if (!response.ok || !data.saved)
        throw new Error(data.error ?? "Хмарне збереження недоступне.");
      setDeviceRecords(records);
      profileDirty.current = false;
      setProfileMessage("Назву й кімнату збережено у хмарі.");
    } catch (cause) {
      setProfileMessage(
        cause instanceof Error ? cause.message : "Не вдалося зберегти зміни.",
      );
    } finally {
      setProfileBusy(false);
    }
  }
  const states = snapshot?.heater.states ?? {};
  const target = numericReading(states.TargetTemperature);
  const roomTemp = numericReading(snapshot?.telemetry.roomTemperature);
  const on = states.OnOff === "on";
  const powerKnown = states.OnOff === "on" || states.OnOff === "off";
  const modeKnown = typeof states.OperatingMode === "string";
  const enabled = !error && snapshot?.deviceStatus === "online";
  const supported = (command: string) =>
    snapshot?.heater.supportedCommands.some(
      (item) => item.commandName === command,
    ) ?? false;
  const now = useClock();
  const today = useMemo(
    () => buildDailyEnergy(samples, 1, now)[0],
    [samples, now],
  );
  const todayKwh =
    today && today.coveredMinutes + today.estimatedMinutes > 0
      ? today.kwh
      : null;
  const meter = numericReading(snapshot?.telemetry.cumulativeEnergyWh);
  const avg = averagePowerW(samples);
  const activeSchedule = states.OperatingMode === "prog";
  const title = TABS.find((item) => item.id === tab)?.label ?? "Дім";
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate("home");
          }}
        >
          <span className="brand-mark">
            <Flame size={23} />
          </span>
          <span>
            Atlantic<span className="brand-light"> Home</span>
          </span>
        </Link>
        <p className="sidebar-caption">Твій домашній клімат</p>
        <nav aria-label="Основна навігація">
          {TABS.map((item) => (
            <button
              key={item.id}
              aria-current={tab === item.id ? "page" : undefined}
              className={tab === item.id ? "nav-active" : ""}
              onClick={() => navigate(item.id)}
            >
              <item.icon size={20} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-device">
          <Flame size={20} />
          <span>
            {deviceName}
            <small>Конвектор · 1000 Вт</small>
          </span>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span className="mobile-brand">
            <Flame size={21} /> Atlantic Home
          </span>
          <span className="desktop-breadcrumb">
            Мій дім <span>/</span> {title}
          </span>
          <div className="top-actions">
            <span className={`connection-badge ${enabled ? "online" : ""}`}>
              <span />
              {loading && !snapshot
                ? "Перевірка"
                : error
                  ? "Зв’язок перервано"
                  : snapshot?.deviceStatus === "online"
                    ? "Онлайн"
                    : snapshot?.deviceStatus === "offline"
                      ? "Офлайн"
                      : "Очікування"}
            </span>
            <button
              className="icon-button"
              aria-label="Оновити покази конвектора"
              onClick={() => void refresh()}
            >
              <RefreshCw size={19} className={loading ? "spin" : ""} />
            </button>
          </div>
        </header>
        <main className="page-content" id="main-content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">{room || "МІЙ ДІМ"} · ATLANTIC</p>
              <h1>
                {tab === "home"
                  ? "Комфорт під контролем"
                  : tab === "schedule"
                    ? "Тижневий розклад"
                    : tab === "energy"
                      ? "Енергія твого дому"
                      : "Налаштування"}
              </h1>
              <p className="muted">
                {tab === "home"
                  ? "Температура, керування та покази твого конвектора."
                  : tab === "schedule"
                    ? "Вбудована програма працює на конвекторі навіть із закритим застосунком."
                    : tab === "energy"
                      ? "Споживання за лічильником. Зрозумілі підсумки та оцінка вартості."
                      : "Пристрій, підключення й історія керування."}
              </p>
            </div>
            {snapshot && (
              <span className="updated-at">
                Оновлено {time(snapshot.updatedAt)}
              </span>
            )}
          </div>
          {error && (
            <div className="notice error" role="alert">
              <Wifi size={20} />
              <div>
                {error}
                <div className="button-row">
                  {reconnect && (
                    <button
                      className="text-button"
                      onClick={() => navigate("settings")}
                    >
                      Налаштування підключення <ArrowRight size={16} />
                    </button>
                  )}
                  <Link href="/">Відкрити застосунок знову</Link>
                </div>
              </div>
            </div>
          )}
          {!error && snapshot && !enabled && (
            <p className="notice">
              {snapshot.gatewayOnline
                ? "Шлюз відповідає, але свіжий стан конвектора не підтверджено."
                : "Шлюз Cozytouch не підтвердив зв’язок. Керування доступне після відновлення."}
            </p>
          )}
          {commandMessage && (
            <div className="notice" role="status">
              <Activity size={19} />
              <span>{commandMessage}</span>
            </div>
          )}
          {tab === "home" && (
            <>
              <div className="summary-grid">
                <article className="stat-card">
                  <span className="stat-icon blue">
                    <Thermometer size={22} />
                  </span>
                  <span className="muted">У кімнаті</span>
                  <strong>
                    {number(roomTemp)}
                    <small> °C</small>
                  </strong>
                  <span className="small muted">
                    {snapshot?.telemetry.roomTemperatureStatus === "online" &&
                    !error
                      ? "Показ датчика конвектора"
                      : "Свіжість не підтверджено"}
                  </span>
                </article>
                <article className="stat-card">
                  <span className="stat-icon amber">
                    <Zap size={22} />
                  </span>
                  <span className="muted">Споживання сьогодні</span>
                  <strong>
                    {number(todayKwh, 3)}
                    <small> кВт·год</small>
                  </strong>
                  <button
                    className="text-button"
                    onClick={() => navigate("energy")}
                  >
                    Переглянути історію <ArrowRight size={15} />
                  </button>
                </article>
                <article className="stat-card">
                  <span className="stat-icon mint">
                    <CalendarDays size={22} />
                  </span>
                  <span className="muted">Режим конвектора</span>
                  <strong className="text-value">
                    {modeLabel(states.OperatingMode)}
                  </strong>
                  <span className="small muted">
                    {on
                      ? "Живлення увімкнено"
                      : states.OnOff === "off"
                        ? "Живлення вимкнено"
                        : "Стан ще не отримано"}
                  </span>
                </article>
              </div>
              <div className="home-grid">
                <section className="card heater-card">
                  <div className="card-heading">
                    <span className="device-symbol">
                      <Flame size={23} />
                    </span>
                    <div>
                      <h2>{deviceName}</h2>
                      <p className="small muted">
                        {room ? room + " · " : ""}Atlantic Cozytouch · 1000 Вт
                      </p>
                    </div>
                    <button
                      className={`power-toggle ${on ? "on" : ""}`}
                      aria-label={
                        !powerKnown ? "Живлення: стан невідомий" : on ? "Вимкнути конвектор" : "Увімкнути конвектор"
                      }
                      aria-pressed={on}
                      disabled={
                        !enabled ||
                        !powerKnown ||
                        busy ||
                        !supported(on ? "off" : "on")
                      }
                      onClick={() => void send("power", !on)}
                    >
                      <span className="power-symbol">⏻</span>
                    </button>
                  </div>
                  <TemperatureControl
                    key={target ?? "unknown"}
                    target={target}
                    enabled={
                      !!enabled &&
                      target !== null &&
                      supported("setTargetTemperature")
                    }
                    busy={busy}
                    send={(value) => void send("temperature", value)}
                  />
                </section>
                <div className="screen-stack">
                  <section className="card">
                    <div className="card-heading">
                      <CalendarDays size={20} />
                      <h2>Керування режимом</h2>
                    </div>
                    <div className="mode-status">
                      <span
                        className={`mode-orb ${activeSchedule ? "active" : ""}`}
                      >
                        <CalendarDays size={25} />
                      </span>
                      <div>
                        <strong>
                          {activeSchedule
                            ? "Працює розклад"
                            : "Розклад на паузі"}
                        </strong>
                        <p className="small muted">
                          {modeLabel(states.OperatingMode)}
                        </p>
                      </div>
                    </div>
                    <button
                      className="button secondary full"
                      disabled={
                        !enabled ||
                        !modeKnown ||
                        busy ||
                        !supported("setOperatingMode")
                      }
                      onClick={() =>
                        void send("mode", activeSchedule ? "manual" : "prog")
                      }
                    >
                      {activeSchedule
                        ? "Перейти в ручний режим"
                        : "Увімкнути розклад"}
                    </button>
                    <button
                      className="text-button"
                      onClick={() => navigate("schedule")}
                    >
                      Деталі розкладу <ArrowRight size={16} />
                    </button>
                  </section>
                  <section className="card quiet-card">
                    <div className="card-heading">
                      <Gauge size={20} />
                      <h2>Лічильник енергії</h2>
                    </div>
                    <strong className="meter-value">
                      {number(meter === null ? null : meter / 1000, 3)}{" "}
                      <small>кВт·год</small>
                    </strong>
                    <p className="small muted">
                      Накопичений показ за весь час. Це не споживання за
                      сьогодні.
                    </p>
                    {avg !== null && (
                      <p>
                        Середня потужність за останній інтервал:{" "}
                        <strong>{number(avg, 0)} Вт</strong>.
                      </p>
                    )}
                    <p className="small muted">
                      Миттєву потужність і напругу наявні датчики не передають.
                      Номінал 1000 Вт не означає постійне споживання.
                    </p>
                  </section>
                </div>
              </div>
            </>
          )}
          {tab === "schedule" && (
            <div className="screen-stack">
              <section className="card">
                <div className="card-heading">
                  <CalendarDays size={22} />
                  <h2>Розклад конвектора</h2>
                  <span className="badge">
                    {activeSchedule ? "Увімкнено" : "На паузі"}
                  </span>
                </div>
                <p className="muted">
                  {activeSchedule
                    ? "Зараз використовується тижнева програма, збережена в конвекторі."
                    : "Зараз конвектор використовує інший режим. Можна увімкнути його збережену програму."}
                </p>
                <button
                  className="button primary"
                  disabled={
                    !enabled ||
                    !modeKnown ||
                    busy ||
                    !supported("setOperatingMode")
                  }
                  onClick={() =>
                    void send("mode", activeSchedule ? "manual" : "prog")
                  }
                >
                  {busy
                    ? "Очікуємо підтвердження…"
                    : activeSchedule
                      ? "Вимкнути розклад"
                      : "Увімкнути розклад"}
                </button>
                <p className="small muted">
                  Вимкнення розкладу переводить у ручний режим. Живлення
                  перемикається окремо на головному екрані.
                </p>
              </section>
              <section className="card">
                <h2>Програма за днями</h2>
                <p className="muted">
                  Нижче — дані поточної програми. Змінювати часові інтервали
                  поки можна в Cozytouch; формат запису для цього конвектора ще
                  потребує перевірки.
                </p>
                <div className="program-list">
                  {DAYS.map(([label, key]) => (
                    <details key={key}>
                      <summary>
                        {label}
                        <span className="small muted">
                          {states[key + "TimeProgram"] === undefined
                            ? "Даних немає"
                            : "Програму отримано"}
                        </span>
                      </summary>
                      <ProgramValue value={states[key + "TimeProgram"]} />
                    </details>
                  ))}
                </div>
              </section>
            </div>
          )}
          {tab === "energy" && (
            <EnergyPanel
              samples={samples}
              storage={snapshot?.telemetry.energyStorage ?? "not_configured"}
              installationId={id}
              loading={historyLoading}
              error={historyError}
            />
          )}
          {tab === "settings" && (
            <div className="settings-grid">
              <div className="screen-stack">
                <section className="card">
                  <div className="card-heading">
                    <Flame size={21} />
                    <h2>Твій конвектор</h2>
                  </div>
                  <form
                    className="form-grid"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void saveProfile();
                    }}
                  >
                    <label>
                      Назва
                      <input
                        required
                        maxLength={64}
                        value={deviceName}
                        disabled={!profileReady}
                        onChange={(e) => {
                          profileDirty.current = true;
                          setDeviceName(e.target.value);
                        }}
                      />
                    </label>
                    <label>
                      Кімната
                      <input
                        maxLength={50}
                        value={room}
                        disabled={!profileReady}
                        placeholder="Наприклад, спальня"
                        onChange={(e) => {
                          profileDirty.current = true;
                          setRoom(e.target.value);
                        }}
                      />
                    </label>
                    <button
                      className="button primary"
                      disabled={!profileReady || profileBusy}
                    >
                      {profileBusy ? "Зберігаємо…" : "Зберегти пристрій"}
                    </button>
                    <p className="small" role="status">
                      {profileMessage}
                    </p>
                  </form>
                </section>
                <ReadabilitySettings />
                <ConnectPanel
                  connected={!!snapshot && !reconnect}
                  onConnected={() => void refresh()}
                />
                <section className="card">
                  <div className="card-heading">
                    <LockKeyhole size={20} />
                    <h2>Особистий доступ</h2>
                  </div>
                  <p className="muted">
                    Блокування закриває панель керування. Конвектор і фоновий
                    збір продовжують працювати.
                  </p>
                  <button
                    className="button secondary"
                    onClick={async () => {
                      try {
                        const response = await fetch("/api/access/lock", {
                          method: "POST",
                        });
                        if (!response.ok) throw new Error();
                        location.reload();
                      } catch {
                        setProfileMessage(
                          "Не вдалося заблокувати застосунок. Спробуй ще раз.",
                        );
                      }
                    }}
                  >
                    Заблокувати Atlantic Home
                  </button>
                </section>
              </div>
              <div className="screen-stack">
                <CollectionStatus />
                <Diagnostics />
                <section className="card">
                  <div className="card-heading">
                    <Activity size={20} />
                    <h2>Журнал керування</h2>
                  </div>
                  <p className="small muted">
                    Команди цієї відкритої сесії. Статус підтвердження
                    перевіряємо за відповіддю конвектора.
                  </p>
                  {events.length ? (
                    <ol className="event-list">
                      {events.map((event) => (
                        <li key={event.id}>
                          <span className={`event-dot ${event.status}`} />
                          <div>
                            <strong>{event.label}</strong>
                            <p className="small muted">
                              {time(event.at)} ·{" "}
                              {
                                {
                                  sending: "Надсилаємо",
                                  accepted: "Прийнято хмарою",
                                  confirmed: "Підтверджено",
                                  unconfirmed: "Не підтверджено",
                                  failed: "Помилка",
                                }[event.status]
                              }
                            </p>
                          </div>
                          {event.status === "confirmed" && <Check size={17} />}
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <div className="empty-state compact">
                      <Activity size={28} />
                      <p>Нові команди з’являться тут.</p>
                    </div>
                  )}
                </section>
              </div>
            </div>
          )}
          <footer className="page-footer">
            <span>Atlantic Home</span>
            <span>Клімат під твоїм контролем</span>
          </footer>
        </main>
      </div>
      <nav className="bottom-nav" aria-label="Мобільна навігація">
        {TABS.map((item) => (
          <button
            key={item.id}
            aria-current={tab === item.id ? "page" : undefined}
            className={tab === item.id ? "nav-active" : ""}
            onClick={() => navigate(item.id)}
          >
            <item.icon size={21} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

function ProgramValue({ value }: { value: unknown }) {
  if (value === undefined || value === null)
    return <p className="muted">Конвектор не передав програму цього дня.</p>;
  // Unknown provider formats are preserved rather than turned into invented intervals.
  return (
    <details className="raw-program">
      <summary>Дані програми від конвектора</summary>
      <pre>
        {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}
