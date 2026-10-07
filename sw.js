// Service worker: guarda todos los archivos del juego para poder jugar sin
// conexión (y, en la app de Android, aunque el sistema cierre o congele el
// servidor interno).
// Estrategia "red primero con tiempo límite": si la red responde rápido se usa
// la versión nueva y se actualiza la caché; si falla o tarda, se sirve lo
// guardado (y si no hay nada guardado, se sigue esperando a la red).
const CACHE = 'f1ar-v3';
const FILES = [
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
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(FILES.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('f1ar-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// si el servidor no respondió hace poco, no hacer esperar a cada archivo
let slowUntil = 0;

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  // todas las navegaciones (/, /index.html, ...) comparten la misma entrada
  const key = req.mode === 'navigate' ? new Request(new URL('./index.html', self.registration.scope).href) : req;
  const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  const wait = local ? 1500 : 4000;

  const net = fetch(req).then((res) => {
    if (res.ok && res.type === 'basic') {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(key, copy)).catch(() => {});
    }
    return res;
  });
  e.waitUntil(net.catch(() => {}));
  const fromCache = () => caches.match(key, { ignoreSearch: true });

  e.respondWith(new Promise((resolve) => {
    let done = false;
    const finish = (r) => { if (!done && r) { done = true; resolve(r); } };
    const timer = setTimeout(() => { slowUntil = Date.now() + 20000; fromCache().then(finish); }, Date.now() < slowUntil ? 0 : wait);
    net.then((res) => { clearTimeout(timer); slowUntil = 0; finish(res); })
      .catch(() => {
        clearTimeout(timer);
        fromCache().then((hit) => finish(hit || Response.error()));
      });
  }));
});
