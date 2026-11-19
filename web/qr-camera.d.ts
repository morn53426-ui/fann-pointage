export interface DimensionsDetectionQr { width: number; height: number }
export interface ContraintesCameraQr {
  readonly facingMode: Readonly<{ ideal: string }>;
  readonly width: Readonly<{ ideal: number }>;
  readonly height: Readonly<{ ideal: number }>;
  readonly frameRate: Readonly<{ ideal: number }>;
}
export const CONTRAINTES_CAMERA_QR: Readonly<ContraintesCameraQr>;
export const INTERVALLE_SCAN_QR_NATIF_MS: number;
export const INTERVALLE_SCAN_QR_JS_MS: number;
export const LARGEUR_MAX_DETECTION_QR: number;
export function calculerDimensionsDetectionQr(largeurSource: number, hauteurSource: number, maximum?: number): DimensionsDetectionQr;
