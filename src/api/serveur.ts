// Adaptateur HTTP (node:http, sans dépendance). En production : derrière HTTPS (reverse proxy) ; l'IP doit alors venir du proxy de confiance.
import { createServer } from "node:http";
import type { Server } from "node:http";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { ENTETES_SECURITE, gererRequete, journaliserErreurServeur } from "./routes.ts";
import type { Contexte } from "./routes.ts";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".webmanifest": "application/manifest+json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".json": "application/json",
};
const LIMITE_CORPS = 32 * 1024;
// La création et la mise à jour des fiches agents acceptent une photo JPEG compacte (data URL) ; les autres routes gardent la limite stricte de 32 Ko.
const LIMITE_CORPS_BADGE_PHOTO = 128 * 1024;

/** IP du client. X-Forwarded-For n'est lu que si TRUST_PROXY=1 (reverse proxy de confiance) : sinon il serait falsifiable.
 *  On retient le DERNIER maillon : c'est celui ajouté par le proxy de confiance. Le premier est fourni par le client
 *  (« X-Forwarded-For: 1.2.3.4 » préfixé) et permettrait de contourner la limitation des tentatives de connexion. */
export function ipClient(rq: { socket: { remoteAddress?: string }; headers: Record<string, string | string[] | undefined> }, faireConfiance: boolean): string {
  if (faireConfiance) {
    const xff = rq.headers["x-forwarded-for"];
    const maillons = (Array.isArray(xff) ? xff.join(",") : xff)?.split(",") ?? [];
    const dernier = maillons[maillons.length - 1]?.trim();
    if (dernier && /^[0-9a-fA-F:.]{3,45}$/.test(dernier)) return dernier;
  }
  return rq.socket.remoteAddress ?? "inconnue";
}

