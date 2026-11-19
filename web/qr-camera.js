/** Contraintes souples : caméra arrière et image HD sans forcer les appareils qui ne la supportent pas. */
export const CONTRAINTES_CAMERA_QR = Object.freeze({
  facingMode: Object.freeze({ ideal: "environment" }),
  width: Object.freeze({ ideal: 1280 }),
  height: Object.freeze({ ideal: 720 }),
  frameRate: Object.freeze({ ideal: 30 }),
});

export const INTERVALLE_SCAN_QR_NATIF_MS = 90;
export const INTERVALLE_SCAN_QR_JS_MS = 120;
export const LARGEUR_MAX_DETECTION_QR = 960;

/** Réduit les images très grandes sans descendre sous la définition utile au décodage d'un QR imprimé. */
export function calculerDimensionsDetectionQr(largeurSource, hauteurSource, maximum = LARGEUR_MAX_DETECTION_QR) {
  const largeur = Number(largeurSource);
  const hauteur = Number(hauteurSource);
  const limite = Number(maximum);
  if (![largeur, hauteur, limite].every(Number.isFinite) || largeur <= 0 || hauteur <= 0 || limite <= 0) {
    return { width: 0, height: 0 };
  }
  const facteur = Math.min(1, limite / Math.max(largeur, hauteur));
  return {
    width: Math.max(1, Math.round(largeur * facteur)),
    height: Math.max(1, Math.round(hauteur * facteur)),
  };
}
