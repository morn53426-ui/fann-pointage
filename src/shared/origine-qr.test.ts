// Audit v31, F-01 : une affiche QR permanente ne doit jamais encoder une adresse inutilisable ou non sécurisée.
import test from "node:test";
import assert from "node:assert/strict";
import { evaluerOrigineQr } from "../../web/origine-qr.js";

const niveau = (u: string) => evaluerOrigineQr(u).niveau;

test("origine QR : l'impression de production est refusée (niveau « test ») pour localhost, boucle locale, tunnels et tout http", () => {
  for (const u of [
    "http://localhost:8787", "https://localhost", "https://app.localhost", "http://127.0.0.1:8788", "https://127.0.0.1", "https://127.1.2.3",
    "https://0.0.0.0", "https://[::1]", "https://[::ffff:127.0.0.1]",
    "https://abc.ngrok-free.app", "https://x.ngrok.io", "https://x.trycloudflare.com", "https://x.loca.lt", "https://x.lhr.life", "https://x.serveo.net",
    "http://fann.chnuf.sn", "http://192.168.1.80", "http://10.0.0.5", "http://example.com",
    "https://8.8.8.8",
  ]) assert.equal(niveau(u), "test", u);
  assert.ok(evaluerOrigineQr("http://fann.chnuf.sn").raisons.some((r) => /HTTPS/.test(r)));
});

test("origine QR : les adresses du réseau interne en https exigent une confirmation (niveau « interne »)", () => {
  for (const u of [
    "https://192.168.1.80", "https://10.1.2.3", "https://172.16.0.9", "https://172.31.255.1", "https://169.254.1.1", "https://100.64.0.1",
    "https://serveur-fann", "https://fann.local", "https://fann.lan", "https://fann.home.arpa", "https://[fd12:3456::1]", "https://[fe80::1]", "https://[::ffff:192.168.1.5]",
  ]) assert.equal(niveau(u), "interne", u);
  assert.equal(niveau("https://172.32.0.1"), "test", "172.32 est une IP publique brute : refusée");
});

test("origine QR : un domaine public en https est accepté (production) et l'origine est normalisée", () => {
  const e = evaluerOrigineQr("  https://pointage.chnuf.sn/chemin?x=1#y ");
  assert.equal(e.niveau, "production");
  assert.equal(e.base, "https://pointage.chnuf.sn");
  assert.deepEqual(e.raisons, []);
  assert.equal(niveau("https://pointage.chnuf.sn:8443"), "production");
});

test("origine QR : valeurs invalides", () => {
  for (const u of ["", "pointage", "ftp://x.example", "javascript:alert(1)", "https://user:pw@x.example", "https://"]) assert.equal(niveau(u), "invalide", u);
  assert.equal(niveau(undefined as unknown as string), "invalide");
});
