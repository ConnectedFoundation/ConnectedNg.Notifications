import { inject, Injectable, InjectionToken } from '@angular/core';
import { configurationValue, ConnectedServiceBase } from '@connected-ng/core';
import { DeleteSubscriptionDto } from './dtos/delete-subscription-dto';
import { InsertSubscriptionDto } from './dtos/insert-subscription-dto';

export const SUBSCRIPTION_SERVICE_CONFIG = new InjectionToken<SubscriptionServiceConfiguration>('SUBSCRIPTION_SERVICE_CONFIG');

export class SubscriptionServiceConfiguration {
  baseUrl = configurationValue.required<string>('Subscription service base URL');
}

@Injectable({
  providedIn: 'root',
})
export class SubscriptionService extends ConnectedServiceBase {
  private configuration = inject(SUBSCRIPTION_SERVICE_CONFIG);

  override serviceUrl = 'services/notifications/push/subscriptions';

  override getBaseUrl(): string {
    return this.configuration.baseUrl();
  }

  // registers this browser for the signed-in user. Resolves to the new subscription's id
  readonly insert = this.createPostOperation<InsertSubscriptionDto, number>('insert');

  // removes the signed-in user's subscription for a browser endpoint
  readonly delete = this.createDeleteOperation<DeleteSubscriptionDto, void>('delete');

  // the VAPID public key a browser subscription has to be created with
  readonly selectPublicKey = this.createGetOperation<undefined, string>('selectPublicKey');
}
