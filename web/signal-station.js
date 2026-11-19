// Retour sonore, vibration et notification système du poste partagé.
// Module sans dépendance : l'environnement du navigateur est injecté pour pouvoir être testé hors navigateur.
// Un signal n'est jamais bloquant : si le son, la vibration ou la notification échouent, le pointage n'est pas affecté.

const MOTIFS = {
  scan: [[880, 0.08]],
  ok: [[660, 0.12], [880, 0.2]],
  attention: [[520, 0.15], [520, 0.15]],
  ko: [[300, 0.4]],
};
const VIBRATIONS = { scan: [40], ok: [80], attention: [120, 80, 120], ko: [300] };
const CLE_SON = "fann-pointage-son-station";

export function creerSignalStation(env = globalThis) {
  let contexte = null;

  function sonActif() {
    try { return env.localStorage?.getItem(CLE_SON) !== "0"; } catch { return true; }
  }
  function definirSon(actif) {
    try { env.localStorage?.setItem(CLE_SON, actif ? "1" : "0"); } catch { /* stockage indisponible : le choix vaut pour cette page seulement */ }
  }

  // Les navigateurs n'autorisent le son qu'après un geste de l'utilisateur : à appeler depuis un clic ou une touche.
  function preparer() {
    if (!sonActif()) return;
    const AC = env.AudioContext || env.webkitAudioContext;
    if (!AC) return;
    try {
      contexte = contexte || new AC();
      if (contexte.state === "suspended") void contexte.resume();
    } catch { contexte = null; }
  }

  function jouer(niveau) {
    if (!MOTIFS[niveau]) return;
    if (sonActif() && contexte) {
      try {
        let t = contexte.currentTime;
        for (const [frequence, duree] of MOTIFS[niveau]) {
          const oscillateur = contexte.createOscillator();
          const gain = contexte.createGain();
          oscillateur.type = "sine";
          oscillateur.frequency.value = frequence;
          gain.gain.setValueAtTime(0.0001, t);
          gain.gain.exponentialRampToValueAtTime(0.3, t + 0.01);
          gain.gain.exponentialRampToValueAtTime(0.0001, t + duree);
          oscillateur.connect(gain);
          gain.connect(contexte.destination);
          oscillateur.start(t);
          oscillateur.stop(t + duree + 0.02);
          t += duree + 0.05;
        }
      } catch { /* son indisponible */ }
    }
    try { env.navigator?.vibrate?.(VIBRATIONS[niveau]); } catch { /* vibration indisponible */ }
  }

  function permission() { return env.Notification ? env.Notification.permission : "unsupported"; }
  async function demanderPermission() {
    if (!env.Notification) return "unsupported";
    try { return await env.Notification.requestPermission(); } catch { return env.Notification.permission; }
  }

  async function notifier(titre, corps) {
    if (permission() !== "granted") return false;
    // Page au premier plan : le signal sonore de la page suffit. Page en arrière-plan : le son système de la notification est conservé.
    const options = { body: corps, tag: "fann-pointage-station", renotify: true, icon: "/icons/icon-192.png", silent: !env.document?.hidden };
    try {
      const enregistrement = await env.navigator?.serviceWorker?.getRegistration?.();
      if (enregistrement?.showNotification) { await enregistrement.showNotification(titre, options); return true; }
      new env.Notification(titre, options);
      return true;
    } catch { return false; }
  }

  // Son + vibration + notification système pour le résultat d'un pointage.
  // Avec { arrierePlanSeulement: true } (téléphone de l'agent), la notification n'est envoyée que si la page est masquée :
  // au premier plan, le bip, la vibration et le résultat affiché à l'écran suffisent.
  function signaler(niveau, titre, corps, options = {}) {
    jouer(niveau);
    if (options.arrierePlanSeulement && !env.document?.hidden) return Promise.resolve(false);
    return notifier(titre, corps);
  }

  return { sonActif, definirSon, preparer, jouer, permission, demanderPermission, signaler };
}