export function creerServeur(ctx: Contexte, dossierWeb: string, options: {
  trustProxy?: boolean;
  mode?: string;
  /** Contrôle réel de disponibilité (par ex. connexion + schéma PostgreSQL). */
  checkReady?: () => Promise<void>;
  /** Cache LRU borné des fichiers statiques. 0 désactive le cache. */
  staticCacheMaxBytes?: number;
} = {}): Server {
  const racine = normalize(dossierWeb);
  const limiteCache = options.staticCacheMaxBytes ?? 4 * 1024 * 1024;
  if (!Number.isInteger(limiteCache) || limiteCache < 0 || limiteCache > 32 * 1024 * 1024) {
    throw new RangeError("staticCacheMaxBytes doit être compris entre 0 et 32 Mio.");
  }
  type AssetStatique = { contenu: Buffer; etag: string; type: string };
  const cacheStatique = new Map<string, AssetStatique>();
  let octetsCache = 0;
  const lireAsset = async (chemin: string, type: string): Promise<AssetStatique> => {
    const enCache = cacheStatique.get(chemin);
    if (enCache) {
      cacheStatique.delete(chemin);
      cacheStatique.set(chemin, enCache); // LRU : le plus récemment utilisé passe en fin de Map.
      return enCache;
    }
    const contenu = await readFile(chemin);
    const asset = { contenu, type, etag: `"${createHash("sha256").update(contenu).digest("base64url").slice(0, 22)}"` };
    if (limiteCache > 0 && contenu.length <= limiteCache) {
      while (octetsCache + contenu.length > limiteCache) {
        const ancien = cacheStatique.entries().next().value as [string, AssetStatique] | undefined;
        if (!ancien) break;
        cacheStatique.delete(ancien[0]);
        octetsCache -= ancien[1].contenu.length;
      }
      cacheStatique.set(chemin, asset);
      octetsCache += contenu.length;
    }
    return asset;
  };
  const serveur = createServer(async (rq, rs) => {
    const url = new URL(rq.url ?? "/", "http://local");
    const envoyer = (statut: number, corps: string | Buffer, type: string, extra: Record<string, string> = {}) => {
      rs.writeHead(statut, { "Content-Type": type, ...ENTETES_SECURITE, ...extra });
      rs.end(rq.method === "HEAD" ? undefined : corps);
    };
    try {
      // Vérification de vie minimale pour Docker/reverse proxy ; ne révèle aucun état interne.
      if (url.pathname === "/healthz") {
        if (!["GET", "HEAD"].includes((rq.method ?? "GET").toUpperCase())) {
          return envoyer(405, JSON.stringify({ erreur: "methode_non_autorisee" }), "application/json", { Allow: "GET, HEAD", "Cache-Control": "no-store" });
        }
        return envoyer(200, JSON.stringify({ status: "ok", mode: options.mode ?? "demo" }), "application/json", { "Cache-Control": "no-store" });
      }
      if (url.pathname === "/readyz") {
        if (!["GET", "HEAD"].includes((rq.method ?? "GET").toUpperCase())) {
          return envoyer(405, JSON.stringify({ erreur: "methode_non_autorisee" }), "application/json", { Allow: "GET, HEAD", "Cache-Control": "no-store" });
        }
        try {
          await options.checkReady?.();
          return envoyer(200, JSON.stringify({ status: "ready", mode: options.mode ?? "demo" }), "application/json", { "Cache-Control": "no-store" });
        } catch {
          // Ne pas divulguer l'erreur SQL ou l'adresse de la base via une sonde publique.
          return envoyer(503, JSON.stringify({ status: "not_ready", mode: options.mode ?? "demo" }), "application/json", { "Cache-Control": "no-store" });
        }
      }
      if (url.pathname.startsWith("/api/")) {
        let corps: unknown = undefined;
        if (rq.method === "POST" || rq.method === "PUT" || rq.method === "PATCH") {
          const morceaux: Buffer[] = []; let taille = 0;
          const routeAvecPhoto = (url.pathname === "/api/agents" && rq.method === "POST") || (rq.method === "PATCH" && /^\/api\/agents\/[A-Za-z0-9_-]{1,64}$/.test(url.pathname));
          const limiteCorps = routeAvecPhoto ? LIMITE_CORPS_BADGE_PHOTO : LIMITE_CORPS;
          for await (const c of rq) {
            taille += (c as Buffer).length;
            if (taille > limiteCorps) return envoyer(413, JSON.stringify({ erreur: "corps_trop_grand", message: "La photo envoyée est trop volumineuse. Réessayez : elle doit être automatiquement compressée avant l’envoi." }), "application/json", { "Cache-Control": "no-store" });
            morceaux.push(c as Buffer);
          }
          const brut = Buffer.concat(morceaux).toString("utf8");
          try { corps = brut ? JSON.parse(brut) : undefined; } catch { return envoyer(400, JSON.stringify({ erreur: "json_invalide" }), "application/json"); }
        }
        const r = await gererRequete(ctx, {
          methode: rq.method ?? "GET", chemin: url.pathname, requete: Object.fromEntries(url.searchParams), corps,
          entetes: { authorization: rq.headers.authorization }, ip: ipClient(rq, options.trustProxy === true),
        });
        return envoyer(r.statut, r.texte ?? JSON.stringify(r.corps ?? {}), r.typeContenu ?? "application/json", { "Cache-Control": "no-store", ...(r.entetes ?? {}) });
      }
      // Fichiers statiques de l'interface (protection contre la traversée de répertoire)
      const demande = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
      // Un octet nul (%00) fait échouer readFile : c'est une requête hostile ou mal formée, pas une erreur du serveur.
      if (demande.includes("\0")) return envoyer(404, "Introuvable", "text/plain; charset=utf-8");
      const chemin = normalize(join(racine, demande));
      if (chemin !== racine && !chemin.startsWith(racine + sep)) return envoyer(404, "Introuvable", "text/plain; charset=utf-8");
      const ext = extname(chemin);
      const type = TYPES[ext] ?? "application/octet-stream";
      const asset = await lireAsset(chemin, type);
      // ETag calculé une seule fois par version du fichier, puis réutilisé depuis le cache LRU borné.
      // HTML/JS/CSS sont toujours revalidés ; les médias ont un cache court avec validation possible.
      const revalidation = [".html", ".js", ".css", ".webmanifest", ".json"].includes(ext)
        ? { "Cache-Control": "no-cache", ETag: asset.etag }
        : { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400", ETag: asset.etag };
      const inm = rq.headers["if-none-match"];
      if (typeof inm === "string" && inm.split(",").some((v) => { const t = v.trim(); return t === asset.etag || t === `W/${asset.etag}` || t === "*"; })) {
        return envoyer(304, "", type, revalidation);
      }
      return envoyer(200, asset.contenu, type, { ...revalidation, "Content-Length": String(asset.contenu.length) });
    } catch (e) {
      // Fichier absent, dossier demandé comme fichier ou URL mal encodée : simple 404, sans bruit. Toute autre erreur est journalisée.
      const code = typeof e === "object" && e !== null && "code" in e ? String((e as { code?: unknown }).code) : "";
      const attendue = e instanceof URIError || code === "ENOENT" || code === "EISDIR" || code === "ENOTDIR" || code === "ENAMETOOLONG";
      if (!attendue) {
        const reference = journaliserErreurServeur({ methode: rq.method ?? "GET", chemin: url.pathname, ip: ipClient(rq, options.trustProxy === true) }, e);
        if (url.pathname.startsWith("/api/") && !rs.headersSent) return envoyer(500, JSON.stringify({ erreur: "erreur_interne", message: "Erreur interne.", reference }), "application/json", { "Cache-Control": "no-store" });
      }
      if (rs.headersSent) { rs.end(); return; }
      return envoyer(404, "Introuvable", "text/plain; charset=utf-8");
    }
  });
  // Délais explicites contre les connexions lentes (type « slowloris ») : les requêtes de l'application sont toutes petites (32 Ko, 128 Ko avec photo).
  serveur.headersTimeout = 15_000;
  serveur.requestTimeout = 30_000;
  serveur.keepAliveTimeout = 5_000;
  serveur.maxHeadersCount = 50;
  return serveur;
}
