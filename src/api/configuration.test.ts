import { test } from "node:test";
import assert from "node:assert/strict";
import { lireConfigurationDemo } from "./configuration.ts";

test("configuration démo : valeurs sûres par défaut et écoute locale", () => {
  assert.deepEqual(lireConfigurationDemo({}), { port: 8787, host: "127.0.0.1" });
});

test("configuration démo : rayon seul n'active pas le géorepérage et ne bloque pas le démarrage", () => {
  assert.deepEqual(lireConfigurationDemo({ ZONE_RAYON: "150" }), { port: 8787, host: "127.0.0.1" });
  assert.deepEqual(lireConfigurationDemo({ ZONE_LAT: "", ZONE_LNG: "", ZONE_RAYON: "150" }), { port: 8787, host: "127.0.0.1" });
});

test("configuration démo : zone de pointage validée et rayon par défaut", () => {
  assert.deepEqual(lireConfigurationDemo({ ZONE_LAT: "14.6928", ZONE_LNG: "-17.4467" }), {
    port: 8787, host: "127.0.0.1", zone: { latitude: 14.6928, longitude: -17.4467, rayonM: 150 },
  });
  assert.deepEqual(lireConfigurationDemo({ HOST: "0.0.0.0", PORT: "8788", ZONE_LAT: "0", ZONE_LNG: "180", ZONE_RAYON: "250" }), {
    port: 8788, host: "0.0.0.0", zone: { latitude: 0, longitude: 180, rayonM: 250 },
  });
});

test("configuration démo : ports, coordonnées partielles, hors limites et rayons aberrants refusés", () => {
  for (const env of [
    { PORT: "0" }, { PORT: "65536" }, { PORT: "12.5" }, { HOST: "" },
    { ZONE_LAT: "14.5" }, { ZONE_LNG: "-17.4" },
    { ZONE_LAT: "91", ZONE_LNG: "0" }, { ZONE_LAT: "NaN", ZONE_LNG: "0" },
    { ZONE_LAT: "0", ZONE_LNG: "181" }, { ZONE_LAT: "0", ZONE_LNG: "0", ZONE_RAYON: "0" },
    { ZONE_LAT: "0", ZONE_LNG: "0", ZONE_RAYON: "100001" },
  ]) assert.throws(() => lireConfigurationDemo(env), /./, JSON.stringify(env));
});
