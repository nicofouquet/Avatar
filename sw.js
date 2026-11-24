// Service worker d'Avatar : réseau d'abord, cache en secours (l'appli s'ouvre hors ligne).
const CACHE = 'avatar-v3';
const FICHIERS = [
  './', 'index.html', 'app.js', 'cerveau.js', 'donnees.js',
  'manifest.webmanifest', 'icones/icone-192.png', 'icones/icone-512.png',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' : on contourne le cache HTTP pour ne pas précacher de vieux fichiers.
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(FICHIERS.map((f) => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((noms) => Promise.all(noms.filter((n) => n.startsWith('avatar-') && n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Jamais d'interception ni de cache pour Gemini (ni pour tout autre site).
  if (url.hostname === 'generativelanguage.googleapis.com' || url.origin !== self.location.origin) return;
  const reseau = fetch(req, { cache: 'no-cache' }).then((rep) => {
    if (rep.status === 200) { // pas de 206 (réponse partielle) dans le cache
      const copie = rep.clone();
      e.waitUntil(caches.open(CACHE).then((c) => c.put(req, copie)).catch(() => {}));
    }
    return rep;
  });
  // Réseau d'abord ; au bout de 4 s on sert le cache s'il a quelque chose, sinon on attend le réseau.
  const cache = () => caches.match(req, { ignoreSearch: true });
  const delai = new Promise((resolve) => setTimeout(() => resolve(cache().then((c) => c || reseau)), 4000));
  e.respondWith(Promise.race([reseau, delai]).catch(async () => (await cache()) || Response.error()));
});
