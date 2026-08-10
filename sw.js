// ============================================================
// Service Worker لتطبيق Misar Systems
// - يستقبل أحداث الدفع (push) ويعرض إشعارات النظام على الجهاز
// - يخزن الملفات الأساسية مؤقتاً ليعمل التطبيق بدون إنترنت جزئياً
// ============================================================

const CACHE_NAME = 'misar-cache-v1';
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './banners.css',
  './manifest.json',
  './js/supabase.js',
  './js/products.js',
  './js/product.js',
  './js/cart.js',
  './js/banners.js',
  './js/admin-dashboard.js'
];

// ========== تثبيت الـ Service Worker ==========
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL).catch((err) => {
        console.warn('تعذّر تخزين بعض الملفات مؤقتاً:', err);
      });
    })
  );
});

// ========== تنشيط الـ Service Worker ==========
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// ========== استراتيجية التخزين المؤقت (Network-first) ==========
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match('./index.html')))
  );
});

// ========== استقبال إشعارات الدفع (Push) ==========
// عند وصول إشعار Push من الخادم، يعرض إشعار نظام على الجهاز
self.addEventListener('push', (event) => {
  let data = { title: 'Misar Systems', body: 'لديك إشعار جديد', icon: 'https://i.ibb.co/XktM4crn/1767120438295.png', url: './index.html' };

  try {
    if (event.data) {
      const parsed = event.data.json();
      data = { ...data, ...parsed };
    }
  } catch (e) {
    if (event.data) data.body = event.data.text();
  }

  const notificationOptions = {
    body: data.body || 'لديك إشعار جديد من مسار سيستمز',
    icon: data.icon || 'https://i.ibb.co/XktM4crn/1767120438295.png',
    badge: data.icon || 'https://i.ibb.co/XktM4crn/1767120438295.png',
    data: { url: data.url || './index.html' },
    vibrate: [200, 100, 200],
    tag: data.tag || 'misar-notification'
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'Misar Systems', notificationOptions)
  );
});

// ========== عند النقر على الإشعار ==========
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url ? event.notification.data.url : './index.html';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // إذا كان هنالك نافذة مفتوحة، نركز عليها ونوجهها للرابط
      for (const client of windowClients) {
        if ('focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      // وإلا نفتح نافذة جديدة
      return clients.openWindow(url);
    })
  );
});

// ========== إدارة الاشتراكات في الضغط ==========
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      clients.forEach((client) => {
        client.postMessage({ type: 'PUSH_SUBSCRIPTION_CHANGED' });
      });
    })
  );
});
