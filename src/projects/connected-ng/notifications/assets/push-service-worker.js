// Receives push notifications for @connected-ng/notifications.

const MESSAGES_CACHE = "connected-ng-notifications";
const MESSAGES_URL = "/push-messages";

const DEFAULT_LOCALE = "en-US";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// The app posts its current locale's { key: { title, body } } map, and the locale itself, on every
// load (see PushNotificationService.syncMessages). The map exists because this worker cannot compile
// $localize text of its own; the locale exists because this app is one separate build per locale
// served under a /{locale} path, and a bare path like the backend sends has no locale segment to its
// own name - only this device's last app load knows which one belongs in front of it.
self.addEventListener("message", (event) => {
  if (event.data?.type !== "push-messages") return;

  event.waitUntil(saveState(event.data.messages ?? {}, event.data.locale));
});

self.addEventListener("push", (event) => {
  if (!event.data) return;

  const payload = event.data.json();

  event.waitUntil(showFromPayload(payload));
});

async function showFromPayload(payload) {
  const { messages } = await loadState();
  const text = payload.key ? messages[payload.key] : undefined;

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

  event.waitUntil(openLocalized(url));
});

async function openLocalized(path) {
  const { locale } = await loadState();

  return focusOrOpen(
    new URL(`/${locale}${path}`, self.registration.scope).href,
  );
}

async function focusOrOpen(url) {
  const windows = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });

  for (const client of windows) {
    if (!("focus" in client)) continue;

    if ("navigate" in client) {
      try {
        await client.navigate(url);
      } catch {
        // Cross-origin or unsupported in this browser - focusing the tab as-is still beats nothing.
      }
    }

    return client.focus();
  }

  if (self.clients.openWindow) return self.clients.openWindow(url);
}

// A plain variable would not survive the worker being terminated between events, which happens
// routinely between an app load posting this and a later push or click arriving. The Cache API
// persists across that the same as IndexedDB would, for one small JSON value with none of IndexedDB's
// transaction/object-store ceremony - a synthetic request/response pair is all this needs.
async function saveState(messages, locale) {
  const cache = await caches.open(MESSAGES_CACHE);

  await cache.put(
    MESSAGES_URL,
    new Response(
      JSON.stringify({ messages, locale: locale || DEFAULT_LOCALE }),
    ),
  );
}

async function loadState() {
  const cache = await caches.open(MESSAGES_CACHE);
  const response = await cache.match(MESSAGES_URL);

  // Nothing saved yet - a push arriving, or a notification opened, before any app load ever reached
  // this device. Falls back to the sender's own text and the default locale respectively.
  return response
    ? await response.json()
    : { messages: {}, locale: DEFAULT_LOCALE };
}
