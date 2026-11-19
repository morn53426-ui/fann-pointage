import { test } from "node:test";
import assert from "node:assert/strict";
import { emettreQr, hashToken, verifierQr } from "./qr.ts";

const secret = "un-secret-serveur-long-0123456789-0123456789";
const t0 = new Date("2026-10-12T08:00:00Z");
const plus = (s: number) => new Date(t0.getTime() + s * 1000);

test("QR valide : zone, expiration, hash", () => {
  const qr = emettreQr({ zoneId: "z1", secret, maintenant: t0 });
  const v = verifierQr(qr.token, secret, plus(10));
  assert.ok(v.ok && v.zoneId === "z1" && v.tokenHash === hashToken(qr.token));
});
test("deux QR émis au même instant sont différents (nonce)", () => {
  assert.notEqual(emettreQr({ zoneId: "z1", secret, maintenant: t0 }).token, emettreQr({ zoneId: "z1", secret, maintenant: t0 }).token);
});
test("QR expiré à l'instant exact d'expiration (borne exclusive)", () => {
  const qr = emettreQr({ zoneId: "z1", secret, maintenant: t0 });
  assert.deepEqual(verifierQr(qr.token, secret, plus(60)), { ok: false, raison: "expire" });
  assert.deepEqual(verifierQr(qr.token, secret, plus(61)), { ok: false, raison: "expire" });
});
test("QR falsifié (zone modifiée) ou mauvais secret : refusé", () => {
  const qr = emettreQr({ zoneId: "z1", secret, maintenant: t0 });
  const [p, s] = qr.token.split(".");
  const payload = JSON.parse(Buffer.from(p, "base64url").toString());
  payload.z = "z2";
  const forge = `${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${s}`;
  assert.equal((verifierQr(forge, secret, plus(1)) as { raison: string }).raison, "signature");
  assert.equal((verifierQr(qr.token, secret + "x", plus(1)) as { raison: string }).raison, "signature");
});
test("formats invalides", () => {
  for (const x of ["", "abc", "a.b.c", 42, null, undefined, "x".repeat(2000)]) {
    assert.equal(verifierQr(x, secret, t0).ok, false);
  }
});
test("QR pas encore valide (horloge en avance côté QR)", () => {
  const qr = emettreQr({ zoneId: "z1", secret, maintenant: plus(120) });
  assert.equal((verifierQr(qr.token, secret, t0) as { raison: string }).raison, "pas_encore_valide");
});
test("secret trop court refusé", () => {
  assert.throws(() => emettreQr({ zoneId: "z1", secret: "court", maintenant: t0 }));
});
