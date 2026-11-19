// Validation unique des photos d'agents (data URL JPEG). Utilisée par le magasin, les routes et le catalogue PostgreSQL.
const FORMAT = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/;

/** Vrai si la valeur est une data URL base64 dont les octets décodés commencent par la signature JPEG (FF D8 FF).
 *  Le contrôle de taille reste fait par l'appelant (limite historique : 110 000 caractères). */
export function photoJpegValide(valeur: unknown): boolean {
  if (typeof valeur !== "string") return false;
  const m = FORMAT.exec(valeur);
  if (!m) return false;
  const debut = Buffer.from(m[1]!.slice(0, 8), "base64");
  return debut.length >= 3 && debut[0] === 0xff && debut[1] === 0xd8 && debut[2] === 0xff;
}
