// Receives push notifications for @connected-ng/notifications.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  if (!event.data) return;

  const payload = event.data.json();

  // the tag makes a notification delivered twice replace the first one instead of stacking
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      data: { url: payload.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = event.notification.data?.url;

  if (!url) return;

  event.waitUntil(focusOrOpen(new URL(url, self.registration.scope).href));
});

async function focusOrOpen(url) {
  const windows = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });

  for (const client of windows) {
    if (client.url === url && "focus" in client) return client.focus();
  }

  try {
    return await self.clients.openWindow(url);
  } catch (error) {
    console.error("[push-service-worker] openWindow failed", error);
    throw error;
  }
}
