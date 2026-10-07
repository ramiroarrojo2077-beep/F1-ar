// Service worker: guarda todos los archivos del juego para poder jugar sin
// conexión (y, en la app de Android, aunque el sistema cierre el servidor interno).
// Estrategia "red primero": si hay red se usa la versión nueva y se actualiza la
// caché; si no, se sirve lo guardado.
const CACHE = 'f1ar-v2';
const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './fonts/fonts.css',
  './fonts/titillium-web-400.woff2',
  './fonts/titillium-web-600.woff2',
  './fonts/titillium-web-700.woff2',
  './fonts/titillium-web-900.woff2',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './js/main.js',
  './js/track.js',
  './js/trackMesh.js',
  './js/scenery.js',
  './js/car.js',
  './js/geom.js',
  './js/race.js',
  './js/teams.js',
  './js/audio.js',
  './js/ar.js',
  './js/hud.js',
  './vendor/three/three.module.min.js',
  './vendor/three/addons/OrbitControls.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('f1ar-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('./index.html'))),
  );
});
