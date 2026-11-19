// Validation de l'adresse encodée dans les affiches QR permanentes (audit v31, F-01).
// Fonction pure, sans accès au DOM : testée par src/shared/origine-qr.test.ts.
//
// Niveaux retournés :
//  - "production" : https + nom de domaine public. Impression autorisée.
//  - "interne"    : https + adresse du réseau local (IP privée, *.local, nom sans point). Impression autorisée
//                   uniquement après une confirmation explicite (IP fixe, certificat racine installé sur chaque téléphone).
//  - "test"       : http, localhost/boucle locale, tunnel temporaire, IP non routable. L'impression de production est REFUSÉE ;
//                   seules des affiches filigranées « TEST — NE PAS AFFICHER » peuvent être produites.
//  - "invalide"   : URL inexploitable.

const TUNNELS = /(^|\.)(ngrok(-free)?\.(app|dev|io)|trycloudflare\.com|loca\.lt|localhost\.run|lhr\.life|serveo\.net|pinggy\.(io|link)|tunnelmole\.net|devtunnels\.ms|loophole\.site|telebit\.io)$/i;

function ipv4(h) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  return o.every((n) => n >= 0 && n <= 255) ? o : null;
}

/** Classe un nom d'hôte : "boucle" | "prive" | "public". Gère IPv4, IPv6 (crochets retirés) et noms. */
function classerHote(brut) {
  const h = brut.replace(/^\[|\]$/g, "").toLowerCase();
  const o = ipv4(h);
  if (o) {
    const [a, b] = o;
    if (a === 127 || a === 0) return "boucle";
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127)) return "prive";
    return "public";
  }
  if (h.includes(":")) { // IPv6
    if (h === "::1" || h === "::") return "boucle";
    const mappe = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(h);
    if (mappe) return classerHote(mappe[1]);
    // L'analyseur d'URL normalise ::ffff:a.b.c.d en ::ffff:xxxx:yyyy (hexadécimal).
    const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h);
    if (hex) { const x = parseInt(hex[1], 16), y = parseInt(hex[2], 16); return classerHote(`${x >> 8}.${x & 255}.${y >> 8}.${y & 255}`); }
    if (/^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h)) return "prive";
    return "public";
  }
  if (h === "localhost" || h.endsWith(".localhost")) return "boucle";
  if (!h.includes(".") || /\.(local|lan|internal|intranet|home\.arpa|corp|home)$/.test(h)) return "prive";
  return "public";
}

/**
 * @param {string} valeur adresse saisie par l'administrateur
 * @returns {{niveau:"production"|"interne"|"test"|"invalide", base:string, raisons:string[]}}
 */
export function evaluerOrigineQr(valeur) {
  let url;
  try { url = new URL(String(valeur ?? "").trim()); } catch { return { niveau: "invalide", base: "", raisons: ["Adresse invalide : saisissez une URL complète (https://…)."] }; }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return { niveau: "invalide", base: "", raisons: ["Adresse invalide : seul http(s) sans identifiants est accepté."] };
  const base = url.origin;
  const raisons = [];
  const classe = classerHote(url.hostname);
  const tunnel = TUNNELS.test(url.hostname);
  if (url.protocol !== "https:") raisons.push("l’adresse n’est pas en HTTPS (la caméra et la géolocalisation des téléphones l’exigent)");
  if (classe === "boucle") raisons.push("l’adresse pointe vers l’ordinateur local (localhost / 127.x / ::1) : aucun téléphone ne pourra l’ouvrir");
  if (tunnel) raisons.push("l’adresse est un tunnel temporaire (ngrok, trycloudflare, etc.) qui changera");
  if (!tunnel && classe === "public" && ipv4(url.hostname)) raisons.push("l’adresse est une adresse IP publique brute : utilisez un nom de domaine fixe");
  if (raisons.length) return { niveau: "test", base, raisons };
  if (classe === "prive") return { niveau: "interne", base, raisons: ["adresse du réseau local : valable seulement pour les appareils connectés à ce réseau"] };
  return { niveau: "production", base, raisons: [] };
}
