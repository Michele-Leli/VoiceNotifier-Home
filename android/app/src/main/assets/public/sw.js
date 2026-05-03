// Service Worker per la gestione delle notifiche push
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('push', function(event) {
  console.log('SW: Ricevuta push notification');
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
      console.log('SW: Dati push (JSON):', data);
    } catch (e) {
      data = { title: 'Notifica', message: event.data.text() };
      console.log('SW: Dati push (Text):', data);
    }
  } else {
    console.warn('SW: Push ricevuta senza dati');
  }

  const notificationData = {
    appName: data.app || data.appName || data.title || 'IFTTT',
    title: data.title || 'Nuovo Messaggio',
    message: data.message || '',
    timestamp: Date.now()
  };

  const options = {
    body: `${notificationData.appName}: ${notificationData.message}`,
    icon: '/vite.svg', // In produzione usare icona app
    badge: '/vite.svg',
    tag: 'voxhome-notif',
    renotify: true,
    data: notificationData,
    actions: [
      { action: 'stop', title: '🔴 Disattiva Voce' },
      { action: 'open', title: '📱 Apri App' }
    ]
  };

  console.log('SW: Mostro notifica e avviso client:', notificationData.appName);

  // 1. Show notification
  const promiseChain = self.registration.showNotification(notificationData.title, options);

  // 2. Notify clients via postMessage AND BroadcastChannel
  const bc = new BroadcastChannel('voxhome_notifications');

  event.waitUntil(
    promiseChain.then(() => {
      console.log('SW: Invio su BroadcastChannel');
      bc.postMessage({
        type: 'PUSH_NOTIFICATION',
        data: notificationData
      });
      bc.close();

      return self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    }).then(clients => {
      console.log(`SW: Notifico ${clients.length} client via postMessage`);
      clients.forEach(client => {
        client.postMessage({
          type: 'PUSH_NOTIFICATION',
          data: notificationData
        });
      });
    })
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  
  const bc = new BroadcastChannel('voxhome_notifications');

  if (event.action === 'stop') {
    // Comunica al client di disattivare la lettura
    bc.postMessage({ type: 'TOGGLE_READING', enabled: false });
    
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
        clients.forEach(client => {
          client.postMessage({ type: 'TOGGLE_READING', enabled: false });
        });
        bc.close();
      })
    );
  } else {
    // Azione 'open' o click generico sulla notifica
    event.waitUntil(
      self.clients.matchAll({ type: 'window' }).then((clientList) => {
        for (const client of clientList) {
          if (client.url === '/' && 'focus' in client) return client.focus();
        }
        if (self.clients.openWindow) return self.clients.openWindow('/');
      })
    );
    bc.close();
  }
});
