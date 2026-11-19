// Service worker : met en cache uniquement l'enveloppe de l'application. L'API n'est JAMAIS mise en cache.
const CACHE = "fann-pointage-v47";
const FICHIERS = ["/", "/index.html", "/app.js", "/emargement.js", "/signal-station.js", "/compteurs.js", "/scan-pointage.js", "/badge-print-layout.js", "/origine-qr.js", "/badge-qr.js", "/qr-camera.js", "/imprimer.html", "/imprimer.js", "/vendor/qrcode.js", "/vendor/jsQR.js", "/vendor/html2pdf.bundle.min.js", "/styles.css", "/pdf-capture.css", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/logo-chnuf.png", "/icons/logo-chnuf-filigrane.png", "/images/fann-pointage-publicite.jpg"];
self.addEventListener("install", (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FICHIERS))));
self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(
  ks.filter((k) => k.startsWith("fann-pointage-") && k !== CACHE).map((k) => caches.delete(k)),
))));
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  e.respondWith(fetch(e.request).then((r) => {
    // Ne pas mettre en cache les 404/erreurs ni les réponses d'autres origines.
    if (!r.ok || r.type !== "basic") return r;
    const copie = r.clone();
    return caches.open(CACHE).then((c) => c.put(e.request, copie)).then(() => r, () => r);
  }).catch(() => caches.match(e.request)));
});
// Un clic sur la notification de pointage ramène l'application au premier plan.
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((fenetres) => (fenetres.length ? fenetres[0].focus() : self.clients.openWindow("/"))));
});
