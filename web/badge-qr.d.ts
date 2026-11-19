export interface QrBadgeOptions {
  readonly margin: number;
  readonly errorCorrectionLevel: "L" | "M" | "Q" | "H";
  readonly dark: string;
  readonly light: string;
}
export interface QrBadgeGenerator {
  toSvg(text: string, options: QrBadgeOptions): string;
}
export const OPTIONS_QR_BADGE: Readonly<QrBadgeOptions>;
export function creerSourceQrBadge(generateur: QrBadgeGenerator | null | undefined, code: unknown): string;
