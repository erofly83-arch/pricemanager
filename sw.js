// ============================================================
//  Прайс-менеджер — Service Worker
//  Стратегия:
//    • Локальные файлы (shell) — Cache First + фоновое обновление
//    • CDN-библиотеки        — Cache First (стабильные версии)
//    • Google Fonts          — Cache First
//    • Всё остальное         — Network First
// ============================================================

const SHELL_CACHE  = 'price-manager-shell-v1';
const CDN_CACHE    = 'price-manager-cdn-v1';
const FONT_CACHE   = 'price-manager-fonts-v1';

// Файлы самого приложения
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json'
];

// Внешние CDN-библиотеки (фиксированные версии — можно кэшировать надолго)
const CDN_ASSETS = [
  'https://cdn.jsdelivr.net/npm/exceljs@4.3.0/dist/exceljs.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.5/FileSaver.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
];

// ── INSTALL: предзагружаем всё нужное ───────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    Promise.all([
      caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL_ASSETS)),
      caches.open(CDN_CACHE).then(cache =>
        Promise.allSettled(CDN_ASSETS.map(url => cache.add(url)))
      )
    ])
  );
  // Активируем новый SW сразу, не дожидаясь закрытия вкладок
  self.skipWaiting();
});

// ── ACTIVATE: удаляем старые кэши ───────────────────────────
self.addEventListener('activate', event => {
  const CURRENT = [SHELL_CACHE, CDN_CACHE, FONT_CACHE];
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => !CURRENT.includes(k)).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── FETCH: маршрутизация запросов ────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Пропускаем не-GET и chrome-extension
  if (request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;

  // CDN-библиотеки → Cache First
  if (CDN_ASSETS.some(u => request.url.startsWith(u.split('/').slice(0,3).join('/')) && isCdnUrl(request.url))) {
    event.respondWith(cacheFirst(request, CDN_CACHE));
    return;
  }

  // Google Fonts → Cache First
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(cacheFirst(request, FONT_CACHE));
    return;
  }

  // Локальные файлы приложения → Cache First + фоновое обновление (Stale-While-Revalidate)
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
    return;
  }

  // Всё остальное → Network First
  event.respondWith(networkFirst(request));
});

// ── Вспомогательные функции ──────────────────────────────────

function isCdnUrl(url) {
  return url.includes('cdn.jsdelivr.net') ||
         url.includes('cdnjs.cloudflare.com');
}

// Cache First: берём из кэша, если нет — идём в сеть и сохраняем
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Нет соединения и файл не в кэше', { status: 503 });
  }
}

// Stale-While-Revalidate: отдаём кэш сразу, параллельно обновляем в фоне
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);

  return cached || fetchPromise;
}

// Network First: пробуем сеть, при ошибке — кэш
async function networkFirst(request) {
  try {
    return await fetch(request);
  } catch {
    const cached = await caches.match(request);
    return cached || new Response('Нет соединения', { status: 503 });
  }
}
