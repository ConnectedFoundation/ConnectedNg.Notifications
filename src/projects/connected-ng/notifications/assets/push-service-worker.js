// Bumped with every change to this file. It is how a device can be checked for which worker is running
// (chrome://inspect, or the console line the app logs after syncing), and any change to the bytes is also
// what makes the browser install the new worker in the first place.
const VERSION = "2026-10-06.3";

const STATE_CACHE = "connected-ng-notifications";
const STATE_URL = "/push-messages";

const DEFAULT_LOCALE = "en-US";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// The app posts its interface locale, the list of locales it is built for and the notification images on
// every load. The list is what tells a locale segment from any other first path segment such as /app.
self.addEventListener("message", (event) => {
  if (event.data?.type !== "push-messages") return;

  event.source?.postMessage({ type: "push-worker-version", version: VERSION });

  event.waitUntil(
    saveState({
      locale: event.data.locale,
      locales: event.data.locales,
      icon: event.data.icon,
      badge: event.data.badge,
    }),
  );
});

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;

  try {
    payload = event.data.json();
  } catch {
    payload = { body: event.data.text() };
  }

  event.waitUntil(showFromPayload(payload));
});

async function showFromPayload(payload) {
  const state = await loadState();
  const title = payload.title ?? "";

  // The text is shown exactly as the sender wrote it. The tag makes a notification delivered twice replace
  // the first one instead of stacking.
  const options = {
    body: payload.body,
    tag: payload.tag,
    data: { url: payload.url },
  };

  const icon = payload.icon ?? state.icon;
  const badge = payload.badge ?? state.badge;

  // Without an icon Chrome on Android draws the site's first letter in the large icon slot.
  if (icon) options.icon = icon;
  if (badge) options.badge = badge;

  try {
    return await self.registration.showNotification(title, options);
  } catch (error) {
    // A broken image must not cost the notification itself: a push that shows nothing makes the browser
    // show its own generic "updated in the background" notice instead.
    console.error(
      "[push-service-worker] showNotification failed, retrying without images",
      error,
    );

    delete options.icon;
    delete options.badge;

    return self.registration.showNotification(title, options);
  }
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = event.notification.data?.url;

  if (!url) return;

  event.waitUntil(open(url));
});

// The browser replaced the subscription (expiry, key rotation, its own refresh). The new one is made here
// so the device keeps receiving, and any open window is told so it registers the new endpoint with the
// server. With no window open, the next app load does the same.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(resubscribe(event));
});

async function resubscribe(event) {
  const applicationServerKey =
    event.oldSubscription?.options?.applicationServerKey;

  if (applicationServerKey && !event.newSubscription) {
    try {
      await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
    } catch (error) {
      console.error("[push-service-worker] resubscribing failed", error);
    }
  }

  const windows = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });

  for (const client of windows)
    client.postMessage({ type: "push-subscription-changed" });
}

async function open(path) {
  const url = await linkFor(path);

  console.info(`[push-service-worker ${VERSION}] opening ${url}`);

  const windows = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });

  for (const client of windows) {
    if (!("focus" in client)) continue;

    try {
      const navigated =
        "navigate" in client ? await client.navigate(url) : null;

      return (navigated ?? client).focus();
    } catch {
      // This worker does not control that window (another locale's build), so it cannot steer it.
      // Opening a fresh one at the right place beats focusing a window on the wrong page.
      break;
    }
  }

  if (self.clients.openWindow) return self.clients.openWindow(url);
}

// Never returns a path without a locale in front of it: the app has nothing at a bare path.
async function linkFor(path) {
  if (/^https?:\/\//i.test(path)) return path;

  const state = await loadState();
  const locale = await resolveLocale(state);
  const clean = path.startsWith("/") ? path : `/${path}`;

  // A path that already starts with one of the app's locales is left alone.
  const full = isKnownLocale(state, firstSegment(clean))
    ? clean
    : `/${locale}${clean}`;

  return new URL(full, self.location.origin).href;
}

// A first path segment only counts as a locale when it is one the app said it is built for, so a window on
// /app or /api is never mistaken for one. Until the app has said (a device that has not loaded it since
// this was added), no segment of an open window or of the scope can be trusted.
function isKnownLocale(state, segment) {
  return !!segment && !!state.locales?.includes(segment);
}

// The locale of an open window, which is the one the person is using right now. Then the one the app last
// told this worker, then the one this worker's own scope belongs to, then the default.
async function resolveLocale(state) {
  const windows = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });

  for (const client of windows) {
    const segment = firstSegment(client.url);

    if (isKnownLocale(state, segment)) return segment;
  }

  // Written by the app itself from its own locale, so it is trusted unless the list now says it is gone.
  if (state.locale && (!state.locales || isKnownLocale(state, state.locale)))
    return state.locale;

  const scoped = firstSegment(self.registration.scope);

  return isKnownLocale(state, scoped) ? scoped : DEFAULT_LOCALE;
}

function firstSegment(url) {
  try {
    return new URL(url, self.location.origin).pathname.split("/")[1] ?? "";
  } catch {
    return "";
  }
}

// A plain variable would not survive the worker being terminated between events, which happens routinely
// between an app load posting this and a later push or click arriving. The Cache API persists across that,
// and it is shared by every worker on the origin, so each locale's build sees what the last one saved.
async function saveState(state) {
  const cache = await caches.open(STATE_CACHE);

  await cache.put(
    STATE_URL,
    new Response(
      JSON.stringify({
        ...state,
        locale: state.locale || DEFAULT_LOCALE,
        locales: validLocales(state.locales),
      }),
    ),
  );
}

function validLocales(value) {
  if (!Array.isArray(value)) return undefined;

  const locales = value.filter((item) => typeof item === "string" && item);

  return locales.length ? locales : undefined;
}

async function loadState() {
  const empty = { locale: DEFAULT_LOCALE };

  try {
    const cache = await caches.open(STATE_CACHE);
    const response = await cache.match(STATE_URL);

    // Nothing saved yet: a push arriving, or a notification opened, before any app load reached this device.
    if (!response) return empty;

    const stored = await response.json();

    if (!stored || typeof stored !== "object") return empty;

    // Anything else in there is from an older worker, which also kept a map of translated texts here. Only
    // these four are read, so an older entry, even a bare map with none of them, is harmless.
    return {
      locale: stored.locale || DEFAULT_LOCALE,
      locales: validLocales(stored.locales),
      icon: stored.icon,
      badge: stored.badge,
    };
  } catch (error) {
    console.error("[push-service-worker] reading saved state failed", error);

    return empty;
  }
}
