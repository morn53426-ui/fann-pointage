import { test } from "node:test";
import assert from "node:assert/strict";
import { haversineMeters } from "./geo.ts";

// Coordonnées FICTIVES (données de test uniquement)
const zone = { lat: 14.0, lng: -17.0 };

test("0,001° de latitude ≈ 111,2 m", () => {
  const d = haversineMeters({ lat: 14.0, lng: -17.0 }, { lat: 14.001, lng: -17.0 });
  assert.ok(Math.abs(d - 111.2) < 0.5, `distance = ${d}`);
});
test("distance nulle au centre", () => {
  assert.equal(haversineMeters(zone, zone), 0);
});
