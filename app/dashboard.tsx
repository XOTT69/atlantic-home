"use client";

import { useEffect, useRef, useState } from "react";
import ConnectPanel from "./connect-panel";
import {
  Activity, ArrowUpRight, CalendarDays, Check, ChevronRight, CircleHelp, Download,
  Flame, Gauge, House, Power, Settings2, ShieldCheck, Thermometer, Wifi, Wind, Plus, Trash2,
  Zap, RefreshCw
} from "lucide-react";
import { buildDailyEnergy, calculateEnergyCost, type EnergyRates } from "@/lib/energy-pricing";

type Tab = "home" | "schedule" | "energy" | "devices" | "settings";
type EnergyDiagnostics = {
  dailyErrorCode?: string | null;
  hourlyErrorCode?: string | null;
  hourlyErrorDetails?: string | null;
  daily?: { seriesCount?: number; parsedPeriods?: number } | null;
  hourly?: { seriesCount?: number; parsedPeriods?: number } | null;
  devices?: {
    name: string;
    model: string | null;
    states: string[];
    readings: { name: unknown; value: unknown }[];
  }[];
};

type EnergySnapshot = { at: number; wh: number };
type EnergyEstimate = { kwh: number; caption: string };
type EnergyHistorySample = { sampledAt: number; cumulativeEnergyWh: number };
type ManagedDevice = { id: string; type: "atlantic-heater" | "mycond-roomer-12" | "custom"; name: string; room: string };
type MycondFunction = { code: string; type?: string; values?: string; name?: string; desc?: string };
type MycondSnapshot = { configured: boolean; online: boolean | null; deviceName: string | null; statuses: { code: string; value: unknown }[]; functions: MycondFunction[]; error?: string };
const WEEKLY_PROGRAMS = [
  ["Понеділок", "MondayTimeProgram"], ["Вівторок", "TuesdayTimeProgram"],
  ["Середа", "WednesdayTimeProgram"], ["Четвер", "ThursdayTimeProgram"],
  ["П’ятниця", "FridayTimeProgram"], ["Субота", "SaturdayTimeProgram"],
  ["Неділя", "SundayTimeProgram"]
] as const;
const ENERGY_SNAPSHOT_KEY = "atlantic-home-energy-snapshots-v1";
const ENERGY_TARIFF_KEY = "atlantic-home-electricity-tariff-v2";
const DEVICE_LIST_KEY = "atlantic-home-devices-v1";
const DEFAULT_DEVICES: ManagedDevice[] = [
  { id: "atlantic-altis", type: "atlantic-heater", name: "Atlantic Altis Eco Boost 3", room: "" },
  { id: "mycond-roomer-12", type: "mycond-roomer-12", name: "Mycond Roomer Smart 12", room: "" }
];
const DEFAULT_ENERGY_RATES: EnergyRates = {
  discountDay: "2.64",
  discountNight: "1.32",
  standardDay: "4.32",
  standardNight: "2.16"
};

function localDateKey(at: number) {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseManagedDevices(value: unknown): ManagedDevice[] | null {
  if (!Array.isArray(value) || value.length > 30) return null;
  const parsed: ManagedDevice[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const device = item as Record<string, unknown>;
    if (typeof device.id !== "string" || typeof device.name !== "string" || typeof device.room !== "string" ||
      !["atlantic-heater", "mycond-roomer-12", "custom"].includes(String(device.type))) return null;
    parsed.push({
      id: device.id,
      type: device.type as ManagedDevice["type"],
      name: device.name.slice(0, 64),
      room: device.room.slice(0, 50)
    });
  }
  return parsed;
}

function rememberEnergyReading(wh: number, now = Date.now()): EnergyEstimate | null {
  if (!Number.isFinite(wh) || wh < 0) return null;
  let history: EnergySnapshot[] = [];
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(ENERGY_SNAPSHOT_KEY) ?? "[]");
    if (Array.isArray(stored)) history = stored.filter((item): item is EnergySnapshot =>
      !!item && typeof item === "object" && Number.isFinite(item.at) && Number.isFinite(item.wh) && item.wh >= 0
    );
  } catch { /* Start a fresh local history if storage is unavailable or malformed. */ }

  const latest = history[history.length - 1];
  if (!latest || now - latest.at >= 60_000) history.push({ at: now, wh });
  else history[history.length - 1] = { at: now, wh };
  history = history.filter(item => item.at >= now - 32 * 24 * 60 * 60 * 1000).slice(-5000);
  try { window.localStorage.setItem(ENERGY_SNAPSHOT_KEY, JSON.stringify(history)); } catch { /* The live reading still works without saved history. */ }

  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const beforeToday = [...history].reverse().find(item => item.at < dayStart.getTime());
  const today = history.filter(item => item.at >= dayStart.getTime());
  const baseline = beforeToday ?? today[0];
  const totalWh = history[history.length - 1]?.wh ?? wh;
  if (!baseline || totalWh < baseline.wh) return null;
  return {
    kwh: Number(((totalWh - baseline.wh) / 1000).toFixed(3)),
    caption: beforeToday ? "Орієнтовно від початку доби · локальна історія" : "Від першого вимірювання сьогодні"
  };
}


