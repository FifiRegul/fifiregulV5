/* =========================================================
   FIFI RÉGUL — service-worker.js (v5.0)
   Cache "app shell" pour un fonctionnement hors-ligne après le premier
   chargement. NB : les Service Workers exigent un contexte sécurisé
   (HTTPS ou localhost). Un simple hébergement OneDrive/Free/GitHub ouvert
   en double-clic (protocole file://) ne permet PAS l'enregistrement du
   Service Worker ni l'installation "PWA" complète — dans ce cas
   l'application fonctionne normalement en ligne, sans mode hors-ligne
   installable. GitHub Pages et Free Pages Perso (une fois basculé en
   HTTPS) permettent tous deux l'activation complète.
========================================================= */

const CACHE_NAME = 'fifi-regul-v5-1';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './css/lib/leaflet.css',
  './js/app.js',
  './js/search.js',
  './js/excel.js',
  './js/gps.js',
  './js/auth.js',
  './js/state.js',
  './js/lib/leaflet.js',
  './js/lib/xlsx.full.min.js',
  './data/svarrettbm.json',
  './data/menu-lists.json',
  './data/communes.json',
  './data/matricules.json',
  './data/app-state.json',
  './images/imagelogoTBM/logo.png',
  './images/imagefond/bus-bg.png',
  './images/FIFIRecherche.png',
  './images/FIFIResultat.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // Stratégie "network falling back to cache" pour data/*.json afin de
  // récupérer les mises à jour (base arrêts, matricules) dès que le réseau
  // est présent, tout en gardant un accès hors-ligne à la dernière version
  // connue.
  if (req.url.includes('/data/')) {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  if (req.url.includes('tile.openstreetmap.org')) return;

  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req))
  );
});
