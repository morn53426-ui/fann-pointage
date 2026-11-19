import { test } from "node:test";
import assert from "node:assert/strict";
import { creerSourceQrBadge, OPTIONS_QR_BADGE } from "../../web/badge-qr.js";

test("QR du badge : noir pur, blanc pur, niveau peu dense et zone de silence normalisée", () => {
  assert.deepEqual(OPTIONS_QR_BADGE, {
    margin: 4,
    errorCorrectionLevel: "L",
    dark: "#000000",
    light: "#ffffff",
  });
  let codeLu = "";
  let optionsLues: unknown;
  const generateur = { toSvg(code: string, options: unknown) { codeLu = code; optionsLues = options; return '<svg viewBox="0 0 45 45"><rect fill="#ffffff"/><path fill="#000000"/></svg>'; } };
  const source = creerSourceQrBadge(generateur, " FANN-BADGE:TEST-123 ");
  assert.ok(source.startsWith("data:image/svg+xml;charset=utf-8,"));
  assert.equal(codeLu, "FANN-BADGE:TEST-123");
  assert.equal(optionsLues, OPTIONS_QR_BADGE);
  const svg = decodeURIComponent(source.split(",", 2)[1]);
  assert.match(svg, /fill="#ffffff"/);
  assert.match(svg, /fill="#000000"/);
});

test("QR du badge : génération vide en cas de jeton ou bibliothèque absente", () => {
  assert.equal(creerSourceQrBadge(null, "FANN-BADGE:TEST"), "");
  assert.equal(creerSourceQrBadge({ toSvg: () => "<svg/>" }, ""), "");
  assert.equal(creerSourceQrBadge({ toSvg: () => { throw new Error("nope"); } }, "FANN-BADGE:TEST"), "");
});
