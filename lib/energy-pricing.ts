export type EnergySample = { sampledAt: number; cumulativeEnergyWh: number };
export type DailyEnergy = {
  key: string;
  label: string;
  kwh: number;
  dayKwh: number;
  nightKwh: number;
  coveredMinutes: number;
  estimatedMinutes: number;
};
export type EnergyRates = {
  discountDay: string;
  discountNight: string;
  standardDay: string;
  standardNight: string;
};
export const HOME_TIME_ZONE = "Europe/Kyiv";
const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: HOME_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const hourFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: HOME_TIME_ZONE,
  hour: "2-digit",
  hourCycle: "h23",
});

export function localDateKey(at: number) {
  if (!Number.isFinite(at)) return "";
  const parts = dateFormatter.formatToParts(at);
  return ["year", "month", "day"]
    .map((type) => parts.find((part) => part.type === type)?.value)
    .join("-");
}

export function numericReading(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim()))
    return null;
  const parsed =
    typeof value === "number" ? value : Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Deltas are measurements; their distribution over time is an estimate.
 * Gaps >45 min are explicitly marked. Counter resets and impossible jumps are excluded. */
export function buildDailyEnergy(
  samples: EnergySample[],
  days: number,
  now: number,
): DailyEnergy[] {
  const totals = new Map<string, DailyEnergy>();
  if (!Number.isFinite(now) || now <= 0) return [];
  const today = new Date(localDateKey(now) + "T12:00:00Z");
  for (
    let offset = Math.min(366, Math.max(1, days)) - 1;
    offset >= 0;
    offset--
  ) {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() - offset);
    const key = date.toISOString().slice(0, 10);
    totals.set(key, {
      key,
      label: key.slice(8) + "." + key.slice(5, 7),
      kwh: 0,
      dayKwh: 0,
      nightKwh: 0,
      coveredMinutes: 0,
      estimatedMinutes: 0,
    });
  }
  const ordered = [...samples]
    .filter(
      (sample) =>
        Number.isFinite(sample.sampledAt) &&
        sample.sampledAt <= now &&
        Number.isSafeInteger(sample.cumulativeEnergyWh) &&
        sample.cumulativeEnergyWh >= 0,
    )
    .sort((a, b) => a.sampledAt - b.sampledAt);
  for (let index = 1; index < ordered.length; index++) {
    const previous = ordered[index - 1],
      current = ordered[index];
    const elapsed = current.sampledAt - previous.sampledAt;
    const delta = current.cumulativeEnergyWh - previous.cumulativeEnergyWh;
    if (elapsed <= 0 || delta < 0 || delta > (elapsed / 3_600_000) * 1250 + 20)
      continue;
    let cursor = previous.sampledAt;
    // Clip a very old baseline: avoid iterating through years of absent samples.
    const firstKey = totals.keys().next().value;
    if (firstKey)
      cursor = Math.max(
        cursor,
        Date.parse(firstKey + "T00:00:00Z") - 4 * 3_600_000,
      );
    while (cursor < current.sampledAt) {
      const end = Math.min(
        (Math.floor(cursor / 3_600_000) + 1) * 3_600_000,
        current.sampledAt,
      );
      const day = totals.get(localDateKey(cursor));
      if (day) {
        const kwh = ((delta / 1000) * (end - cursor)) / elapsed;
        const hour = Number(hourFormatter.format(cursor));
        day.kwh += kwh;
        if (hour >= 23 || hour < 7) day.nightKwh += kwh;
        else day.dayKwh += kwh;
        if (elapsed <= 45 * 60_000)
          day.coveredMinutes += (end - cursor) / 60_000;
        else day.estimatedMinutes += (end - cursor) / 60_000;
      }
      cursor = end;
    }
  }
  return [...totals.values()];
}

export function averagePowerW(samples: EnergySample[]) {
  const recent = samples.slice(-2);
  if (recent.length < 2) return null;
  const elapsed = recent[1].sampledAt - recent[0].sampledAt;
  const delta = recent[1].cumulativeEnergyWh - recent[0].cumulativeEnergyWh;
  if (elapsed < 60_000 || elapsed > 45 * 60_000 || delta < 0) return null;
  const watts = (delta * 3_600_000) / elapsed;
  return watts <= 1250 ? Math.round(watts) : null;
}

function parseRate(value: string) {
  const normalized = value.trim().replace(",", ".");
  if (!normalized) return null;
  const result = Number(normalized);
  return Number.isFinite(result) && result >= 0 ? result : null;
}

export function calculateEnergyCost(
  days: DailyEnergy[],
  householdMonthlyKwh: Record<string, string>,
  rates: EnergyRates,
  winterDiscountEnabled: boolean,
) {
  let cost = 0;
  let dayKwh = 0;
  let nightKwh = 0;
  let invalidRates = false;
  const missingMonths = new Set<string>();
  for (const day of days) {
    dayKwh += day.dayKwh;
    nightKwh += day.nightKwh;
    if (day.dayKwh === 0 && day.nightKwh === 0) continue;
    const monthKey = day.key.slice(0, 7);
    const month = Number(day.key.slice(5, 7));
    const winter = month >= 10 || month <= 4;
    let discount = false;
    if (winter && winterDiscountEnabled) {
      const homeKwh = parseRate(householdMonthlyKwh[monthKey] ?? "");
      if (homeKwh === null) {
        missingMonths.add(monthKey);
        continue;
      }
      discount = homeKwh <= 2000;
    }
    const dayRate = parseRate(discount ? rates.discountDay : rates.standardDay);
    const nightRate = parseRate(
      discount ? rates.discountNight : rates.standardNight,
    );
    if (dayRate === null || nightRate === null) {
      invalidRates = true;
      continue;
    }
    cost += day.dayKwh * dayRate + day.nightKwh * nightRate;
  }
  return {
    cost: missingMonths.size || invalidRates ? null : cost,
    dayKwh,
    nightKwh,
    missingMonths: [...missingMonths].sort(),
    invalidRates,
  };
}
