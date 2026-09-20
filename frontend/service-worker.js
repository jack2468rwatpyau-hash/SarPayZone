const CACHE_NAME = 'sarpayzone-v5';
const urlsToCache = ['/', '/styles.css', '/index.html', '/assets/logo.png'];

self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache).catch(() => {})).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim())
));

self.addEventListener('message', event => {
    if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;
    if (event.request.mode === 'navigate') {
        event.respondWith(fetch(event.request).then(response => {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
            return response;
        }).catch(() => caches.match(event.request).then(response => response || caches.match('/index.html'))));
        return;
    }
    event.respondWith(caches.match(event.request).then(response => response || fetch(event.request)));
});

self.addEventListener('push', event => {
    let data = {};
    try { data = event.data ? event.data.json() : {}; } catch (_) { data = { title: 'Sar Pay Zone', body: event.data?.text() || 'You have a new notification.' }; }
    const nested = data.data && typeof data.data === 'object' ? data.data : {};
    event.waitUntil(self.registration.showNotification(data.title || 'Sar Pay Zone', {
        body: data.body || '', tag: data.tag || 'sar-pay-zone', renotify: true,
        icon: '/assets/logo.png', badge: '/assets/logo.png',
        data: { url: data.url || nested.url || '/index.html' }
    }));
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    const target = new URL(event.notification.data?.url || '/index.html', self.location.origin).href;
    event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
        const existing = list.find(client => client.url.startsWith(self.location.origin));
        if (existing) return existing.focus().then(() => existing.navigate(target));
        return clients.openWindow(target);
    }));
});
