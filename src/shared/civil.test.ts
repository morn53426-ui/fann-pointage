import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, parseCle } from "./civil.ts";

test("parseCle n'accepte que des dates civiles réelles", () => {
  assert.deepEqual(parseCle("2024-02-29"), { year: 2024, month: 2, day: 29 });
  for (const invalid of ["2026-02-29", "2026-02-31", "2026-04-31", "2026-13-01", "2026-00-10", "0000-01-01", "2026-1-01", "2026-01-1"]) {
    assert.throws(() => parseCle(invalid), /Date civile invalide|Date invalide/, invalid);
  }
});

test("addDays traverse correctement la fin de mois et d'année", () => {
  assert.deepEqual(addDays(parseCle("2026-12-31"), 1), { year: 2027, month: 1, day: 1 });
  assert.deepEqual(addDays(parseCle("2024-02-28"), 1), { year: 2024, month: 2, day: 29 });
});
