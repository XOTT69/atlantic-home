import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDailyEnergy,
  localDateKey,
  numericReading,
  averagePowerW,
  calculateEnergyCost,
} from "../lib/energy-pricing.ts";
const at = (value) => Date.parse(value);
const samples = (start, end, wh = 250) => [
  { sampledAt: at(start), cumulativeEnergyWh: 1000 },
  { sampledAt: at(end), cumulativeEnergyWh: 1000 + wh },
];
test("missing telemetry never becomes a zero", () => {
  for (const v of [null, undefined, "", " ", false, {}, NaN])
    assert.equal(numericReading(v), null);
  assert.equal(numericReading(0), 0);
  assert.equal(numericReading("22,4"), 22.4);
});
test("Kyiv calendar is independent of viewer zone", () =>
  assert.equal(localDateKey(at("2026-11-01T22:30:00Z")), "2026-11-02"));
test("23:00 Kyiv divides day and night correctly", () => {
  const [d] = buildDailyEnergy(
    samples("2026-11-01T20:45:00Z", "2026-11-01T21:15:00Z", 500),
    1,
    at("2026-11-01T21:30:00Z"),
  );
  assert.equal(d.dayKwh, 0.25);
  assert.equal(d.nightKwh, 0.25);
  assert.equal(d.coveredMinutes, 30);
});
test("07:00 Kyiv divides night and day correctly", () => {
  const [d] = buildDailyEnergy(
    samples("2026-11-01T04:45:00Z", "2026-11-01T05:15:00Z", 500),
    1,
    at("2026-11-01T06:00:00Z"),
  );
  assert.equal(d.dayKwh, 0.25);
  assert.equal(d.nightKwh, 0.25);
});
test("absent days remain identifiable, gaps marked estimated", () => {
  const d = buildDailyEnergy(
    samples("2026-11-01T08:00:00Z", "2026-11-01T10:00:00Z", 1000),
    2,
    at("2026-11-01T11:00:00Z"),
  );
  assert.equal(d[0].coveredMinutes, 0);
  assert.equal(d[0].estimatedMinutes, 0);
  assert.equal(d[1].estimatedMinutes, 120);
});
test("counter resets and impossible spikes are not consumption", () => {
  for (const wh of [-500, 999999]) {
    const [d] = buildDailyEnergy(
      samples("2026-11-01T08:00:00Z", "2026-11-01T08:15:00Z", wh),
      1,
      at("2026-11-01T09:00:00Z"),
    );
    assert.equal(d.kwh, 0);
    assert.equal(d.coveredMinutes, 0);
  }
});
test("DST autumn keeps elapsed energy across repeated local hour", () => {
  const [d] = buildDailyEnergy(
    samples("2026-10-25T00:30:00Z", "2026-10-25T02:30:00Z", 1000),
    1,
    at("2026-10-25T04:00:00Z"),
  );
  assert.equal(d.nightKwh, 1);
  assert.equal(d.estimatedMinutes, 120);
});
test("DST spring conserves energy", () => {
  const [d] = buildDailyEnergy(
    samples("2026-03-29T00:30:00Z", "2026-03-29T02:30:00Z", 1000),
    1,
    at("2026-03-29T04:00:00Z"),
  );
  assert.equal(d.kwh, 1);
});
test("average watts are not inferred from nameplate or long gaps", () => {
  assert.equal(
    averagePowerW(samples("2026-11-01T08:00:00Z", "2026-11-01T08:15:00Z")),
    1000,
  );
  assert.equal(
    averagePowerW(samples("2026-11-01T08:00:00Z", "2026-11-01T10:00:00Z")),
    null,
  );
});
test("owner tariff rule: 2000 discount, above standard, missing unknown", () => {
  const days = [{ key: "2026-11-01", dayKwh: 1, nightKwh: 1, kwh: 2 }];
  const rates = {
    discountDay: "2.64",
    discountNight: "1.32",
    standardDay: "4.32",
    standardNight: "2.16",
  };
  assert.equal(
    calculateEnergyCost(days, { "2026-11": "2000" }, rates, true).cost,
    3.96,
  );
  assert.equal(
    calculateEnergyCost(days, { "2026-11": "2001" }, rates, true).cost,
    6.48,
  );
  assert.equal(calculateEnergyCost(days, {}, rates, true).cost, null);
});
test("empty month in displayed range does not block cost of a measured month", () => {
  const rates = {
    discountDay: "2.64",
    discountNight: "1.32",
    standardDay: "4.32",
    standardNight: "2.16",
  };
  const days = [
    { key: "2026-10-31", kwh: 0, dayKwh: 0, nightKwh: 0 },
    { key: "2026-11-01", kwh: 1, dayKwh: 1, nightKwh: 0 },
  ];
  assert.equal(
    calculateEnergyCost(days, { "2026-11": "1000" }, rates, true).cost,
    2.64,
  );
});
