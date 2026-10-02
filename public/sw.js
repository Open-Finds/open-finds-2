self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = { title: "The Unsaved", body: "You have a new notification" };
  try {
    if (event.data) data = event.data.json();
  } catch {
    try { data = { title: "The Unsaved", body: event.data?.text() ?? "" }; } catch {}
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/favicon.png",
      badge: "/favicon.png",
      data: data.data ?? {},
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // The app routes on the hash (/#/plan/…); older notifications sent bare
  // paths (/plan/…), which would land on the home page.
  let url = event.notification.data?.url ?? "/";
  if (url.startsWith("/") && !url.startsWith("/#")) url = "/#" + url;
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
