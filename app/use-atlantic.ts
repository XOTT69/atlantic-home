"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { numericReading } from "@/lib/energy-pricing";

export type AtlanticSnapshot = {
  updatedAt: string;
  gatewayOnline: boolean;
  deviceStatus: "online" | "offline" | "unknown";
  heater: {
    name: string;
    states: Record<string, unknown>;
    supportedCommands: { commandName: string; nparams: number }[];
  };
  telemetry: {
    roomTemperature: unknown;
    roomTemperatureStatus: string;
    cumulativeEnergyWh: unknown;
    instantaneousPowerW: unknown;
    energyHistoryId: string | null;
    energyStorage: "ready" | "not_configured" | "error";
  };
};
export type CommandEvent = {
  id: string;
  at: string;
  label: string;
  status: "sending" | "accepted" | "confirmed" | "unconfirmed" | "failed";
};
const commandLabels: Record<string, string> = {
  power: "Живлення",
  temperature: "Цільова температура",
  mode: "Режим",
};
export const modeLabel = (mode: unknown) =>
  ({
    manual: "Ручний",
    prog: "За розкладом",
    normal: "Комфорт",
    eco: "Еко",
    antifreeze: "Антизамерзання",
    frostprotection: "Антизамерзання",
    off: "Вимкнено",
    auto: "Автоматичний",
    boost: "Підсилений",
    away: "Відсутність",
  })[String(mode)] ?? "Невідомий режим";
