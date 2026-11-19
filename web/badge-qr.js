/** QR des badges imprimés : noir pur, fond blanc et zone de silence ISO de 4 modules. */
export const OPTIONS_QR_BADGE = Object.freeze({
  margin: 4,
  errorCorrectionLevel: "L",
  dark: "#000000",
  light: "#ffffff",
});

/** Retourne une image SVG vectorielle nette à l'impression, sans changer la taille du badge. */
export function creerSourceQrBadge(generateur, code) {
  if (!generateur || typeof generateur.toSvg !== "function" || !String(code ?? "").trim()) return "";
  try {
    const svg = generateur.toSvg(String(code).trim(), OPTIONS_QR_BADGE);
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  } catch {
    return "";
  }
}
