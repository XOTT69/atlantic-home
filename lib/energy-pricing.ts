export type EnergySample = { sampledAt: number; cumulativeEnergyWh: number };
export type DailyEnergy = { key: string; label: string; kwh: number; dayKwh: number; nightKwh: number };
export type EnergyRates = { discountDay: string; discountNight: string; standardDay: string; standardNight: string };

function localDateKey(at: number) {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addToDay(totals: Map<string, DailyEnergy>, at: number, kwh: number, night: boolean) {
  const key = localDateKey(at);
  const item = totals.get(key) ?? {
    key,
    label: new Date(at).toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit" }),
    kwh: 0,
    dayKwh: 0,
    nightKwh: 0
  };
  item.kwh += kwh;
  if (night) item.nightKwh += kwh;
  else item.dayKwh += kwh;
  totals.set(key, item);
}

/**
 * The meter only reports cumulative energy. Split each observed delta across
 * the elapsed time and its local day/night periods; this is an estimate when
 * Cozytouch polling has gaps, not a direct hourly meter reading.
 */
export function buildDailyEnergy(samples: EnergySample[], days: number, now: number): DailyEnergy[] {
  const totals = new Map<string, DailyEnergy>();
  const ordered = [...samples].sort((a, b) => a.sampledAt - b.sampledAt);
  for (let index = 1; index < ordered.length; index++) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    const elapsed = current.sampledAt - previous.sampledAt;
    const deltaWh = current.cumulativeEnergyWh - previous.cumulativeEnergyWh;
    if (elapsed <= 0 || !Number.isFinite(deltaWh) || deltaWh < 0) continue;

    let cursor = previous.sampledAt;
    while (cursor < current.sampledAt) {
      const date = new Date(cursor);
      const nextHour = (Math.floor(cursor / 3_600_000) + 1) * 3_600_000;
      const segmentEnd = Math.min(nextHour, current.sampledAt);
      const segmentKwh = (deltaWh / 1000) * ((segmentEnd - cursor) / elapsed);
      const hour = date.getHours();
      addToDay(totals, cursor, segmentKwh, hour >= 23 || hour < 7);
      cursor = segmentEnd;
    }
  }

  const result: DailyEnergy[] = [];
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  for (let offset = days - 1; offset >= 0; offset--) {
    const date = new Date(today);
    date.setDate(today.getDate() - offset);
    const key = localDateKey(date.getTime());
    result.push(totals.get(key) ?? {
      key,
      label: date.toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit" }),
      kwh: 0,
      dayKwh: 0,
      nightKwh: 0
    });
  }
  return result;
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
  winterDiscountEnabled: boolean
) {
  let cost = 0;
  let dayKwh = 0;
  let nightKwh = 0;
  let invalidRates = false;
  const missingMonths = new Set<string>();
  for (const day of days) {
    dayKwh += day.dayKwh;
    nightKwh += day.nightKwh;
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
    const nightRate = parseRate(discount ? rates.discountNight : rates.standardNight);
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
    invalidRates
  };
}