export function useAtlantic() {
  const [snapshot, setSnapshot] = useState<AtlanticSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reconnect, setReconnect] = useState(false);
  const [busy, setBusy] = useState(false);
  const [events, setEvents] = useState<CommandEvent[]>([]);
  const [commandMessage, setCommandMessage] = useState("");
  const inFlight = useRef<Promise<void> | null>(null);
  const alive = useRef(true);
  const controller = useRef<AbortController | null>(null);
  const sendLock = useRef(false);
  const pending = useRef<{
    id: string;
    action: string;
    value: unknown;
    until: number;
  } | null>(null);
  const failures = useRef(0);
  const updateEvent = useCallback(
    (id: string, status: CommandEvent["status"]) => {
      setEvents((list) =>
        list.map((item) => (item.id === id ? { ...item, status } : item)),
      );
    },
    [],
  );
  const refresh = useCallback(() => {
    if (inFlight.current) return inFlight.current;
    const job = (async () => {
      const requestController = new AbortController();
      controller.current = requestController;
      try {
        if (!navigator.onLine) throw new Error("OFFLINE");
        const response = await fetch("/api/cozytouch/state", {
          cache: "no-store",
          signal: AbortSignal.any([
            requestController.signal,
            AbortSignal.timeout(30_000),
          ]),
        });
        const data = await response.json();
        if (!response.ok) {
          if (response.status === 401) {
            setReconnect(true);
            throw new Error(
              data.code === "COZYTOUCH_SESSION_EXPIRED"
                ? "COZYTOUCH_SESSION_EXPIRED"
                : "APP_LOCKED",
            );
          }
          throw new Error(data.code ?? "PROVIDER_UNAVAILABLE");
        }
        if (!alive.current) return;
        setSnapshot(data);
        setError("");
        setReconnect(false);
        failures.current = 0;
        const command = pending.current;
        if (command) {
          const states = data.heater?.states ?? {};
          const actual =
            command.action === "temperature"
              ? numericReading(states.TargetTemperature)
              : command.action === "power"
                ? states.OnOff
                : states.OperatingMode;
          const expected =
            command.action === "power"
              ? command.value
                ? "on"
                : "off"
              : command.value;
          if (actual === expected) {
            updateEvent(command.id, "confirmed");
            setCommandMessage("Зміна підтверджена станом конвектора.");
            pending.current = null;
          } else if (Date.now() > command.until) {
            updateEvent(command.id, "unconfirmed");
            setCommandMessage(
              "Хмара прийняла команду, але конвектор ще не підтвердив зміну. Показуємо отриманий стан.",
            );
            pending.current = null;
          }
        }
      } catch (cause) {
        if (!alive.current || requestController.signal.aborted) return;
        failures.current += 1;
        if (pending.current && Date.now() > pending.current.until) {
          updateEvent(pending.current.id, "unconfirmed");
          pending.current = null;
          setCommandMessage(
            "Не вдалося підтвердити команду. Потрібне свіже зчитування перед наступною зміною.",
          );
        }
        const code = cause instanceof Error ? cause.message : "";
        setError(
          code === "OFFLINE"
            ? "Немає інтернету. Показуємо останні отримані дані; керування недоступне."
            : code === "APP_LOCKED"
              ? "Доступ до застосунку завершився. Відкрий сторінку входу."
              : code === "COZYTOUCH_SESSION_EXPIRED"
                ? "Потрібно перепідключити Cozytouch у налаштуваннях."
                : code === "COZYTOUCH_REFRESH_BUSY"
                  ? "Оновлюємо підключення. Повторимо зчитування автоматично."
                  : "Не вдалося оновити дані Cozytouch. Останній стан збережено на екрані; перевіримо зв’язок повторно.",
        );
      } finally {
        if (alive.current && !requestController.signal.aborted)
          setLoading(false);
      }
    })().finally(() => {
      if (inFlight.current === job) inFlight.current = null;
    });
    inFlight.current = job;
    return job;
  }, [updateEvent]);
  useEffect(() => {
    alive.current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let first = true;
    const tick = async () => {
      if (first || document.visibilityState === "visible") await refresh();
      first = false;
      if (!stopped) {
        clearTimeout(timer);
        timer = setTimeout(
          tick,
          Math.min(120_000, 30_000 * 2 ** Math.min(2, failures.current)),
        );
      }
    };
    const wake = () => {
      if (document.visibilityState === "visible") {
        clearTimeout(timer);
        void tick();
      }
    };
    void tick();
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    window.addEventListener("offline", wake);
    return () => {
      alive.current = false;
      stopped = true;
      clearTimeout(timer);
      controller.current?.abort();
      inFlight.current = null;
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
      window.removeEventListener("offline", wake);
    };
  }, [refresh]);
  async function send(
    action: "power" | "temperature" | "mode",
    value: unknown,
  ) {
    if (
      sendLock.current ||
      pending.current ||
      error ||
      snapshot?.deviceStatus !== "online"
    )
      return;
    sendLock.current = true;
    setBusy(true);
    setCommandMessage("");
    const id = crypto.randomUUID();
    const label = `${commandLabels[action]}: ${action === "power" ? (value ? "увімкнути" : "вимкнути") : action === "mode" ? modeLabel(value) : `${value} °C`}`;
    setEvents((list) =>
      [
        { id, at: new Date().toISOString(), label, status: "sending" as const },
        ...list,
      ].slice(0, 30),
    );
    try {
      const response = await fetch("/api/cozytouch/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, value }),
        signal: AbortSignal.timeout(45_000),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Команду не прийнято.");
      updateEvent(id, "accepted");
      pending.current = { id, action, value, until: Date.now() + 45_000 };
      setCommandMessage(
        "Команду прийнято хмарою. Очікуємо підтвердження від конвектора.",
      );
      await refresh();
    } catch (cause) {
      const timeout =
        cause instanceof Error &&
        ["TimeoutError", "AbortError"].includes(cause.name);
      updateEvent(id, timeout ? "unconfirmed" : "failed");
      setCommandMessage(
        timeout
          ? "Час очікування минув. Команда могла дійти — онови стан перед повторенням."
          : cause instanceof Error
            ? cause.message
            : "Не вдалося надіслати команду.",
      );
    } finally {
      sendLock.current = false;
      setBusy(false);
    }
  }
  const waiting = events.some(
    (event) => event.status === "accepted" || event.status === "sending",
  );
  return {
    snapshot,
    loading,
    error,
    reconnect,
    busy: busy || waiting,
    events,
    commandMessage,
    refresh,
    send,
  };
}
