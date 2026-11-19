// Authentification de DÉVELOPPEMENT : mots de passe hachés (scrypt), sessions signées, limitation des tentatives.
// En production, l'authentification est déléguée à un fournisseur éprouvé (ex. Supabase Auth) ; les droits restent vérifiés côté serveur.
import { createHmac, randomBytes, scrypt, scryptSync, timingSafeEqual } from "node:crypto";

export function hashMotDePasse(mdp: string): string {
  const sel = randomBytes(16);
  return `scrypt$${sel.toString("base64url")}$${scryptSync(mdp, sel, 32).toString("base64url")}`;
}

export function verifierMotDePasse(mdp: string, stocke: string): boolean {
  const [alg, sel, h] = stocke.split("$");
  if (alg !== "scrypt" || !sel || !h) return false;
  const attendu = Buffer.from(h, "base64url");
  const calcule = scryptSync(mdp, Buffer.from(sel, "base64url"), attendu.length);
  return calcule.length === attendu.length && timingSafeEqual(calcule, attendu);
}

// --- Hachage asynchrone : sur le chemin des requêtes HTTP, scrypt ne doit jamais bloquer la boucle d'événements
// (un pointage ou une connexion en cours ne doit pas attendre le calcul du hachage d'un autre utilisateur).
// Même algorithme et mêmes paramètres que les fonctions synchrones : les hachages existants restent valides.
const scryptAsync = (mdp: string, sel: Buffer, longueur: number): Promise<Buffer> =>
  new Promise((resolve, reject) => scrypt(mdp, sel, longueur, (e, cle) => (e ? reject(e) : resolve(cle))));

/** Erreur levée quand trop de calculs de hachage sont déjà en attente : la route répond 503 au lieu de saturer le serveur. */
export class ErreurSurcharge extends Error { constructor() { super("Serveur occupé"); this.name = "ErreurSurcharge"; } }

/** File à concurrence bornée : au plus `max` hachages en parallèle (pool libuv de 4 threads), `maxAttente` en file, le reste est refusé. */
export class FileCalculs {
  private actifs = 0;
  private readonly attente: Array<() => void> = [];
  private readonly max: number;
  private readonly maxAttente: number;
  constructor(max = 3, maxAttente = 64) { this.max = max; this.maxAttente = maxAttente; }
  async executer<T>(travail: () => Promise<T>): Promise<T> {
    if (this.actifs < this.max) this.actifs += 1;
    else {
      if (this.attente.length >= this.maxAttente) throw new ErreurSurcharge();
      await new Promise<void>((reprendre) => this.attente.push(reprendre)); // le créneau est transmis par celui qui termine
    }
    try { return await travail(); } finally {
      const suivant = this.attente.shift();
      if (suivant) suivant(); else this.actifs -= 1;
    }
  }
}
const fileHachage = new FileCalculs();

export function hashMotDePasseAsync(mdp: string): Promise<string> {
  return fileHachage.executer(async () => {
    const sel = randomBytes(16);
    return `scrypt$${sel.toString("base64url")}$${(await scryptAsync(mdp, sel, 32)).toString("base64url")}`;
  });
}

export function verifierMotDePasseAsync(mdp: string, stocke: string): Promise<boolean> {
  const [alg, sel, h] = stocke.split("$");
  if (alg !== "scrypt" || !sel || !h) return Promise.resolve(false);
  const attendu = Buffer.from(h, "base64url");
  return fileHachage.executer(async () => {
    const calcule = await scryptAsync(mdp, Buffer.from(sel, "base64url"), attendu.length);
    return calcule.length === attendu.length && timingSafeEqual(calcule, attendu);
  });
}

const signer = (p: string, secret: string) => createHmac("sha256", secret).update(p).digest("base64url");

export function creerSession(userId: string, secret: string, now: Date, dureeS = 8 * 3600, versionCompte = 0): string {
  if (secret.length < 32) throw new Error("Secret de session trop court");
  if (!Number.isInteger(versionCompte) || versionCompte < 0) throw new Error("Version de session invalide");
  const p = Buffer.from(JSON.stringify({ u: userId, e: now.getTime() + dureeS * 1000, v: versionCompte })).toString("base64url");
  return `${p}.${signer(p, secret)}`;
}

