// Routes des zones (/api/zones) et des QR de pointage (/api/qr) du mode démo. Extraites de routes.ts ; même logique et mêmes droits.
// Retourne `undefined` quand la requête ne concerne pas ces routes.
import { emettreQr, emettreQrPermanent } from "../pointage/qr.ts";
import type { MagasinDemo, Utilisateur } from "./magasin.ts";
import type { Reponse, Requete } from "./routes.ts";
import { ErreurRegime } from "../shared/types.ts";
import { json } from "./reponses.ts";

export function routeZonesQr(req: Requete, user: Utilisateur, m: MagasinDemo, now: Date): Reponse | undefined {
  const { methode, chemin } = req;
  if (chemin === "/api/zones" && methode === "GET") {
    if (user.role === "brancardier") throw new ErreurRegime("non_autorise", "Accès réservé");
    const zones = [...m.zones.values()].filter((z) => user.role === "administrateur" || user.servicesGeres.includes(z.serviceId));
    return json(200, { zones: zones.map((z) => ({ id: z.id, nom: z.nom, serviceId: z.serviceId, service: m.services.find((s) => s.id === z.serviceId)?.nom ?? "", actif: z.actif })) });
  }

  if (chemin === "/api/qr" && methode === "GET") {
    const zone = m.zones.get(req.requete.zoneId ?? "");
    if (!zone) throw new ErreurRegime("introuvable", "Zone introuvable");
    if (user.role === "brancardier" || (user.role === "responsable" && !user.servicesGeres.includes(zone.serviceId))) {
      throw new ErreurRegime("non_autorise", "QR réservé aux responsables du service");
    }
    if (req.requete.permanent === "1") {
      const p = emettreQrPermanent({ zoneId: zone.id, secret: m.secret });
      return json(200, { token: p.token, permanent: true, expireLe: null, zone: zone.nom, serviceId: zone.serviceId });
    }
    const qr = emettreQr({ zoneId: zone.id, secret: m.secret, maintenant: now });
    return json(200, { token: qr.token, expireLe: qr.expiresAt.toISOString(), zone: zone.nom });
  }
  return undefined;
}
