import { inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { SubscriptionService } from './subscription-service';

export type PushPermission = NotificationPermission | 'unsupported';

// One consuming app's push copy, by the key a push payload names. The worker has no localization of
// its own - it shows whatever it is given - so this is already resolved to the reader's language
// before it reaches here.
export type PushMessageMap = Record<string, { title: string; body: string }>;

// Resolved against the document base URL, so the worker's scope is the application root.
const SERVICE_WORKER_URL = 'push-service-worker.js';

@Injectable({
  providedIn: 'root',
})
export class PushNotificationService {
  private readonly subscriptions = inject(SubscriptionService);
  private readonly _permission = signal<PushPermission>(this.readPermission());

  readonly permission = this._permission.asReadonly();

  // Must be called from a user gesture (click or tap).
  // Resolves to false when the browser cannot receive push or the user did not grant permission.
  async subscribe(): Promise<boolean> {
    if (!this.isSupported())
      return false;

    const permission = await Notification.requestPermission();

    this._permission.set(permission);

    if (permission !== 'granted')
      return false;

    await navigator.serviceWorker.register(SERVICE_WORKER_URL);

    const registration = await navigator.serviceWorker.ready;
    const publicKey = decodeBase64Url(await firstValueFrom(this.subscriptions.selectPublicKey()));

    let subscription = await registration.pushManager.getSubscription();

    // the push service refuses a subscription made with a different key than the server signs with
    if (subscription && !isSameKey(subscription.options.applicationServerKey, publicKey)) {
      await this.forget(subscription);

      subscription = null;
    }

    subscription ??= await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: publicKey,
    });

    const keys = subscription.toJSON().keys;

    if (!keys?.['p256dh'] || !keys?.['auth'])
      throw new Error('The browser returned a push subscription without encryption keys.');

    // removed first so calling this again never leaves a duplicate behind
    await firstValueFrom(this.subscriptions.delete({ endpoint: subscription.endpoint }));
    await firstValueFrom(this.subscriptions.insert({
      endpoint: subscription.endpoint,
      p256dh: keys['p256dh'],
      auth: keys['auth'],
    }));

    return true;
  }

  // Sends the caller's locale-resolved push copy to the worker so a later push, which carries only a
  // key, can be shown in this instance's language. Safe to call on every app load regardless of
  // subscription state: the worker only reads the map once a push arrives, and re-sending the same
  // content on each load is how a later deployment's changed wording reaches an already-subscribed
  // device, which never re-runs subscribe().
  //
  // locale travels the same way, for the same reason: this app is deployed as one separate build per
  // locale, served under a /{locale} path segment, and a backend sending a bare path like "/clarity"
  // has no locale of its own to put in front of it - a broadcast reaches devices in every locale at
  // once. Only the device that is about to open the link knows which one it's currently running.
  async syncMessages(messages: PushMessageMap, locale: string): Promise<void> {
    if (!this.isSupported())
      return;

    await navigator.serviceWorker.register(SERVICE_WORKER_URL);

    const registration = await navigator.serviceWorker.ready;

    registration.active?.postMessage({ type: 'push-messages', messages, locale });
  }

  async unsubscribe(): Promise<void> {
    if (!this.isSupported())
      return;

    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();

    if (subscription)
      await this.forget(subscription);
  }

  private async forget(subscription: PushSubscription): Promise<void> {
    await firstValueFrom(this.subscriptions.delete({ endpoint: subscription.endpoint }));
    await subscription.unsubscribe();
  }

  private isSupported(): boolean {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }

  private readPermission(): PushPermission {
    return this.isSupported() ? Notification.permission : 'unsupported';
  }
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
