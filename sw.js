const CACHE_NAME = 'cardsquestoesai-v7';

const PRECACHE_URLS = [
  '/index.html',
  '/login.html',
  '/forgot-password.html',
  '/reset-password.html',
  '/register.html',
  '/dashboard.html',
  '/results.html',
  '/criacoes.html',
  '/pricing.html',
  '/upload.html',
  '/admin.html',
  '/unsubscribe.html',
  '/manifest.json',
  '/js/config.js',
  '/js/auth.js',
  '/js/credits.js',
  '/js/tutorial.js',
  '/static/css/styles.css',
  '/static/images/favicon.png',
  '/static/images/icons/icon-192.png',
  '/static/images/icons/icon-512.png',
];

// CDNs cacheados separadamente com CORS para funcionar offline
const CDN_PRECACHE = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
];

// Domínios de API que nunca devem ser cacheados (dados dinâmicos)
const BYPASS_DOMAINS = [
  'supabase.co',
  'functions/v1',
  'cdn.tailwindcss.com',
  'googletagmanager.com',
  'google-analytics.com',
  'analytics.google.com',
  'doubleclick.net',
  'googlesyndication.com',
  'woovi.com',
  'openpix.com.br',
];

// Assets de CDN cacheáveis (bibliotecas estáticas)
const CDN_CACHE_DOMAINS = [
  'cdn.jsdelivr.net',
  'cdnjs.cloudflare.com',
];

// ── Install: pré-cacheia assets locais + CDNs (com CORS) ───────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      // Assets locais
      await cache.addAll(PRECACHE_URLS).catch(err => {
        console.warn('[SW] Precache local parcial:', err);
      });
      // CDNs com modo CORS explícito para resposta cacheável
      await Promise.allSettled(
        CDN_PRECACHE.map(url =>
          fetch(new Request(url, { mode: 'cors', credentials: 'omit' }))
            .then(res => { if (res.ok) return cache.put(url, res); })
            .catch(() => {})
        )
      );
    })
  );
  self.skipWaiting();
});

// ── Activate: remove caches antigos ───────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch: estratégia por tipo de recurso ─────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;

  // Ignora métodos não-GET
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Ignora chrome-extension e outros esquemas não-http
  if (!url.protocol.startsWith('http')) return;

  // APIs dinâmicas: ignora completamente (rede direta)
  const isBypass = BYPASS_DOMAINS.some(d => request.url.includes(d));
  if (isBypass) return;

  // CDN de bibliotecas estáticas: serve do cache se disponível, sem re-cachear (opaque)
  const isCdn = CDN_CACHE_DOMAINS.some(d => request.url.includes(d));
  if (isCdn) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request); // sem cachear: resposta opaque
      })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      // Cache hit → retorna imediatamente, atualiza em background
      if (cached) {
        // Stale-while-revalidate: atualiza cache sem bloquear
        const fetchAndUpdate = fetch(request).then(networkRes => {
          if (networkRes.ok) {
            caches.open(CACHE_NAME).then(cache => cache.put(request, networkRes.clone()));
          }
          return networkRes;
        }).catch(() => cached);

        return cached; // retorna o cacheado agora; atualiza em background
      }

      // Cache miss → busca na rede e armazena
      return fetch(request).then(networkRes => {
        if (networkRes.ok && networkRes.type !== 'opaque') {
          const clone = networkRes.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        }
        return networkRes;
      }).catch(() => {
        // Offline e sem cache: retorna página de fallback se for navegação
        if (request.destination === 'document') {
          return caches.match('/index.html');
        }
      });
    })
  );
});
