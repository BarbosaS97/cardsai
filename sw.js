const CACHE_NAME = 'cardsquestoesai-v4';

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
  '/manifest.json',
  '/js/config.js',
  '/js/auth.js',
  '/static/css/styles.css',
  '/static/images/favicon.png',
  '/static/images/icons/icon-192.png',
  '/static/images/icons/icon-512.png',
];

// Domínios que nunca devem passar pelo cache (APIs externas e analytics)
const BYPASS_DOMAINS = [
  'supabase.co',
  'functions/v1',
  'cdn.jsdelivr.net',
  'cdnjs.cloudflare.com',
  'cdn.tailwindcss.com',
  'googletagmanager.com',
  'google-analytics.com',
  'analytics.google.com',
  'doubleclick.net',
  'googlesyndication.com',
];

// ── Install: pré-cacheia os assets principais ──────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(PRECACHE_URLS).catch(err => {
        console.warn('[SW] Precache parcial — alguns assets podem não estar disponíveis offline:', err);
      });
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

  // Ignora chamadas para APIs externas (Supabase, CDNs)
  const isBypass = BYPASS_DOMAINS.some(d => request.url.includes(d));
  if (isBypass) return;

  // Ignora chrome-extension e outros esquemas não-http
  if (!url.protocol.startsWith('http')) return;

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
