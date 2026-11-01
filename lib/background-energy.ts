import { randomUUID } from "node:crypto";
import { getProviderToken } from "@/lib/provider-auth";
import { getOverkizConnection, getDeviceStates } from "@/lib/overkiz";
import { acquireJob, finishJob, saveEnergySample } from "@/lib/energy-store";

export async function collectBackgroundEnergy() {
  const owner = randomUUID();
  const acquired = await acquireJob("energy-collector", owner, 70);
  if (acquired === null)
    throw new Error("BACKGROUND_ENERGY_DATABASE_UNAVAILABLE");
  if (!acquired) return { sampled: false, code: "COLLECTION_ALREADY_RUNNING" };
  try {
    const { cookie, setup } = await getOverkizConnection(
      await getProviderToken(),
    );
    const devices = Array.isArray(setup.devices)
      ? (setup.devices as Record<string, unknown>[])
      : [];
    const sensor = devices.find((device) =>
      /CumulatedElectricalEnergyConsumption/i.test(
        String(device.controllableName ?? ""),
      ),
    );
    if (!sensor || typeof sensor.deviceURL !== "string")
      throw new Error("BACKGROUND_ENERGY_SENSOR_NOT_FOUND");
    const states = await getDeviceStates(cookie, sensor.deviceURL);
    const raw = states.find((state) =>
      /ElectricEnergyConsumptionState$/.test(
        String(state.name ?? state.qualifiedName ?? ""),
      ),
    )?.value;
    const wh =
      typeof raw === "number"
        ? raw
        : typeof raw === "string" && raw.trim()
          ? Number(raw)
          : NaN;
    if (!Number.isSafeInteger(wh) || wh < 0)
      throw new Error("BACKGROUND_ENERGY_VALUE_INVALID");
    const saved = await saveEnergySample(sensor.deviceURL, wh);
    if (!saved.installationId)
      throw new Error("BACKGROUND_ENERGY_DATABASE_UNAVAILABLE");
    await finishJob("energy-collector", owner);
    return {
      sampled: true,
      sampledAt: new Date().toISOString(),
      cumulativeEnergyWh: wh,
    };
  } catch (error) {
    const code =
      error instanceof Error ? error.message : "BACKGROUND_ENERGY_FAILED";
    await finishJob("energy-collector", owner, code);
    throw error;
  }
}
