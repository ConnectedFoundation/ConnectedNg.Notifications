// Receives push notifications for @connected-ng/notifications.

const MESSAGES_CACHE = "connected-ng-notifications";
const MESSAGES_URL = "/push-messages";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// The app posts its current locale's { key: { title, body } } map on every load (see
// PushNotificationService.syncMessages), since this worker has no localization of its own and cannot
// compile $localize text itself.
self.addEventListener("message", (event) => {
  if (event.data?.type !== "push-messages") return;

  event.waitUntil(saveMessages(event.data.messages ?? {}));
});

self.addEventListener("push", (event) => {
  if (!event.data) return;

  const payload = event.data.json();

  event.waitUntil(showFromPayload(payload));
});

async function showFromPayload(payload) {
  const messages = payload.key ? await loadMessages() : {};
  const text = messages[payload.key];

  // Falls back to the payload's own text - the sender's English default - when no saved map has this
  // key, which is also what happens on a device that received a push before ever loading the app.
  // The tag makes a notification delivered twice replace the first one instead of stacking.
  return self.registration.showNotification(text?.title ?? payload.title, {
    body: text?.body ?? payload.body,
    tag: payload.tag,
    data: { url: payload.url },
  });
}

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

// A plain variable would not survive the worker being terminated between events, which happens
// routinely between an app load posting a map and a later push arriving. The Cache API persists
// across that the same as IndexedDB would, for one small JSON value with none of IndexedDB's
// transaction/object-store ceremony - a synthetic request/response pair is all this needs.
async function saveMessages(messages) {
  const cache = await caches.open(MESSAGES_CACHE);

  await cache.put(MESSAGES_URL, new Response(JSON.stringify(messages)));
}

async function loadMessages() {
  const cache = await caches.open(MESSAGES_CACHE);
  const response = await cache.match(MESSAGES_URL);

  // No map saved yet - the caller falls back to the payload's own text.
  return response ? await response.json() : {};
}
