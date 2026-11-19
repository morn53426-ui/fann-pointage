// Règles de mot de passe et mot de passe provisoire des agents.
// Module sans dépendance : utilisé par les routes HTTP, le dépôt PostgreSQL et le script de création de l'administrateur.

export type RoleMdp = "administrateur" | "responsable" | "brancardier";

export const MDP_MAX = 200;
/** Durée de validité d'un mot de passe provisoire (compte agent créé avec le téléphone, ou réinitialisation par l'administrateur). */
export const DUREE_MOT_DE_PASSE_PROVISOIRE_JOURS = 7;
/** Vrai si le mot de passe provisoire du compte a été posé il y a plus de 7 jours (sans effet si la date est inconnue ou si le mot de passe est définitif). */
export function provisoireExpire(u: { doitChangerMotDePasse?: boolean; provisoireDepuis?: Date | null }, now: Date): boolean {
  if (!u.doitChangerMotDePasse || !u.provisoireDepuis) return false;
  return now.getTime() - u.provisoireDepuis.getTime() > DUREE_MOT_DE_PASSE_PROVISOIRE_JOURS * 86_400_000;
}
/** Administrateur : 9 caractères au minimum (un code de 9 chiffres reste accepté ; un mot de passe plus long ou généré aussi). */
export const MDP_MIN_ADMIN = 9;
/** Réinitialisation par l'administrateur pour un responsable ou un agent : mot de passe provisoire, remplacé à la première connexion. */
export const MDP_MIN_PROVISOIRE = 6;
/** Mot de passe choisi par l'utilisateur lui-même (changement obligatoire ou volontaire) : 8 caractères au minimum pour les non-administrateurs. */
export const MDP_MIN_PERSONNEL = 8;

const COURANTS = new Set(["password", "motdepasse", "azertyuio", "azertyuiop", "qwertyuio", "qwertyuiop", "administrateur", "administrator", "fannpointage", "chnufann", "chnuf2026", "bienvenue", "bienvenue1", "123456789", "1234567890", "0123456789", "password1", "passw0rd1", "admin1234", "admin12345"]);

function trivial(mdp: string): boolean {
  if (/^(.)\1+$/u.test(mdp)) return true; // 000000000, aaaaaaaa…
  if (new Set(mdp).size < 4) return true; // 000000001, 121212121… : moins de 4 caractères différents
  if (COURANTS.has(mdp.toLowerCase())) return true;
  const chiffres = /^[0-9]+$/.test(mdp);
  if (chiffres) {
    const montante = "01234567890123456789", descendante = "98765432109876543210";
    if (montante.includes(mdp) || descendante.includes(mdp)) return true; // 123456789, 987654321…
  }
  return false;
}

/**
 * Retourne un message d'erreur en français, ou null si le mot de passe est accepté.
 * `usage` distingue un mot de passe posé par l'administrateur (provisoire) d'un mot de passe choisi par la personne.
 */
export function controlerMotDePasse(role: RoleMdp, mdp: unknown, usage: "provisoire" | "personnel" = "provisoire"): string | null {
  if (typeof mdp !== "string") return "Le mot de passe doit être du texte.";
  if (mdp.length > MDP_MAX) return `Le mot de passe est limité à ${MDP_MAX} caractères.`;
  if (/[\r\n\u0000]/.test(mdp)) return "Le mot de passe ne peut pas contenir de retour à la ligne.";
  const min = role === "administrateur" ? MDP_MIN_ADMIN : usage === "personnel" ? MDP_MIN_PERSONNEL : MDP_MIN_PROVISOIRE;
  if (mdp.length < min) {
    return role === "administrateur"
      ? `Le mot de passe d’un administrateur doit contenir au moins ${MDP_MIN_ADMIN} caractères (par exemple 9 chiffres ou plus).`
      : `Le mot de passe doit contenir au moins ${min} caractères.`;
  }
  if (role === "administrateur" || usage === "personnel") {
    if (trivial(mdp)) return "Mot de passe trop prévisible (caractères répétés, suite de chiffres ou mot de passe courant). Choisissez-en un autre.";
  }
  return null;
}

/**
 * Normalise un numéro de téléphone saisi librement (« +221 77 123 45 67 », « 77-123-45-67 », « 00221771234567 »)
 * en chiffres seuls, sans indicatif Sénégal (221). Retourne null si moins de 6 chiffres restent.
 */
export function motDePasseDepuisTelephone(tel: unknown): string | null {
  if (typeof tel !== "string") return null;
  let chiffres = tel.replace(/\D/g, "");
  if (chiffres.startsWith("00221") && chiffres.length >= 5 + 6) chiffres = chiffres.slice(5);
  else if (chiffres.startsWith("221") && chiffres.length === 12) chiffres = chiffres.slice(3);
  return chiffres.length >= 6 && chiffres.length <= 30 ? chiffres : null;
}

/** Alphabet du code provisoire aléatoire : sans 0/O, 1/I/L, pour être lu et recopié sans erreur. */
export const ALPHABET_CODE_PROVISOIRE = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const LONGUEUR_CODE_PROVISOIRE = 8;
/** Normalise une saisie de code provisoire (« abcd-ef23 » → « ABCDEF23 ») ; null si ce n'est pas un code valide. */
export function normaliserCodeProvisoire(saisie: unknown): string | null {
  if (typeof saisie !== "string") return null;
  const c = saisie.toUpperCase().replace(/[\s-]/g, "");
  return c.length === LONGUEUR_CODE_PROVISOIRE && [...c].every((ch) => ALPHABET_CODE_PROVISOIRE.includes(ch)) ? c : null;
}
/** Affichage « ABCD-EF23 » pour la remise à l'agent. */
export const afficherCodeProvisoire = (code: string): string => `${code.slice(0, 4)}-${code.slice(4)}`;

/** Tentative de connexion d'un compte au mot de passe provisoire : le téléphone peut être saisi avec espaces, +221, tirets… */
export function variantesMotDePasseProvisoire(saisie: string): string[] {
  const v = [saisie];
  const n = motDePasseDepuisTelephone(saisie);
  if (n !== null && n !== saisie) v.push(n);
  const code = normaliserCodeProvisoire(saisie); // code aléatoire saisi avec ou sans tiret, en minuscules…
  if (code !== null && code !== saisie) v.push(code);
  return v;
}
