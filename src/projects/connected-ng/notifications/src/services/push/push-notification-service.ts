import { inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { NotificationPreferenceService } from './notification-preference-service';
import { SubscriptionService } from './subscription-service';

export type PushPermission = NotificationPermission | 'unsupported';

// What this device can tell about push notifications, for the person reading it:
// - unsupported: this browser cannot receive push at all (an iPhone Safari tab, in-app browsers)
// - not-asked: the one-time browser question is still waiting for the person's next tap
// - not-allowed: the browser says no, or the one question was ignored or dismissed, which counts as no.
//   Only the browser's own site settings can change it from here
// - checking: allowed, and the device is being registered
// - on: allowed, subscribed in this browser and registered with the server
// - failed: allowed, but registering did not work. Retried on every app load and when back online
export type PushStatus = 'unsupported' | 'not-asked' | 'not-allowed' | 'checking' | 'on' | 'failed';

// What the app tells the worker about itself. Without an icon, Chrome on Android draws the site's first
// letter instead. A badge must be a monochrome image on a transparent background, because Android shows
// only its silhouette. The locales are every locale the app is built for: the worker only treats a first
// path segment as a locale when it is in this list, so a window on /app is never mistaken for one.
export interface PushWorkerSettings {
  icon?: string;
  badge?: string;
  locales?: readonly string[];
}

// Resolved against the document base URL, so the worker's scope is the application root.
const SERVICE_WORKER_URL = 'push-service-worker.js';
const SERVICE_WORKER_FILE = '/push-service-worker.js';

// Per device, not per user: the browser's permission belongs to the device, so a second person
// signing in on the same browser is not asked again.
const ASKED_KEY = 'connected-ng-notifications:asked';

const LOCK_NAME = 'connected-ng-notifications';

const DETACH_TIMEOUT_MS = 2000;

// How long a registration the server confirmed is trusted. Registering is an upsert that changes nothing
// when nothing changed, so repeating it now and then brings back a row removed on the server (a database
// restore, another person taking the device over and giving it back) without waiting for a reload.
const CONFIRMATION_TTL_MS = 10 * 60 * 1000;

@Injectable({
  providedIn: 'root',
})
export class PushNotificationService {
  private readonly subscriptions = inject(SubscriptionService);
  private readonly preferences = inject(NotificationPreferenceService);

  private readonly _permission = signal<PushPermission>(this.readPermission());
  private readonly _status = signal<PushStatus>(this.initialStatus());

  readonly permission = this._permission.asReadonly();
  readonly status = this._status.asReadonly();

  // Whether someone is signed in on this device. Nothing is asked or registered while false.
  private active = false;

  private running: Promise<void> | null = null;
  private rerun = false;

  private registration: Promise<ServiceWorkerRegistration> | null = null;
  private publicKey: Uint8Array<ArrayBuffer> | null = null;

  // The endpoint the server confirmed, and when. Saves a round trip on every focus, but only for a while.
  private confirmed: { endpoint: string; at: number } | null = null;

  private cancelPendingAsk: (() => void) | null = null;

  // True while the browser's question is on screen, when the permission still reads 'default'.
  private asking = false;

  // The message type keeps its old name so a worker installed before this change still understands it.
  private lastSync: { type: 'push-messages'; locale: string; locales?: readonly string[]; icon?: string; badge?: string } | null = null;

  constructor() {
    if (this.isSupported())
      this.listen();
  }

  // Call whenever someone is signed in: from the sign-in success handler, and when the app opens with a
  // session already stored. Asks the browser's one-time question when it has never been asked on this
  // device, then registers the device. Safe to call repeatedly.
  async start(): Promise<void> {
    this.active = true;

    if (!this.isSupported()) {
      this._status.set('unsupported');
      return;
    }

    this.askOnce();

    await this.reconcile();
  }

  // Call before signing out, while the session token is still valid: the server forgets this device and
  // the browser drops its subscription, so the next person on this device does not get the previous
  // person's notifications. Never takes longer than two seconds, so signing out cannot hang.
  async detach(): Promise<void> {
    this.suspend();

    if (!this.isSupported())
      return;

    // Under the lock, so a check still running in this or another tab cannot subscribe again behind it.
    await withTimeout(this.withLock(() => this.forgetAll()), DETACH_TIMEOUT_MS);
  }

  suspend(): void {
    this.active = false;
    this.confirmed = null;
    this.cancelPendingAsk?.();
  }

  // Tells the worker which interface language this build runs in and which images to show
  async syncWorker(locale: string, settings: PushWorkerSettings = {}): Promise<void> {
    if (!this.isSupported())
      return;

    this.lastSync = { type: 'push-messages', locale, locales: settings.locales, icon: settings.icon, badge: settings.badge };

    await this.post(await this.registerWorker());
  }

  // Brings this device in line with the browser's permission
  reconcile(): Promise<void> {
    if (this.running) {
      this.rerun = true;
      return this.running;
    }

    this.running = this.withLock(() => this.check()).finally(() => {
      this.running = null;

      if (this.rerun) {
        this.rerun = false;
        void this.reconcile();
      }
    });

    return this.running;
  }

  private async check(): Promise<void> {
    if (!this.active)
      return;

    if (!this.isSupported()) {
      this._status.set('unsupported');
      return;
    }

    const permission = Notification.permission;

    this._permission.set(permission);

    if (permission === 'default' && this.asking) {
      this._status.set('not-asked');
      return;
    }

    if (permission === 'denied' || (permission === 'default' && this.wasAsked())) {
      this._status.set('not-allowed');
      this.confirmed = null;

      await this.forgetAll();

      return;
    }

    if (permission === 'default') {
      this._status.set('not-asked');
      return;
    }

    if (!navigator.onLine) {
      if (this._status() !== 'on')
        this._status.set('failed');

      return;
    }

    if (this._status() !== 'on')
      this._status.set('checking');

    try {
      const registration = await this.registerWorker();
      const publicKey = await this.selectPublicKey();

      let subscription = await this.existingSubscription(registration, publicKey);

      subscription ??= await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: publicKey,
      });

      // Signed out while this was running: registering now would hand the device back to that session.
      if (!this.active)
        return;

      if (!this.isConfirmed(subscription)) {
        await this.register(subscription);
        await this.ensurePreference();

        this.confirmed = { endpoint: subscription.endpoint, at: Date.now() };
      }

      this._status.set('on');
    } catch (error) {
      console.error('Push notifications could not be set up on this device', error);

      this.confirmed = null;
      this._status.set('failed');
    }
  }

  private isConfirmed(subscription: PushSubscription): boolean {
    return this.confirmed?.endpoint === subscription.endpoint && Date.now() - this.confirmed.at < CONFIRMATION_TTL_MS;
  }

  // The browser's own question, at most once per device
  private askOnce(): void {
    if (Notification.permission !== 'default' || this.wasAsked() || this.cancelPendingAsk)
      return;

    if (navigator.userActivation?.isActive) {
      void this.ask();
      return;
    }

    const onGesture = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== 'Enter' && event.key !== ' ')
        return;

      this.cancelPendingAsk?.();
      void this.ask();
    };

    window.addEventListener('click', onGesture, true);
    window.addEventListener('keydown', onGesture, true);

    this.cancelPendingAsk = () => {
      window.removeEventListener('click', onGesture, true);
      window.removeEventListener('keydown', onGesture, true);
      this.cancelPendingAsk = null;
    };
  }

  private async ask(): Promise<void> {
    if (!this.active || Notification.permission !== 'default' || this.wasAsked())
      return;

    // Recorded before the question, so ignoring it, closing the tab mid-question or dismissing it all count
    // as having been asked.
    this.markAsked();

    this.asking = true;

    // Must stay the first await, so the browser still sees the tap.
    let permission: NotificationPermission;

    try {
      permission = await Notification.requestPermission();
    } catch {
      permission = Notification.permission;
    } finally {
      this.asking = false;
    }

    this._permission.set(permission);

    await this.reconcile();
  }

  // Registers with the server. Needs the server's upsert: a repeat changes nothing and a new person
  // signing in on this device takes it over. A failure is reported as it is, and retried by the next
  // check, instead of being answered with a delete that could leave the device unregistered.
  private async register(subscription: PushSubscription): Promise<void> {
    const keys = subscription.toJSON().keys;

    if (!keys?.['p256dh'] || !keys?.['auth'])
      throw new Error('The browser returned a push subscription without encryption keys.');

    await firstValueFrom(this.subscriptions.insert({ endpoint: subscription.endpoint, p256dh: keys['p256dh'], auth: keys['auth'] }));
  }

  private async ensurePreference(): Promise<void> {
    const preference = await firstValueFrom(this.preferences.select());

    if (!preference?.enabled)
      await firstValueFrom(this.preferences.update({ enabled: true }));
  }

  // Each locale build registers its own worker under its own path, and a push subscription belongs to the
  // registration it was made in. Reusing one from any of them, and dropping the rest, keeps one
  // subscription per browser, so switching language never delivers every notification twice.
  private async existingSubscription(current: ServiceWorkerRegistration, publicKey: Uint8Array): Promise<PushSubscription | null> {
    let kept: PushSubscription | null = null;

    for (const registration of await this.ownRegistrations(current)) {
      const subscription = await registration.pushManager.getSubscription();

      if (!subscription)
        continue;

      // The push service refuses a subscription made with a different key than the server signs with.
      if (kept || !isSameKey(subscription.options.applicationServerKey, publicKey)) {
        await this.forget(subscription);
        continue;
      }

      kept = subscription;
    }

    return kept;
  }

  private async forgetAll(): Promise<void> {
    const current = await navigator.serviceWorker.getRegistration();

    for (const registration of await this.ownRegistrations(current ?? null)) {
      const subscription = await registration.pushManager.getSubscription().catch(() => null);

      if (subscription)
        await this.forget(subscription);
    }
  }

  // Neither half may stop the other: a failed server call must not leave the browser subscribed, and the
  // other way round.
  private async forget(subscription: PushSubscription): Promise<void> {
    try {
      await firstValueFrom(this.subscriptions.delete({ endpoint: subscription.endpoint }));
    } catch (error) {
      console.warn('Removing the push subscription from the server failed', error);
    }

    try {
      await subscription.unsubscribe();
    } catch (error) {
      console.warn('Unsubscribing the browser from push failed', error);
    }
  }

  private async ownRegistrations(current: ServiceWorkerRegistration | null): Promise<ServiceWorkerRegistration[]> {
    const all = await navigator.serviceWorker.getRegistrations();
    const own = all.filter((registration) => isOwnWorker(registration) && registration.scope !== current?.scope);

    return current && isOwnWorker(current) ? [current, ...own] : own;
  }

  private registerWorker(): Promise<ServiceWorkerRegistration> {
    this.registration ??= navigator.serviceWorker
      .register(SERVICE_WORKER_URL, { updateViaCache: 'none' })
      .then(() => navigator.serviceWorker.ready)
      .catch((error) => {
        this.registration = null;
        throw error;
      });

    return this.registration;
  }

  private async selectPublicKey(): Promise<Uint8Array<ArrayBuffer>> {
    this.publicKey ??= decodeBase64Url(await firstValueFrom(this.subscriptions.selectPublicKey()));

    return this.publicKey;
  }

  private async post(registration: ServiceWorkerRegistration): Promise<void> {
    if (this.lastSync)
      (registration.active ?? navigator.serviceWorker.controller)?.postMessage(this.lastSync);
  }

  private listen(): void {
    navigator.permissions
      ?.query({ name: 'notifications' as PermissionName })
      .then((status) => status.addEventListener('change', () => this.refresh()))
      .catch(() => undefined);

    // Android people come back from the browser's or the phone's settings, and nothing else tells the page.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible')
        this.refresh();
    });

    window.addEventListener('online', () => this.refresh());

    navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
      if (event.data?.type === 'push-subscription-changed') {
        this.confirmed = null;
        this.refresh();
      }

      if (event.data?.type === 'push-worker-version')
        console.info(`Push service worker ${event.data.version}`);
    });

    // A newly installed worker starts with whatever the old one saved, so it gets the current copy again.
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      void navigator.serviceWorker.ready.then((registration) => this.post(registration));
    });

    navigator.serviceWorker.startMessages();
  }

  private refresh(): void {
    this._permission.set(this.readPermission());

    if (this.active)
      void this.reconcile();
  }

  private withLock(work: () => Promise<void>): Promise<void> {
    if (!navigator.locks)
      return work();

    // The DOM typings miss that request() resolves to the callback's awaited result.
    return navigator.locks.request(LOCK_NAME, work).then(() => undefined);
  }

  private wasAsked(): boolean {
    try {
      return localStorage.getItem(ASKED_KEY) !== null;
    } catch {
      return false;
    }
  }

  private markAsked(): void {
    try {
      localStorage.setItem(ASKED_KEY, new Date().toISOString());
    } catch {
      // Storage blocked: the browser's own answer is still the source of truth.
    }
  }

  private isSupported(): boolean {
    return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }

  private readPermission(): PushPermission {
    return this.isSupported() ? Notification.permission : 'unsupported';
  }

  private initialStatus(): PushStatus {
    if (!this.isSupported())
      return 'unsupported';

    if (Notification.permission === 'granted')
      return 'checking';

    if (Notification.permission === 'denied' || this.wasAsked())
      return 'not-allowed';

    return 'not-asked';
  }
}

function isOwnWorker(registration: ServiceWorkerRegistration): boolean {
  const worker = registration.active ?? registration.waiting ?? registration.installing;

  return !!worker && new URL(worker.scriptURL).pathname.endsWith(SERVICE_WORKER_FILE);
}

function withTimeout(work: Promise<unknown>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);

    work.catch(() => undefined).finally(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value + '='.repeat((4 - value.length % 4) % 4);
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(raw.length);

  for (let i = 0; i < raw.length; i++)
    bytes[i] = raw.charCodeAt(i);

  return bytes;
}

function isSameKey(current: ArrayBuffer | null, expected: Uint8Array): boolean {
  if (!current || current.byteLength !== expected.length)
    return false;

  return new Uint8Array(current).every((value, index) => value === expected[index]);
}
