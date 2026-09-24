import { inject, Injectable, InjectionToken } from '@angular/core';
import { configurationValue, ConnectedServiceBase } from '@connected-ng/core';
import { NotificationPreference } from './dtos/notification-preference';
import { UpdateNotificationPreferenceDto } from './dtos/update-notification-preference-dto';

export const NOTIFICATION_PREFERENCE_SERVICE_CONFIG = new InjectionToken<NotificationPreferenceServiceConfiguration>('NOTIFICATION_PREFERENCE_SERVICE_CONFIG');

export class NotificationPreferenceServiceConfiguration {
  baseUrl = configurationValue.required<string>('Notification preference service base URL');
}

@Injectable({
  providedIn: 'root',
})
export class NotificationPreferenceService extends ConnectedServiceBase {
  private configuration = inject(NOTIFICATION_PREFERENCE_SERVICE_CONFIG);

  override serviceUrl = 'services/notifications/push/preferences';

  override getBaseUrl(): string {
    return this.configuration.baseUrl();
  }

  // turns push notifications on or off for the signed-in user
  readonly update = this.createPutOperation<UpdateNotificationPreferenceDto, void>('update');

  // the signed-in user's preference. Null when they never set one, which counts as off
  readonly select = this.createGetOperation<undefined, NotificationPreference | null>('select');
}
