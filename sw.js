'use strict';
/*
 * sw.js – Service Worker: sorgt dafür, dass die App offline funktioniert.
 *
 * Strategie "Stale-while-revalidate":
 *   1. Datei sofort aus dem Speicher (Cache) liefern → App startet blitzschnell, auch offline.
 *   2. Falls Internet da ist, im Hintergrund die neueste Version holen und den Cache aktualisieren.
 *      → Änderungen an der App sind spätestens beim übernächsten Öffnen sichtbar.
 *
 * Tipp: Wenn du etwas Grundlegendes änderst (z. B. Dateien hinzufügst oder umbenennst),
 * erhöhe die Versionsnummer unten (v1 → v2). Dann wird der alte Cache komplett ersetzt.
 */
const CACHE = 'schuldenbuch-v4';

// Alle Dateien, die die App zum Laufen braucht
const FILES = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/money.js',
  './js/db.js',
  './js/charts.js',
  './js/app.js',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// Installation: alle Dateien in den Cache legen.
// cache: 'reload' = wirklich frisch vom Server holen, nicht aus dem Browser-Zwischenspeicher.
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) =>
    cache.addAll(FILES.map((url) => new Request(url, { cache: 'reload' })))
  ));
  self.skipWaiting();
});

// Aktivierung: alte Cache-Versionen löschen
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// Jede Anfrage der App läuft hier durch
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || !request.url.startsWith(self.location.origin)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // Seitenaufrufe (z. B. "./" oder "./index.html?x") immer mit index.html beantworten
    const cacheKey = request.mode === 'navigate' ? './index.html' : request;
    const cached = await cache.match(cacheKey, { ignoreSearch: true });

    // Im Hintergrund aktualisieren (klappt nur mit Internet – sonst egal)
    const update = fetch(request)
      .then((response) => {
        if (response.ok) cache.put(cacheKey, response.clone());
        return response;
      })
      .catch(() => null);

    if (cached) {
      event.waitUntil(update);
      return cached;
    }
    // Noch nicht im Cache → aus dem Netz laden
    const fresh = await update;
    return fresh || new Response('Offline und nicht im Speicher.', { status: 503, statusText: 'Offline' });
  })());
});
