const CACHE_NAME = 'sarpayzone-v4';
const urlsToCache = ['/', '/styles.css', '/index.html'];

self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', event => {
    if (event.request.mode === 'navigate') {
        event.respondWith(fetch(event.request).then(response => { const copy = response.clone(); caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)); return response; }).catch(() => caches.match(event.request)));
        return;
    }
    event.respondWith(caches.match(event.request).then(response => response || fetch(event.request)));
});

self.addEventListener('push', event => {
    let data = {};
    try { data = event.data ? event.data.json() : {}; } catch (_) { data = { title: 'Sar Pay Zone', body: event.data?.text() || 'You have a new notification.' }; }
    event.waitUntil(self.registration.showNotification(data.title || 'Sar Pay Zone', {
        body: data.body || '', tag: data.tag || 'sar-pay-zone', renotify: true,
        icon: '/assets/logo.png', badge: '/assets/logo.png',
        data: { url: data.url || data.data?.url || '/index.html' }
    }));
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    const target = new URL(event.notification.data?.url || '/index.html', self.location.origin).href;
    event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
        for (const client of list) {
            if ('focus' in client) { client.navigate(target); return client.focus(); }
        }
        return clients.openWindow(target);
    }));
});
