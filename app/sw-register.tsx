"use client";
import { useEffect, useState } from "react";

export default function ServiceWorkerRegister() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    try {
      document.documentElement.dataset.textSize =
        JSON.parse(
          localStorage.getItem("atlantic-home-large-text") ?? "false",
        ) === true
          ? "large"
          : "normal";
    } catch {
      /* Standard readable size remains available. */
    }
    if (!("serviceWorker" in navigator)) return;
    let active = true;
    navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then((registration) => {
        if (
          registration.waiting &&
          navigator.serviceWorker.controller &&
          active
        )
          setWaiting(registration.waiting);
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          worker?.addEventListener("statechange", () => {
            if (
              worker.state === "installed" &&
              navigator.serviceWorker.controller &&
              active
            )
              setWaiting(worker);
          });
        });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  function update() {
    if (!waiting) return;
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      () => location.reload(),
      { once: true },
    );
    waiting.postMessage("ACTIVATE_UPDATE");
  }
  return waiting && !dismissed ? (
    <div className="update-banner" role="status">
      <span>Доступне оновлення Atlantic Home.</span>
      <button className="button primary" onClick={update}>
        Оновити
      </button>
      <button className="text-button" onClick={() => setDismissed(true)}>
        Пізніше
      </button>
    </div>
  ) : null;
}
