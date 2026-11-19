import { test } from "node:test";
import assert from "node:assert/strict";
import { calculerDimensionsDetectionQr, CONTRAINTES_CAMERA_QR, INTERVALLE_SCAN_QR_JS_MS, INTERVALLE_SCAN_QR_NATIF_MS } from "../../web/qr-camera.js";

test("scan QR : image caméra redimensionnée en conservant son ratio et une définition utile", () => {
  assert.deepEqual(calculerDimensionsDetectionQr(1920, 1080), { width: 960, height: 540 });
  assert.deepEqual(calculerDimensionsDetectionQr(1280, 720), { width: 960, height: 540 });
  assert.deepEqual(calculerDimensionsDetectionQr(720, 1280), { width: 540, height: 960 });
  assert.deepEqual(calculerDimensionsDetectionQr(640, 480), { width: 640, height: 480 });
});

test("scan QR : les dimensions invalides ne provoquent pas de canvas incorrect", () => {
  assert.deepEqual(calculerDimensionsDetectionQr(0, 720), { width: 0, height: 0 });
  assert.deepEqual(calculerDimensionsDetectionQr(Number.NaN, 720), { width: 0, height: 0 });
});

test("scan QR : caméra arrière HD et fréquence de détection accélérée", () => {
  assert.deepEqual(CONTRAINTES_CAMERA_QR.facingMode, { ideal: "environment" });
  assert.equal(CONTRAINTES_CAMERA_QR.width.ideal, 1280);
  assert.equal(CONTRAINTES_CAMERA_QR.height.ideal, 720);
  assert.ok(INTERVALLE_SCAN_QR_NATIF_MS < 300);
  assert.ok(INTERVALLE_SCAN_QR_JS_MS < 300);
});
