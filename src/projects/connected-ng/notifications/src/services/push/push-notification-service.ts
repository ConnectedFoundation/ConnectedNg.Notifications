import { inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { SubscriptionService } from './subscription-service';

export type PushPermission = NotificationPermission | 'unsupported';

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
