import { inject, Injectable, InjectionToken } from '@angular/core';
import { configurationValue, ConnectedServiceBase } from '@connected-ng/core';
import { SendPushMessageToSelfDto } from './dtos/send-push-message-to-self-dto';

export const PUSH_MESSAGE_SERVICE_CONFIG = new InjectionToken<PushMessageServiceConfiguration>('PUSH_MESSAGE_SERVICE_CONFIG');

export class PushMessageServiceConfiguration {
  baseUrl = configurationValue.required<string>('Push message service base URL');
}

@Injectable({
  providedIn: 'root',
})
export class PushMessageService extends ConnectedServiceBase {
  private configuration = inject(PUSH_MESSAGE_SERVICE_CONFIG);

  override serviceUrl = 'services/notifications/push/messages';

  override getBaseUrl(): string {
    return this.configuration.baseUrl();
  }

  // sends a push notification to the signed-in user's own devices, for trying delivery end to end
  readonly sendToSelf = this.createPostOperation<SendPushMessageToSelfDto, void>('sendToSelf');
}