export default function HomePage() {
  const [tab, setTab] = useState<Tab>("home");
  const [power, setPower] = useState(false);
  const [temperature, setTemperature] = useState(21);
  const [roomTemperature, setRoomTemperature] = useState<number | null>(null);
  const [energyConsumption, setEnergyConsumption] = useState<number | null>(null);
  const [cumulativeEnergyKwh, setCumulativeEnergyKwh] = useState<number | null>(null);
  const [observedTodayEnergy, setObservedTodayEnergy] = useState<EnergyEstimate | null>(null);
  const [energyHistoryId, setEnergyHistoryId] = useState<string | null>(null);
  const [energyStorage, setEnergyStorage] = useState<"ready" | "not_configured" | "error">("not_configured");
  const [backgroundCollection, setBackgroundCollection] = useState<"checking" | "ready" | "reconnect" | "unavailable" | "error">("checking");
  const [energyHistory, setEnergyHistory] = useState<EnergyHistorySample[]>([]);
  const [energyChartDays, setEnergyChartDays] = useState<7 | 30>(7);
  const [energyRates, setEnergyRates] = useState<EnergyRates>(DEFAULT_ENERGY_RATES);
  const [winterDiscountEnabled, setWinterDiscountEnabled] = useState(true);
  const [householdMonthlyKwh, setHouseholdMonthlyKwh] = useState<Record<string, string>>({});
  const [rateReady, setRateReady] = useState(false);
  const [tariffSync, setTariffSync] = useState<"idle" | "ready" | "error">("idle");
  const [tariffSaveError, setTariffSaveError] = useState(false);
  const [managedDevices, setManagedDevices] = useState<ManagedDevice[]>(DEFAULT_DEVICES);
  const [deviceConfigReady, setDeviceConfigReady] = useState(false);
  const [deviceConfigSync, setDeviceConfigSync] = useState<"idle" | "ready" | "error">("idle");
  const [deviceSaveError, setDeviceSaveError] = useState(false);
  const [mycondSnapshot, setMycondSnapshot] = useState<MycondSnapshot | null>(null);
  const [mycondLoading, setMycondLoading] = useState(false);
  const [mycondBusyCode, setMycondBusyCode] = useState<string | null>(null);
  const [mycondError, setMycondError] = useState("");
  const [energyDate, setEnergyDate] = useState<string | null>(null);
  const [instantaneousPowerW, setInstantaneousPowerW] = useState<number | null>(null);
  const [energyDiagnostics, setEnergyDiagnostics] = useState<EnergyDiagnostics | null>(null);
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
  const hasMycondDevice = managedDevices.some(device => device.type === "mycond-roomer-12");
  useEffect(() => {
    if (tab !== "devices" || !hasMycondDevice) return;
    let active = true;
    const refresh = async () => {
      setMycondLoading(true);
      try {
        const response = await fetch("/api/mycond/status", { cache: "no-store", credentials: "same-origin" });
        const data = await response.json() as MycondSnapshot;
        if (!response.ok) throw new Error(data.error || "MYCOND_TUYA_API_UNAVAILABLE");
        if (active) { setMycondSnapshot(data); setMycondError(data.error ?? ""); }
      } catch (error) {
        if (active) setMycondError(error instanceof Error ? error.message : "MYCOND_TUYA_API_UNAVAILABLE");
      } finally { if (active) setMycondLoading(false); }
    };
    void refresh();
    const timer = window.setInterval(refresh, 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [tab, hasMycondDevice]);
  useEffect(() => {
    let saved: unknown = null;
    try { saved = JSON.parse(window.localStorage.getItem(ENERGY_TARIFF_KEY) ?? "null"); } catch { saved = null; }
    if (saved && typeof saved === "object") {
      const value = saved as { rates?: Partial<EnergyRates>; winterDiscountEnabled?: unknown; householdMonthlyKwh?: unknown };
      if (value.rates) {
        const rates = { ...DEFAULT_ENERGY_RATES };
        for (const key of Object.keys(DEFAULT_ENERGY_RATES) as (keyof EnergyRates)[]) {
          if (typeof value.rates[key] === "string") rates[key] = value.rates[key] as string;
        }
        // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate persisted user settings on mount.
        setEnergyRates(rates);
      }
      if (typeof value.winterDiscountEnabled === "boolean") setWinterDiscountEnabled(value.winterDiscountEnabled);
      if (value.householdMonthlyKwh && typeof value.householdMonthlyKwh === "object") {
        const monthly: Record<string, string> = {};
        for (const [key, amount] of Object.entries(value.householdMonthlyKwh)) {
          if (/^\d{4}-(0[1-9]|1[0-2])$/.test(key) && (typeof amount === "string" || typeof amount === "number")) monthly[key] = String(amount);
        }
        setHouseholdMonthlyKwh(monthly);
      }
    }
    setRateReady(true);
  }, []);
  useEffect(() => {
    if (rateReady) window.localStorage.setItem(ENERGY_TARIFF_KEY, JSON.stringify({ rates: energyRates, winterDiscountEnabled, householdMonthlyKwh }));
  }, [energyRates, winterDiscountEnabled, householdMonthlyKwh, rateReady]);
  useEffect(() => {
    if (!energyHistoryId || energyStorage !== "ready") return;
    let active = true;
    fetch(`/api/cozytouch/energy/settings?installationId=${encodeURIComponent(energyHistoryId)}`, { cache: "no-store", credentials: "same-origin" })
      .then(async response => {
        if (!response.ok) throw new Error("tariff_settings_unavailable");
        return response.json();
      })
      .then(data => {
        if (!active) return;
        const saved = data?.settings;
        if (saved && typeof saved === "object") {
          if (saved.rates && typeof saved.rates === "object") {
            const next = { ...DEFAULT_ENERGY_RATES };
            for (const key of Object.keys(DEFAULT_ENERGY_RATES) as (keyof EnergyRates)[]) {
              if (typeof saved.rates[key] === "string") next[key] = saved.rates[key];
            }
            setEnergyRates(next);
          }
          if (typeof saved.winterDiscountEnabled === "boolean") setWinterDiscountEnabled(saved.winterDiscountEnabled);
          if (saved.householdMonthlyKwh && typeof saved.householdMonthlyKwh === "object") {
            const monthly: Record<string, string> = {};
            for (const [key, value] of Object.entries(saved.householdMonthlyKwh)) {
              if (/^\d{4}-(0[1-9]|1[0-2])$/.test(key) && (typeof value === "string" || typeof value === "number")) monthly[key] = String(value);
            }
            setHouseholdMonthlyKwh(monthly);
          }
        }
        setTariffSync("ready");
      })
      .catch(() => { if (active) setTariffSync("error"); });
    return () => { active = false; };
  }, [energyHistoryId, energyStorage]);
  useEffect(() => {
    if (!energyHistoryId || energyStorage !== "ready") return;
    let active = true;
    fetch("/api/cozytouch/background", { cache: "no-store", credentials: "same-origin" })
      .then(async response => {
        if (!response.ok) throw new Error("background_status_unavailable");
        return response.json();
      })
      .then(data => {
        if (active) setBackgroundCollection(data?.refreshAvailable ? "ready" : data?.configured ? "reconnect" : "unavailable");
      })
      .catch(() => { if (active) setBackgroundCollection("error"); });
    return () => { active = false; };
  }, [energyHistoryId, energyStorage]);
  useEffect(() => {
    if (tariffSync !== "ready" || !energyHistoryId) return;
    const timer = window.setTimeout(() => {
      fetch("/api/cozytouch/energy/settings", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ installationId: energyHistoryId, settings: { rates: energyRates, winterDiscountEnabled, householdMonthlyKwh } })
      }).then(response => { if (!response.ok) throw new Error("tariff_save_failed"); setTariffSaveError(false); })
        .catch(() => setTariffSaveError(true));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [tariffSync, energyHistoryId, energyRates, winterDiscountEnabled, householdMonthlyKwh]);
  useEffect(() => {
    try {
      const parsed = parseManagedDevices(JSON.parse(window.localStorage.getItem(DEVICE_LIST_KEY) ?? "null"));
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate the device list from browser storage.
      if (parsed) setManagedDevices(parsed);
    } catch { /* Use the default device list. */ }
    setDeviceConfigReady(true);
  }, []);
  useEffect(() => {
    if (deviceConfigReady) window.localStorage.setItem(DEVICE_LIST_KEY, JSON.stringify(managedDevices));
  }, [managedDevices, deviceConfigReady]);
  useEffect(() => {
    if (!energyHistoryId || energyStorage !== "ready") return;
    let active = true;
    fetch(`/api/cozytouch/devices?installationId=${encodeURIComponent(energyHistoryId)}`, { cache: "no-store", credentials: "same-origin" })
      .then(async response => {
        if (!response.ok) throw new Error("device_list_unavailable");
        return response.json();
      })
      .then(data => {
        if (!active) return;
        if (data?.configured) {
          const parsed = parseManagedDevices(data.devices);
          if (parsed) setManagedDevices(parsed);
        }
        setDeviceConfigSync("ready");
      })
      .catch(() => { if (active) setDeviceConfigSync("error"); });
    return () => { active = false; };
  }, [energyHistoryId, energyStorage]);
  useEffect(() => {
    if (deviceConfigSync !== "ready" || !energyHistoryId) return;
    const timer = window.setTimeout(() => {
      fetch("/api/cozytouch/devices", {
        method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ installationId: energyHistoryId, devices: managedDevices })
      }).then(response => { if (!response.ok) throw new Error("device_save_failed"); setDeviceSaveError(false); })
        .catch(() => setDeviceSaveError(true));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [deviceConfigSync, energyHistoryId, managedDevices]);
  useEffect(() => {
    let active = true;
    const readValue = (value: unknown) => {
      if (value && typeof value === "object" && "value" in value) return (value as {value: unknown}).value;
      return value;
    };
    const refresh = async () => {
      try {
        const response = await fetch("/api/cozytouch/state", { cache: "no-store", credentials: "same-origin" });
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
        const cumulativeWh = Number(data?.telemetry?.cumulativeEnergyWh);
        if (Number.isFinite(cumulativeWh) && cumulativeWh >= 0) {
          setCumulativeEnergyKwh(cumulativeWh / 1000);
          setObservedTodayEnergy(rememberEnergyReading(cumulativeWh));
        }
        setEnergyHistoryId(typeof data?.telemetry?.energyHistoryId === "string" ? data.telemetry.energyHistoryId : null);
        setEnergyStorage(data?.telemetry?.energyStorage === "ready" ? "ready" : data?.telemetry?.energyStorage === "error" ? "error" : "not_configured");
        const dailyEnergy = data?.telemetry?.dailyEnergy;
        const energy = dailyEnergy?.available === true && dailyEnergy?.totalKwh !== null ? Number(dailyEnergy.totalKwh) : NaN;
        setEnergyConsumption(Number.isFinite(energy) ? energy : null);
        setEnergyDate(dailyEnergy?.date ?? null);
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

  useEffect(() => {
    if (!energyHistoryId || energyStorage !== "ready") return;
    let active = true;
    const loadHistory = async () => {
      try {
        const response = await fetch(`/api/cozytouch/energy?installationId=${encodeURIComponent(energyHistoryId)}`, {
          cache: "no-store", credentials: "same-origin"
        });
        const data = await response.json();
        if (active && response.ok && data.configured && Array.isArray(data.samples)) setEnergyHistory(data.samples);
      } catch { /* The live meter and last loaded chart remain usable offline. */ }
    };
    loadHistory();
    const interval = window.setInterval(loadHistory, 5 * 60_000);
    return () => { active = false; window.clearInterval(interval); };
  }, [energyHistoryId, energyStorage]);

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
        credentials: "same-origin",
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

  const chartNow = lastUpdatedAt ? Date.parse(lastUpdatedAt) : (energyHistory[energyHistory.length - 1]?.sampledAt ?? 0);
  const energyDailySeries = buildDailyEnergy(energyHistory, energyChartDays, chartNow);
  const todayKey = localDateKey(chartNow);
  const todayHistoryKwh = energyDailySeries.find(day => day.key === todayKey)?.kwh ?? 0;
  const todayEnergyEstimate = energyStorage === "ready" && energyHistory.length > 1
    ? { kwh: todayHistoryKwh, caption: "Різниця накопиченого лічильника · історія у хмарі" }
    : observedTodayEnergy;
  const chartEnergyKwh = energyDailySeries.reduce((sum, day) => sum + day.kwh, 0);
  const tariffEstimate = calculateEnergyCost(energyDailySeries, householdMonthlyKwh, energyRates, winterDiscountEnabled);
  const chartCost = energyHistory.length > 1 ? tariffEstimate.cost : null;
  const tariffMonths = [...new Set(energyDailySeries.map(day => day.key.slice(0, 7)))].filter(monthKey => {
    const month = Number(monthKey.slice(5, 7));
    return winterDiscountEnabled && (month >= 10 || month <= 4);
  });
  const largestEnergyGapMinutes = energyHistory.reduce((largest, sample, index) => index === 0
    ? largest
    : Math.max(largest, (sample.sampledAt - energyHistory[index - 1].sampledAt) / 60_000), 0);
  const mainHeaterConfig = managedDevices.find(device => device.type === "atlantic-heater");
  const chartMaxKwh = Math.max(...energyDailySeries.map(day => day.kwh), 0.001);
  const scheduleEnabled = String(mode).toLowerCase() === "prog";

  function programSummary(value: unknown) {
    if (value === undefined || value === null) return "Не передано пристроєм";
    if (typeof value === "string") return value;
    try { return JSON.stringify(value, null, 2); } catch { return String(value); }
  }

  function exportEnergyCsv() {
    const rows = [["Дата", "Споживання, кВт·год", "День, кВт·год", "Ніч, кВт·год", "Орієнтовна вартість, грн"]];
    for (const day of energyDailySeries) {
      const dailyCost = calculateEnergyCost([day], householdMonthlyKwh, energyRates, winterDiscountEnabled).cost;
      rows.push([
        day.key,
        day.kwh.toFixed(3),
        day.dayKwh.toFixed(3),
        day.nightKwh.toFixed(3),
        dailyCost === null ? "" : dailyCost.toFixed(2)
      ]);
    }
    const csv = "\uFEFF" + rows.map(row => row.map(value => `"${value.replaceAll('"', '""')}"`).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `atlantic-energy-${energyChartDays}-days.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function updateManagedDevice(id: string, patch: Partial<ManagedDevice>) {
    setManagedDevices(previous => previous.map(device => device.id === id ? { ...device, ...patch } : device));
  }

  function addManagedDevice(type: ManagedDevice["type"]) {
    const names: Record<ManagedDevice["type"], string> = {
      "atlantic-heater": "Конвектор Atlantic",
      "mycond-roomer-12": "Mycond Roomer Smart 12",
      custom: "Новий пристрій"
    };
    setManagedDevices(previous => [...previous, {
      id: `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      type,
      name: names[type],
      room: ""
    }]);
  }

  async function sendMycondControl(code: string, value: unknown) {
    setMycondBusyCode(code);
    setMycondError("");
    try {
      const response = await fetch("/api/mycond/control", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, value })
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "MYCOND_COMMAND_FAILED");
      await new Promise(resolve => window.setTimeout(resolve, 1200));
      const status = await fetch("/api/mycond/status", { cache: "no-store", credentials: "same-origin" });
      const snapshot = await status.json() as MycondSnapshot;
      if (!status.ok) throw new Error(snapshot.error || "MYCOND_TUYA_API_UNAVAILABLE");
      setMycondSnapshot(snapshot);
    } catch (error) { setMycondError(error instanceof Error ? error.message : "MYCOND_COMMAND_FAILED"); }
    finally { setMycondBusyCode(null); }
  }

  function mycondValueOptions(fn: MycondFunction) {
    try {
      const value: unknown = JSON.parse(fn.values ?? "{}");
      return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    } catch { return {}; }
  }

  function mycondLabel(code: string) {
    const names: Record<string, string> = {
      switch: "Живлення", switch_1: "Живлення", mode: "Режим", humidity_set: "Цільова вологість",
      fan_speed: "Швидкість вентилятора", countdown_set: "Таймер", humidity_indoor: "Вологість у кімнаті",
      temp_indoor: "Температура в кімнаті", water_full: "Резервуар для води", fault: "Помилка"
    };
    return names[code] ?? code.replaceAll("_", " ");
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
              <div className="device-name"><span className="device-icon"><Flame size={18}/></span><div><strong>{mainHeaterConfig?.name ?? liveDevice?.name ?? "Atlantic Altis Eco Boost"}</strong><small>Конвектор · 1000 Вт{mainHeaterConfig?.room ? ` · ${mainHeaterConfig.room}` : ""} · {liveDevice ? "Cozytouch" : "очікує з’єднання"}</small></div></div>
              <button className="more-button" aria-label="Оновити стан" title="Оновити стан" disabled={liveLoading} onClick={()=>{setLiveLoading(true);setRefreshTick(value=>value+1);}}><RefreshCw size={18} className={liveLoading ? "spin" : ""}/></button>
            </div>
            <div className="device-status"><span className={deviceStatus === "online" ? "status-dot active" : "status-dot"}/>{liveLoading ? "Перевіряємо зв’язок…" : deviceStatus === "online" ? "Конвектор онлайн · зв’язок підтверджено" : deviceStatus === "offline" ? "Конвектор офлайн · немає зв’язку зі шлюзом або пристроєм" : liveDevice ? "Не вдалося достовірно визначити стан конвектора" : "Немає зв’язку з Cozytouch · стан невідомий"}{lastUpdatedAt && !liveLoading ? <small className="state-updated">Оновлено {new Date(lastUpdatedAt).toLocaleTimeString("uk-UA",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}</small> : null}</div>
            <section className="setpoint-control" aria-label="Керування температурою">
              <div className="setpoint-heading">
                <div><span className="setpoint-eyebrow">ТЕМПЕРАТУРА НАГРІВУ</span><p>Встановити комфортну температуру</p></div>
                <span className="setpoint-step">Крок 0,5 °C</span>
              </div>
              <div className="dial-control">
                <button className="dial-side-button" disabled={controlBusy || deviceStatus !== "online" || temperature <= 7} onClick={() => sendControl("temperature", Math.max(7, temperature - 0.5))} aria-label="Зменшити температуру">−</button>
                <div className="setpoint-dial" aria-live="polite">
                  <svg viewBox="0 0 240 240" className="setpoint-dial-svg" aria-hidden="true">
                    <circle className="setpoint-dial-track" cx="120" cy="120" r="104"/>
                    <circle className="setpoint-dial-progress" cx="120" cy="120" r="104" style={{strokeDasharray: `${Math.max(0,Math.min(1,(temperature-7)/23))*654} 654`}}/>
                  </svg>
                  <div className="setpoint-dial-inner">
                    <span className="dial-overline">ВСТАНОВЛЕНА</span>
                    <strong>{temperature.toLocaleString("uk-UA",{minimumFractionDigits:1,maximumFractionDigits:1})}<span>°</span></strong>
                    <span className="dial-heat-mark"><Flame size={23}/></span>
                    <small>Цільова температура</small>
                  </div>
                </div>
                <button className="dial-side-button dial-side-plus" disabled={controlBusy || deviceStatus !== "online" || temperature >= 30} onClick={() => sendControl("temperature", Math.min(30, temperature + 0.5))} aria-label="Збільшити температуру">+</button>
              </div>
              <div className="setpoint-slider">
                <input aria-label="Цільова температура" type="range" min="7" max="30" step="0.5" value={temperature} disabled={controlBusy || deviceStatus !== "online"} onChange={e=>setTemperature(Number(e.target.value))} onPointerUp={e=>sendControl("temperature", Number((e.target as HTMLInputElement).value))} onKeyUp={e=>{if(["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Home","End"].includes(e.key))sendControl("temperature",Number((e.target as HTMLInputElement).value));}}/>
                <div className="setpoint-scale"><span>7 °C</span><span>30 °C</span></div>
              </div>
              <div className="setpoint-context">
                <span><i className="setpoint-live-dot"/> {deviceStatus === "online" ? "Керування доступне" : "Очікуємо зв’язок із конвектором"}</span>
                {roomTemperature !== null && <span>У кімнаті зараз <b>{roomTemperature.toLocaleString("uk-UA")} °C</b></span>}
              </div>
            </section>
            <div className="device-divider"/>
            <div className="device-bottom">
              <div className="mode-block"><span>РЕЖИМ РОБОТИ</span><div className="mode-select">
                {[{label:"Комфорт",value:"normal"},{label:"ECO",value:"eco"},{label:"Антизамерзання",value:"antifreeze"}].map(item => <button key={item.value} className={mode === item.value ? "selected" : ""} disabled={controlBusy || deviceStatus !== "online"} onClick={()=>sendControl("mode", item.value)}>{item.label}</button>)}
              </div></div>
              <button className={power ? "power-button on" : "power-button"} disabled={controlBusy || deviceStatus !== "online"} onClick={()=>sendControl("power", !power)} aria-label={power ? "Вимкнути конвектор" : "Увімкнути конвектор"}><Power size={20}/></button>
            </div>
            <div className="demo-note"><CircleHelp size={14}/> {controlError || (deviceStatus === "online" ? "Конвектор онлайн. Стан оновлюється кожні 30 секунд." : deviceStatus === "offline" ? "Конвектор офлайн. Керування заблоковано до відновлення зв’язку." : "Очікуємо підтвердження стану конвектора через Cozytouch.")}</div>
          </div>

          <div className="section-heading"><div><p className="eyebrow">СТАН ПРИСТРОЮ</p><h2>Зараз у кімнаті</h2></div><span className="muted-tag">{liveDevice ? "Дані Cozytouch" : "Немає зв’язку"}</span></div>
          <div className="metrics-grid">
            <div className="metric-card"><div className="metric-icon mint"><Thermometer size={17}/></div><span>Температура</span><strong>{roomTemperature === null ? "—" : roomTemperature.toLocaleString("uk-UA")} °C</strong><small>{roomTemperatureStatus === "online" ? (roomTemperatureLastSuccessAt ? "Оновлено " + new Date(roomTemperatureLastSuccessAt).toLocaleTimeString("uk-UA", {hour:"2-digit",minute:"2-digit"}) : "Датчик відповів") : "Немає свіжого підтвердження"}</small></div>
            <div className="metric-card"><div className="metric-icon amber"><Zap size={17}/></div><span>Споживання сьогодні</span><strong>{energyConsumption === null ? "—" : energyConsumption.toLocaleString("uk-UA")} {energyConsumption === null ? "" : "кВт·год"}</strong><small>Добовий лічильник Atlantic</small></div>
            <div className="metric-card"><div className="metric-icon blue"><Wifi size={17}/></div><span>З’єднання</span><strong>{deviceStatus === "online" ? "Онлайн" : deviceStatus === "offline" ? "Офлайн" : "Невідомо"}</strong><small>{gatewayOnline ? "Шлюз доступний" : "Шлюз не підтвердив зв’язок"}{deviceLastSuccessAt ? " · відповідь " + new Date(deviceLastSuccessAt).toLocaleTimeString("uk-UA", {hour:"2-digit",minute:"2-digit"}) : ""}</small></div>
            <div className="metric-card"><div className="metric-icon violet"><Activity size={17}/></div><span>Нагрівання</span><strong>{String(heaterStates.TargetHeatingLevel ?? "—")}</strong><small>Рівень нагрівання</small></div>
            <div className="metric-card"><div className="metric-icon amber"><Zap size={17}/></div><span>Потужність зараз</span><strong>{instantaneousPowerW === null ? "—" : instantaneousPowerW.toLocaleString("uk-UA") + " Вт"}</strong><small>{instantaneousPowerW === null ? "Датчик потужності не передає значення" : "Останнє вимірювання Cozytouch"}</small></div>
          </div>

          <div className="tip-card"><div className="tip-icon"><ShieldCheck size={20}/></div><div><strong>Керування буде безпечним</strong><p>Спершу перевіримо можливості саме твого конвектора в Cozytouch. Жодних команд навмання.</p></div><ChevronRight size={18}/></div>
        </>}

        {tab === "schedule" && <div className="subpage">
          <p className="eyebrow">АВТОМАТИЗАЦІЯ</p><h1>Твій розклад<span>.</span></h1>
          <p className="subcopy">Перемикач використовує вбудований режим PROG конвектора. Сам конвектор виконує збережену в Cozytouch програму навіть коли застосунок закритий.</p>
          <div className="schedule-card">
            <div className="schedule-title"><CalendarDays size={19}/><strong>Розклад нагрівання</strong><span className="muted-tag">{scheduleEnabled ? "Активний" : "На паузі"}</span></div>
            <p className="subcopy">{scheduleEnabled ? "Конвектор працює за тижневою програмою." : "Розклад збережений, але зараз конвектор працює в ручному режимі."}</p>
            <button className={scheduleEnabled ? "wide-outline schedule-toggle active" : "wide-outline schedule-toggle"} disabled={controlBusy || deviceStatus !== "online"} onClick={()=>sendControl("mode", scheduleEnabled ? "manual" : "prog")}>
              {scheduleEnabled ? "Вимкнути розклад · перейти в ручний режим" : "Увімкнути розклад · режим PROG"}
            </button>
            <div className="schedule-device-state">Стан Cozytouch: <strong>{String(mode).toUpperCase()}</strong>{deviceStatus !== "online" ? " · потрібне активне з’єднання з конвектором" : ""}</div>
            {controlError && <p className="tariff-warning">{controlError}</p>}
            <details className="program-readback"><summary>Переглянути програму, збережену в конвекторі</summary>{WEEKLY_PROGRAMS.map(([label,key])=><div className="program-day" key={key}><strong>{label}</strong><pre>{programSummary(heaterStates[key])}</pre></div>)}</details>
            <p className="hourly-note">Перемикач лише вмикає або ставить на паузу наявну програму. Редагування часових інтервалів і температур потребує окремої перевірки формату команд Cozytouch.</p>
          </div>
        </div>}

        {tab === "energy" && <div className="subpage">
          <p className="eyebrow">ЕФЕКТИВНІСТЬ</p><h1>Енергія<span>.</span></h1>
          <p className="subcopy">Лічильник конвектора показує накопичені Вт·год. Історія й оцінка вартості оновлюються, коли застосунок зчитує Cozytouch.</p>
          <div className="energy-card"><div className="energy-top"><div><span>НАКОПИЧЕНО ЛІЧИЛЬНИКОМ КОНВЕКТОРА</span><strong>{cumulativeEnergyKwh === null ? "—" : cumulativeEnergyKwh.toLocaleString("uk-UA",{minimumFractionDigits:1,maximumFractionDigits:1})} <small>кВт·год</small></strong></div><div className="metric-icon amber"><Zap size={18}/></div></div><div className="empty-caption">{cumulativeEnergyKwh === null ? "Лічильник поки не передав значення." : "Загальний показник датчика Atlantic · " + Math.round(cumulativeEnergyKwh * 1000).toLocaleString("uk-UA") + " Вт·год"}</div></div>
          <div className="energy-card" style={{marginTop:12}}><div className="energy-top"><div><span>СПОЖИВАННЯ СЬОГОДНІ</span><strong>{todayEnergyEstimate ? todayEnergyEstimate.kwh.toLocaleString("uk-UA",{minimumFractionDigits:3,maximumFractionDigits:3}) : "—"} <small>кВт·год</small></strong></div><span className="muted-tag">Оцінка лічильника</span></div><div className="empty-caption">{todayEnergyEstimate?.caption ?? "Потрібно щонайменше два збережені покази лічильника."}</div>{energyConsumption !== null && <p className="hourly-note">Звіт Atlantic за добу: {energyConsumption.toLocaleString("uk-UA")} кВт·год{energyDate ? " · " + new Date(energyDate).toLocaleDateString("uk-UA") : ""}.</p>}</div>
          <div className="energy-card background-collection-card"><div className="energy-top"><div><span>ФОНОВИЙ ЗБІР ПОКАЗІВ</span><strong style={{fontSize:18}}>{backgroundCollection === "ready" ? "Токен готовий" : backgroundCollection === "reconnect" ? "Потрібне перепідключення" : backgroundCollection === "unavailable" ? "Не налаштовано" : backgroundCollection === "error" ? "Помилка перевірки" : "Перевіряємо…"}</strong></div><span className="muted-tag">GitHub Actions</span></div><p className="hourly-note">{backgroundCollection === "ready" ? "Refresh token збережений зашифровано в Neon. Для запуску кожні 15 хвилин додай однаковий CRON_SECRET у GitHub Actions і Vercel." : backgroundCollection === "reconnect" ? "У Cozytouch немає refresh token. Перепідключи акаунт після оновлення, щоб дозволити фонове оновлення сесії." : backgroundCollection === "unavailable" ? "Спочатку потрібні Neon, підключений Cozytouch і секрет CRON_SECRET у Vercel та GitHub." : backgroundCollection === "error" ? "Не вдалося прочитати стан фонового доступу." : "Статус з’явиться після зчитування Cozytouch."}</p><a className="background-actions-link" href="https://github.com/XOTT69/atlantic-home/actions" target="_blank" rel="noreferrer">Перевірити запуск збору в GitHub Actions <ArrowUpRight size={14}/></a></div>
          <div className="energy-card" style={{marginTop:12}}>
            <div className="energy-top"><div><span>ІСТОРІЯ СПОЖИВАННЯ</span><strong style={{fontSize:20}}>За {energyChartDays} днів</strong></div><span className="muted-tag">{energyHistory.length} показів</span></div>
            <div className="energy-period-choice"><button className={energyChartDays === 7 ? "selected" : ""} onClick={()=>setEnergyChartDays(7)}>7 днів</button><button className={energyChartDays === 30 ? "selected" : ""} onClick={()=>setEnergyChartDays(30)}>30 днів</button><button className="energy-export" onClick={exportEnergyCsv} disabled={energyHistory.length < 2}><Download size={14}/> CSV</button></div>
            {energyHistory.length > 1 ? <div className="energy-history-chart" aria-label={`Споживання за ${energyChartDays} днів`}>
              {energyDailySeries.map(day=><div className="energy-history-column" key={day.key} title={`${day.key}: ${day.kwh.toLocaleString("uk-UA",{maximumFractionDigits:3})} кВт·год`}><div style={{height:`${day.kwh > 0 ? Math.max(4, day.kwh / chartMaxKwh * 100) : 1}%`}}/><small>{day.label}</small></div>)}
            </div> : <div className="empty-caption">Збираємо покази. Графік з’явиться після наступного зчитування.</div>}
            <p className="hourly-note">{energyStorage === "ready" ? "Хмарна історія активна; дані доступні на різних пристроях. Якщо застосунок був закритий, зміна між показами потрапить до дня наступного зчитування." : energyStorage === "error" ? "Не вдалося зберегти показ. Перевір підключення бази Neon." : "Хмарну історію ще не підключено. Поки покази зберігаються лише в цьому браузері."}</p>
          </div>
          <div className="energy-card" style={{marginTop:12}}>
            <div className="energy-top"><div><span>ОРІЄНТОВНА ВАРТІСТЬ ЗА {energyChartDays} ДНІВ</span><strong>{chartCost === null ? "—" : chartCost.toLocaleString("uk-UA",{minimumFractionDigits:2,maximumFractionDigits:2})} <small>грн</small></strong></div><div className="metric-icon mint"><Zap size={18}/></div></div>
            <p className="hourly-note">За лічильником конвектора: {chartEnergyKwh.toLocaleString("uk-UA",{minimumFractionDigits:3,maximumFractionDigits:3})} кВт·год · день {tariffEstimate.dayKwh.toLocaleString("uk-UA",{minimumFractionDigits:3,maximumFractionDigits:3})} · ніч {tariffEstimate.nightKwh.toLocaleString("uk-UA",{minimumFractionDigits:3,maximumFractionDigits:3})}. Нічний період: 23:00–07:00.</p>
            <label className="tariff-toggle"><input type="checkbox" checked={winterDiscountEnabled} onChange={event=>setWinterDiscountEnabled(event.target.checked)}/><span><strong>Застосовувати зимовий пільговий тариф</strong><small>Жовтень–квітень · якщо загальне споживання житла не перевищує 2000 кВт·год за місяць</small></span></label>
            {tariffMonths.length > 0 && <div className="household-months"><strong>Загальне споживання житла</strong><small>Внеси показ з рахунку за кожен зимовий місяць у вибраному періоді. Це визначає, який тариф застосувати до всього обсягу за місяць. Пільговий режим має бути оформлений для твого житла.</small>{tariffMonths.map(monthKey=>{const entered=householdMonthlyKwh[monthKey] ?? "";const total=Number(entered.trim().replace(",","."));const status=entered.trim()===""?"Вкажи показ за місяць, щоб обрати тариф.":Number.isFinite(total)?total<=2000?"Для оцінки застосуємо пільгову ставку.":"Понад 2000 кВт·год: застосуємо стандартну ставку.":"Перевір число.";return <div className="household-month-input" key={monthKey}><label className="tariff-input-label">{new Date(`${monthKey}-01T12:00:00`).toLocaleDateString("uk-UA",{month:"long",year:"numeric"})}, кВт·год<input inputMode="decimal" type="text" placeholder="Наприклад, 1800" value={entered} onChange={event=>setHouseholdMonthlyKwh(previous=>({...previous,[monthKey]:event.target.value.replace(/[^0-9,.]/g,"")}))}/></label><small>{status}</small></div>})}</div>}
            <div className="tariff-rates"><strong>Ціни, грн/кВт·год</strong><div className="tariff-rate-grid"><label>Пільговий · день<input inputMode="decimal" value={energyRates.discountDay} onChange={event=>setEnergyRates(previous=>({...previous,discountDay:event.target.value.replace(/[^0-9,.]/g,"")}))}/></label><label>Пільговий · ніч<input inputMode="decimal" value={energyRates.discountNight} onChange={event=>setEnergyRates(previous=>({...previous,discountNight:event.target.value.replace(/[^0-9,.]/g,"")}))}/></label><label>Стандартний · день<input inputMode="decimal" value={energyRates.standardDay} onChange={event=>setEnergyRates(previous=>({...previous,standardDay:event.target.value.replace(/[^0-9,.]/g,"")}))}/></label><label>Стандартний · ніч<input inputMode="decimal" value={energyRates.standardNight} onChange={event=>setEnergyRates(previous=>({...previous,standardNight:event.target.value.replace(/[^0-9,.]/g,"")}))}/></label></div></div>
            {chartCost === null && energyHistory.length > 1 && tariffEstimate.missingMonths.length > 0 && <p className="tariff-warning">Щоб порахувати вартість за вибраний період, додай загальне споживання житла за зимові місяці вище.</p>}
            <p className="hourly-note">Оцінка розподіляє приріст накопичувального лічильника рівномірно між двома зчитуваннями. Найдовша пауза між збереженими показами: {largestEnergyGapMinutes < 1 ? "—" : largestEnergyGapMinutes < 60 ? `${Math.round(largestEnergyGapMinutes)} хв` : `${(largestEnergyGapMinutes/60).toLocaleString("uk-UA",{maximumFractionDigits:1})} год`}. Якщо сторінка була закрита, точний розподіл між днем і ніччю невідомий. {tariffSync === "ready" && !tariffSaveError ? "Тарифи й загальні місячні покази синхронізуються через Neon." : tariffSync === "error" || tariffSaveError ? "Не вдалося синхронізувати тарифи; копія лишається в цьому браузері." : "Тарифи синхронізуються після підключення історії Neon."}</p>
          </div>
          <div className="metric-card tariff"><span>Миттєва потужність</span><strong>{instantaneousPowerW === null ? "Поки недоступна" : instantaneousPowerW.toLocaleString("uk-UA") + " Вт"}</strong><small>Cozytouch передає накопичену енергію, але не миттєві Вт. Конвектор має номінальну потужність 1000 Вт; це не означає, що він постійно споживає її.</small></div>
          {energyDiagnostics && <details className="energy-card energy-diagnostics" style={{marginTop:12}}>
            <summary>Технічна діагностика Cozytouch · {energyDiagnostics.devices?.length ?? 0} датчиків</summary>
            <div className="empty-caption">Добові дані: {energyDiagnostics.dailyErrorCode || (energyDiagnostics.daily ? "серій: "+energyDiagnostics.daily.seriesCount+" · періодів: "+energyDiagnostics.daily.parsedPeriods : "без помилки")}</div>
            <div className="empty-caption">Погодинні дані: {energyDiagnostics.hourlyErrorCode || (energyDiagnostics.hourly ? "серій: "+energyDiagnostics.hourly.seriesCount+" · періодів: "+energyDiagnostics.hourly.parsedPeriods : "без помилки")}</div>
            {energyDiagnostics.hourlyErrorDetails ? <div className="empty-caption" style={{overflowWrap:"anywhere",whiteSpace:"normal"}}>Відповідь Atlantic: {energyDiagnostics.hourlyErrorDetails}</div> : null}
            {energyDiagnostics.devices?.map((device,index)=><div className="diagnostic-row" key={index}><strong>{device.name}</strong><small>{device.model}</small><small>Поля: {device.states.join(", ") || "не описані"}</small><small>Значення: {device.readings.map(reading=>String(reading.name)+"="+(reading.value && typeof reading.value === "object" ? JSON.stringify(reading.value) : String(reading.value))).join(" · ") || "поки немає"}</small></div>)}
          </details>}
        </div>}

        {tab === "devices" && <div className="subpage">
          <p className="eyebrow">ТВІЙ ДІМ</p><h1>Пристрої<span>.</span></h1>
          <p className="subcopy">Редагуй назви й кімнати. Список зберігається в Neon і синхронізується між браузерами.</p>
          <div className="managed-device-list">{managedDevices.map(device=><article className="managed-device-card" key={device.id}>
            <div className="managed-device-heading"><span className="device-icon">{device.type === "mycond-roomer-12" ? <Wind size={18}/> : device.type === "atlantic-heater" ? <Flame size={18}/> : <Settings2 size={18}/>}</span><div><strong>{device.name}</strong><small>{device.type === "atlantic-heater" ? liveDevice ? "Підключено через Cozytouch" : "Atlantic Cozytouch" : device.type === "mycond-roomer-12" ? "Осушувач · MYCOND Wi‑Fi" : "Інший пристрій"}</small></div><button className="device-remove" onClick={()=>setManagedDevices(previous=>previous.filter(item=>item.id!==device.id))} aria-label={`Видалити ${device.name}`}><Trash2 size={16}/></button></div>
            <label className="tariff-input-label">Назва<input value={device.name} maxLength={64} onChange={event=>updateManagedDevice(device.id,{name:event.target.value})}/></label>
            <label className="tariff-input-label">Кімната<input value={device.room} maxLength={50} placeholder="Наприклад, спальня" onChange={event=>updateManagedDevice(device.id,{room:event.target.value})}/></label>
            {device.type === "atlantic-heater" && <button className="wide-outline" onClick={()=>setTab("home")}>Відкрити керування Atlantic <ArrowUpRight size={16}/></button>}
            {device.type === "mycond-roomer-12" && <div className="device-integration-note">
              <strong>{mycondLoading ? "З’єднуємося з Tuya Cloud…" : mycondSnapshot?.configured ? `MYCOND Cloud · ${mycondSnapshot.online === true ? "онлайн" : mycondSnapshot.online === false ? "офлайн" : "стан пристрою невідомий"}` : "Керування через офіційний Tuya Cloud API"}</strong>
              {!mycondSnapshot?.configured && !mycondError && <span>Для запуску прив’яжи застосунок MYCOND як OEM App до Tuya Cloud-проєкту, додай серверні ключі в Vercel і вкажи ID пристрою. Atlantic Home запитуватиме фактичні стани й доступні команди з API самого пристрою.</span>}
              {mycondError && <span>Не вдалося отримати стан: {mycondError}. Перевір прив’язку MYCOND app, регіон Tuya Cloud, права API та ID пристрою у Vercel.</span>}
              {mycondSnapshot?.configured && <>
                {mycondSnapshot.deviceName && <span>Пристрій у хмарі: {mycondSnapshot.deviceName}</span>}
                <div className="mycond-readings">{mycondSnapshot.statuses.map(item=><div key={item.code}><span>{mycondLabel(item.code)}</span><strong>{String(item.value)}</strong></div>)}</div>
                <div className="mycond-controls">{mycondSnapshot.functions.map(fn=>{
                  const value = mycondValueOptions(fn);
                  const current = mycondSnapshot.statuses.find(item=>item.code===fn.code)?.value;
                  const type = (fn.type ?? "").toLowerCase();
                  const busy = mycondBusyCode === fn.code;
                  if (type === "boolean") return <button className="mycond-control-button" key={fn.code} disabled={!!mycondBusyCode} onClick={()=>sendMycondControl(fn.code, current !== true)}>{mycondLabel(fn.code)}: {current === true ? "Увімкнено" : "Вимкнено"}{busy ? " · надсилаємо…" : ""}</button>;
                  if (type === "enum" && Array.isArray(value.range)) return <label className="mycond-control-field" key={fn.code}>{mycondLabel(fn.code)}<select value={typeof current === "string" ? current : ""} disabled={!!mycondBusyCode} onChange={event=>sendMycondControl(fn.code,event.target.value)}><option value="" disabled>Обрати…</option>{value.range.map(option=><option key={String(option)} value={String(option)}>{String(option)}</option>)}</select></label>;
                  if ((type === "integer" || type === "number") && Number.isFinite(Number(value.min)) && Number.isFinite(Number(value.max))) return <label className="mycond-control-field" key={fn.code}>{mycondLabel(fn.code)} · {current === undefined ? "—" : String(current)}<input type="range" min={Number(value.min)} max={Number(value.max)} step={Number(value.step ?? 1)} value={Number(current ?? value.min)} disabled={!!mycondBusyCode} onPointerUp={event=>sendMycondControl(fn.code,Number((event.target as HTMLInputElement).value))} onKeyUp={event=>{if(["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Home","End"].includes(event.key))void sendMycondControl(fn.code,Number((event.target as HTMLInputElement).value));}}/></label>;
                  return null;
                })}</div>
                {mycondSnapshot.functions.length === 0 && <span>API не повернув перелік підтримуваних команд для цього пристрою.</span>}
              </>}
              <a href="https://developer.tuya.com/en/docs/iot/link-devices?id=Ka471nu1sfmkl" target="_blank" rel="noreferrer">Інструкція Tuya: прив’язати OEM app до Cloud-проєкту</a>
              <a href="https://mycond.eu/residential-air-dehumidifiers-roomer-smart-12" target="_blank" rel="noreferrer">Характеристики Roomer Smart 12 від MYCOND</a>
            </div>}
          </article>)}</div>
          <div className="device-add-actions"><button disabled={managedDevices.some(device=>device.type==="atlantic-heater")} onClick={()=>addManagedDevice("atlantic-heater")}><Plus size={16}/> Додати Atlantic</button><button onClick={()=>addManagedDevice("mycond-roomer-12")}><Plus size={16}/> Додати Mycond</button><button onClick={()=>addManagedDevice("custom")}><Plus size={16}/> Інший пристрій</button></div>
          <p className="hourly-note">{deviceConfigSync === "ready" && !deviceSaveError ? "Зміни синхронізуються через Neon." : deviceConfigSync === "error" || deviceSaveError ? "Не вдалося синхронізувати список; копія лишається в цьому браузері." : "Збереження в хмару активується після підключення Cozytouch і Neon."}</p>
        </div>}

        {tab === "settings" && <div className="subpage">
          <p className="eyebrow">КОНФІГУРАЦІЯ</p><h1>Налаштування<span>.</span></h1>
          <div className="settings-card"><div className="settings-row"><div className="settings-symbol"><Wifi size={19}/></div><div><strong>Обліковий запис Cozytouch</strong><small>{liveDevice ? "Підключено до Atlantic Home" : "Перевірка підключення"}</small></div><span className="settings-state">{liveDevice ? "Підключено" : "Очікує"}</span></div><div className="settings-row"><div className="settings-symbol"><Flame size={19}/></div><div><strong>Мій конвектор</strong><small>{mainHeaterConfig?.name ?? liveDevice?.name ?? "Altis Eco Boost 3 Wi-Fi · 1000 Вт"}</small></div><span className="settings-state">{liveDevice ? "Знайдено" : "Не перевірено"}</span></div><div className="settings-row"><div className="settings-symbol"><ShieldCheck size={19}/></div><div><strong>Безпека</strong><small>Облікові дані зберігатимуться лише на сервері</small></div><Check size={17} className="check-icon"/></div></div>
          <button className="disconnect-button" onClick={async()=>{await fetch("/api/access/lock",{method:"POST",credentials:"same-origin"});window.location.reload();}}>Заблокувати Atlantic Home</button>
        </div>}
      </section>

      <div style={{ display: tab === "settings" ? "block" : "none" }} aria-hidden={tab !== "settings"}><ConnectPanel /></div>

      <nav className="bottom-nav" aria-label="Основна навігація">
        <button className={tab==="home"?"nav-active":""} onClick={()=>setTab("home")}><House size={19}/><span>Дім</span></button>
        <button className={tab==="schedule"?"nav-active":""} onClick={()=>setTab("schedule")}><CalendarDays size={19}/><span>Розклад</span></button>
        <button className={tab==="energy"?"nav-active":""} onClick={()=>setTab("energy")}><Gauge size={19}/><span>Енергія</span></button>
        <button className={tab==="devices"?"nav-active":""} onClick={()=>setTab("devices")}><Wind size={19}/><span>Пристрої</span></button>
        <button className={tab==="settings"?"nav-active":""} onClick={()=>setTab("settings")}><Settings2 size={19}/><span>Профіль</span></button>
      </nav>
    </main>
  );
}
