// QR dynamique signé (HMAC-SHA256), lié à une zone, avec expiration. Le secret reste côté serveur.
// Un QR ne prouve PAS l'identité : il doit toujours être associé à une session authentifiée.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export interface QrEmis { token: string; tokenHash: string; zoneId: string; issuedAt: Date; expiresAt: Date }
export type VerifQr =
  | { ok: true; zoneId: string; tokenHash: string; issuedAt: Date; expiresAt: Date; permanent?: false }
  | { ok: true; zoneId: string; tokenHash: string; permanent: true }
  | { ok: false; raison: "format" | "signature" | "expire" | "pas_encore_valide" };

export const DUREE_QR_DEFAUT_S = 60;
const AVANCE_TOLEREE_MS = 5_000;

export const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");
const signer = (payload: string, secret: string) => createHmac("sha256", secret).update(payload).digest("base64url");

export function emettreQr(o: { zoneId: string; secret: string; maintenant: Date; dureeS?: number; nonce?: string }): QrEmis {
  if (o.secret.length < 32) throw new Error("Secret QR trop court (32 caractères minimum)");
  const iat = o.maintenant.getTime();
  const exp = iat + (o.dureeS ?? DUREE_QR_DEFAUT_S) * 1000;
  const nonce = o.nonce ?? randomBytes(12).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ v: 1, z: o.zoneId, i: iat, e: exp, n: nonce })).toString("base64url");
  const token = `${payload}.${signer(payload, o.secret)}`;
  return { token, tokenHash: hashToken(token), zoneId: o.zoneId, issuedAt: new Date(iat), expiresAt: new Date(exp) };
}

// ---------- QR permanent d'une zone (affiche imprimée, valable des mois) ----------
// Pas d'expiration ni de nonce : le jeton est entièrement déterminé par la zone et le secret serveur (donc stable à chaque impression).
// Il ne prouve ni l'identité (session obligatoire) ni la présence (position GPS contrôlée par le serveur). Il n'est pas « à usage unique » :
// l'anti-doublon repose sur la clé d'idempotence, l'intervalle minimal entre deux scans et la séquence arrivée/départ.
// Révocation : désactiver la zone (refus immédiat) ou changer BADGE_SECRET (invalide tous les QR permanents).
const PREFIXE_PERMANENT = "FQP1";
const cleQrPermanent = (secret: string) => createHmac("sha256", secret).update("FANN-POINTAGE:QR-ZONE-PERMANENT:v1").digest();
const signerPermanent = (zoneId: string, secret: string) => createHmac("sha256", cleQrPermanent(secret)).update(`${PREFIXE_PERMANENT}.${zoneId}`).digest("base64url");
const ZONE_ID_VALIDE = /^[A-Za-z0-9_-]{1,64}$/;

export function emettreQrPermanent(o: { zoneId: string; secret: string }): { token: string; zoneId: string } {
  if (o.secret.length < 32) throw new Error("Secret QR trop court (32 caractères minimum)");
  if (!ZONE_ID_VALIDE.test(o.zoneId)) throw new Error("Identifiant de zone invalide");
  return { token: `${PREFIXE_PERMANENT}.${o.zoneId}.${signerPermanent(o.zoneId, o.secret)}`, zoneId: o.zoneId };
}

function verifierQrPermanent(token: string, secret: string): VerifQr {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== PREFIXE_PERMANENT || !ZONE_ID_VALIDE.test(parts[1]) || !parts[2]) return { ok: false, raison: "format" };
  const attendu = Buffer.from(signerPermanent(parts[1], secret));
  const recu = Buffer.from(parts[2]);
  if (attendu.length !== recu.length || !timingSafeEqual(attendu, recu)) return { ok: false, raison: "signature" };
  return { ok: true, zoneId: parts[1], tokenHash: hashToken(token), permanent: true };
}

export function verifierQr(token: unknown, secret: string, maintenant: Date): VerifQr {
  if (typeof token !== "string" || token.length > 1024) return { ok: false, raison: "format" };
  if (token.startsWith(`${PREFIXE_PERMANENT}.`)) return verifierQrPermanent(token, secret);
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, raison: "format" };
  const [payload, sig] = parts;
  const attendu = Buffer.from(signer(payload, secret));
  const recu = Buffer.from(sig);
  if (attendu.length !== recu.length || !timingSafeEqual(attendu, recu)) return { ok: false, raison: "signature" };
  let d: { v?: unknown; z?: unknown; i?: unknown; e?: unknown };
  try { d = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch { return { ok: false, raison: "format" }; }
  if (d.v !== 1 || typeof d.z !== "string" || typeof d.i !== "number" || typeof d.e !== "number") return { ok: false, raison: "format" };
  const t = maintenant.getTime();
  if (t >= d.e) return { ok: false, raison: "expire" };
  if (t < d.i - AVANCE_TOLEREE_MS) return { ok: false, raison: "pas_encore_valide" };
  return { ok: true, zoneId: d.z, tokenHash: hashToken(token), issuedAt: new Date(d.i), expiresAt: new Date(d.e) };
}
