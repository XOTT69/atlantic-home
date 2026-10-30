import { NextResponse } from "next/server";
import { withOverkiz, findAtlanticHeater, getDeviceStates, normalizeStates } from "@/lib/overkiz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return await withOverkiz(async (cookie, setup) => {
      const devices = Array.isArray(setup.devices) ? setup.devices as Record<string, unknown>[] : [];
      const heater = findAtlanticHeater(setup);
      const gateways = Array.isArray(setup.gateways) ? setup.gateways as Record<string, unknown>[] : [];
      const gatewayOnline = gateways.some(gateway => gateway.alive === true && String((gateway.connectivity as Record<string, unknown> | undefined)?.status ?? "").toUpperCase() !== "DISCONNECTED");
      const sensors = devices.filter(device =>
        String(device.controllableName ?? "").includes("TemperatureInCelcius") ||
        String(device.controllableName ?? "").includes("CumulatedElectricalEnergyConsumption")
      );
      const targets = [heater, ...sensors].filter(device => typeof device.deviceURL === "string");
      const readings = await Promise.all(targets.map(async device => {
        try {
          const raw = await getDeviceStates(cookie, String(device.deviceURL));
          return { deviceURL: device.deviceURL, states: normalizeStates(raw), raw };
        } catch {
          return { deviceURL: device.deviceURL, states: {}, raw: [] };
        }
      }));
      const stateByUrl = new Map(readings.map(item => [item.deviceURL, item]));
      const heaterReading = stateByUrl.get(heater.deviceURL);
      const temperatureSensor = sensors.find(device => String(device.controllableName ?? "").includes("TemperatureInCelcius"));
      const energySensor = sensors.find(device => String(device.controllableName ?? "").includes("CumulatedElectricalEnergyConsumption"));
      const sensorValue = (url: unknown, key: string) => {
        if (!url) return null;
        const value = stateByUrl.get(url)?.states?.[key];
        return value === undefined ? null : value;
      };
      return NextResponse.json({
        connected: true, source: "cozytouch-legacy", updatedAt: new Date().toISOString(), gatewayOnline,
        heater: {
          id: heater.deviceURL, name: heater.label ?? "Atlantic Altis Eco Boost",
          modelId: heater.controllableName ?? null, isAvailable: heater.available ?? null,
          enabled: heater.enabled ?? null, states: heaterReading?.states ?? {},
          rawStates: heaterReading?.raw ?? [], supportedCommands: heater.definition?.commands ?? [],
          supportedStates: heater.definition?.states ?? []
        },
        telemetry: {
          roomTemperature: sensorValue(temperatureSensor?.deviceURL, "Temperature"),
          energyConsumption: sensorValue(energySensor?.deviceURL, "ElectricEnergyConsumption"),
          energyTariffs: energySensor ? Object.fromEntries(
            Object.entries(stateByUrl.get(energySensor.deviceURL)?.states ?? {}).filter(([key]) => key.startsWith("ConsumptionTariff"))
          ) : {}
        },
        gateway: gateways.map(gateway => ({
          gatewayId: gateway.gatewayId ?? null, alive: gateway.alive ?? null,
          connectivity: gateway.connectivity ?? null, mode: gateway.mode ?? null
        })),
        devices: devices.map(device => ({
          id: device.deviceURL ?? device.oid ?? null, name: device.label ?? device.controllableName ?? "Atlantic",
          modelId: device.controllableName ?? null, productId: null, modelFamily: device.uiClass ?? null,
          isAvailable: device.available ?? null, enabled: device.enabled ?? null,
          deviceURL: device.deviceURL ?? null, oid: device.oid ?? null, type: device.type ?? null,
          controllableName: device.controllableName ?? null, definition: device.definition ?? null,
          widget: device.widget ?? null, capabilities: []
        }))
      });
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    const expired = code === "COZYTOUCH_SESSION_EXPIRED";
    return NextResponse.json({
      connected: false,
      error: expired ? "Сесія Cozytouch завершилася. Підключи акаунт знову." : "Не вдалося зчитати стан конвектора Cozytouch.",
      code
    }, { status: expired ? 401 : 502 });
  }
}
