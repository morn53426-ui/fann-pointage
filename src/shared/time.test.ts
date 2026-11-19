import { test } from "node:test";
import assert from "node:assert/strict";
import { dakarDateTime, dakarParts } from "./time.ts";

test("08h00 Dakar = 08h00 UTC (UTC+0)", () => {
  assert.equal(dakarDateTime(2026, 10, 12, 8, 0).toISOString(), "2026-10-12T08:00:00.000Z");
});
test("le 11/10/2026 est un dimanche (ISO 7)", () => {
  assert.equal(dakarParts(dakarDateTime(2026, 10, 11, 9)).isoWeekday, 7);
});
test("poste de nuit 20h -> 08h le lendemain passe minuit", () => {
  const start = dakarDateTime(2026, 10, 12, 20);
  const end = new Date(start.getTime() + 12 * 3_600_000);
  assert.equal(end.toISOString(), "2026-10-13T08:00:00.000Z");
  assert.equal(dakarParts(end).day, 13);
});
test("aller-retour parties <-> instant", () => {
  const d = dakarDateTime(2026, 3, 1, 23, 59);
  const p = dakarParts(d);
  assert.deepEqual([p.year, p.month, p.day, p.hour, p.minute], [2026, 3, 1, 23, 59]);
});