export function lireSessionAvecVersion(token: string | undefined, secret: string, now: Date): { utilisateurId: string; versionCompte: number } | null {
  if (!token || token.length > 600) return null;
  const parties = token.split(".");
  if (parties.length !== 2) return null;
  const [p, s] = parties;
  if (!p || !s) return null;
  const a = Buffer.from(signer(p, secret)), b = Buffer.from(s);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const d = JSON.parse(Buffer.from(p, "base64url").toString("utf8")) as { u?: unknown; e?: unknown; v?: unknown };
    // Les anciens jetons sans champ v restent lisibles comme version 0 pour la compatibilité.
    const versionCompte = d.v === undefined ? 0 : d.v;
    if (typeof d.u !== "string" || typeof d.e !== "number" || !Number.isInteger(versionCompte) || typeof versionCompte !== "number" || versionCompte < 0 || now.getTime() >= d.e) return null;
    return { utilisateurId: d.u, versionCompte };
  } catch { return null; }
}

/** Limite les échecs par clé (IP + identifiant) avec une mémoire strictement bornée. */
export class LimiteurTentatives {
  private echecs = new Map<string, number[]>();
  max: number;
  fenetreMs: number;
  maxCles: number;

  constructor(max = 5, fenetreMs = 15 * 60_000, maxCles = 10_000) {
    if (!Number.isInteger(max) || max < 1) throw new Error("Le nombre maximal de tentatives doit être positif.");
    if (!Number.isFinite(fenetreMs) || fenetreMs < 1) throw new Error("La fenêtre de limitation doit être positive.");
    if (!Number.isInteger(maxCles) || maxCles < 1) throw new Error("La capacité du limiteur doit être positive.");
    this.max = max;
    this.fenetreMs = fenetreMs;
    this.maxCles = maxCles;
  }

  private recents(cle: string, now: Date): number[] {
    const anciens = this.echecs.get(cle);
    if (!anciens) return [];
    const t = now.getTime();
    const l = anciens.filter((a) => t - a >= 0 && t - a < this.fenetreMs);
    // Rafraîchit l'ordre d'activité pour que l'éviction vise les clés les plus anciennes.
    this.echecs.delete(cle);
    if (l.length) this.echecs.set(cle, l);
    return l;
  }

  bloque(cle: string, now: Date, seuil = this.max): boolean {
    if (!Number.isInteger(seuil) || seuil < 1) throw new Error("Le seuil de limitation doit être positif.");
    return this.recents(cle, now).length >= seuil;
  }

  echec(cle: string, now: Date, seuil = this.max): void {
    if (!Number.isInteger(seuil) || seuil < 1) throw new Error("Le seuil de limitation doit être positif.");
    const l = this.recents(cle, now);
    if (!this.echecs.has(cle) && this.echecs.size >= this.maxCles) {
      const plusAncienne = this.echecs.keys().next().value as string | undefined;
      if (plusAncienne !== undefined) this.echecs.delete(plusAncienne);
    }
    this.echecs.set(cle, [...l, now.getTime()]);
  }

  succes(cle: string): void { this.echecs.delete(cle); }

  /** Débloque un compte : supprime les échecs de toutes les adresses IP pour cet identifiant (normalisé comme à la connexion). */
  reinitialiserCompte(identifiant: string): number {
    const suffixe = `|${identifiant.trim().toLowerCase()}`;
    let n = 0;
    for (const cle of [...this.echecs.keys()]) {
      if (cle.startsWith("compte:") && cle.endsWith(suffixe)) { this.echecs.delete(cle); n++; }
    }
    return n;
  }

  /** Utile pour la surveillance et les tests : le nombre de clés ne dépasse jamais maxCles. */
  get nombreCles(): number { return this.echecs.size; }
}
