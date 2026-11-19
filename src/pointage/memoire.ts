// Dépôts en mémoire : tests et démonstrations avec données FICTIVES uniquement.
import { ErreurRegime } from "../shared/types.ts";
import { ErreurDoublon } from "./service.ts";
import type { AgentCtx, Depots, EvenementSecurite, NouveauPointage, PointageEnregistre, PostePlanifie } from "./service.ts";
import type { ZoneLoc } from "./localisation.ts";
import type { DepotsManuel } from "./manuel.ts";

export class DepotMemoire implements Depots, DepotsManuel {
  horloge: Date;
  secret = "secret-de-test-0123456789-0123456789-abcdef";
  agents = new Map<string, AgentCtx>();
  zones = new Map<string, ZoneLoc>();
  /** Les identifiants de poste ne sont pas uniques entre agents (même horaire) : on range donc les postes par agent. */
  entrees: { agentId: string; poste: PostePlanifie }[] = [];
  pointages: PointageEnregistre[] = [];
  usages = new Set<string>();
  journal: EvenementSecurite[] = [];
  echecEnregistrement = false;
  protected seq = 0;

  constructor(horloge: Date) { this.horloge = horloge; }

  maintenant() { return this.horloge; }
  secretQr() { return this.secret; }
  async agent(id: string) { return this.agents.get(id) ?? null; }
  async zone(id: string) { return this.zones.get(id) ?? null; }
  async zonesDuService(serviceId: string) { return [...this.zones.values()].filter((z) => z.serviceId === serviceId && z.actif); }
  async zonesActives() { return [...this.zones.values()].filter((z) => z.actif); }
  async postesAgent(agentId: string) { return this.entrees.filter((e) => e.agentId === agentId).map((e) => e.poste); }
  ajouterPoste(agentId: string, p: PostePlanifie) { this.entrees.push({ agentId, poste: p }); }
  async pointagesDuPoste(agentId: string, posteId: string) { return this.pointages.filter((p) => p.agentId === agentId && p.posteId === posteId); }
  async pointageParCle(agentId: string, cle: string) { return this.pointages.find((p) => p.agentId === agentId && p.idempotencyKey === cle) ?? null; }
  async pointageParId(id: string) { return this.pointages.find((p) => p.id === id) ?? null; }
  async qrDejaUtilise(tokenHash: string, agentId: string) { return this.usages.has(`${tokenHash}|${agentId}`); }
  async compterRefusHorsZone(agentId: string, depuis: Date) {
    return this.pointages.filter((p) => p.agentId === agentId && p.statutLocalisation === "hors_zone" && p.serverTs >= depuis).length;
  }
  async enregistrer(p: NouveauPointage) {
    if (this.echecEnregistrement) throw new Error("base indisponible");
    if (this.pointages.some((x) => x.agentId === p.agentId && x.idempotencyKey === p.idempotencyKey)) throw new ErreurDoublon();
    const e: PointageEnregistre = { ...p, id: `p${++this.seq}` };
    this.pointages.push(e);
    if (p.tokenHash) this.usages.add(`${p.tokenHash}|${p.agentId}`);
    return e;
  }
  async marquerValideManuellement(id: string, acteurId: string, motif: string, at: Date) {
    const i = this.pointages.findIndex((p) => p.id === id);
    if (i < 0) throw new ErreurRegime("introuvable", "Pointage introuvable");
    this.pointages[i] = { ...this.pointages[i], validation: "valide_manuellement", valideManuellementPar: acteurId, motifValidationManuelle: motif, serverTs: this.pointages[i].serverTs };
    void at;
    return this.pointages[i];
  }
  async journaliser(e: EvenementSecurite) { this.journal.push(e); }
}
