import type { FanoutDispatcher } from './fanout';
import type { WebPushDispatcher } from './webPush';

/** Channel names only, comma-joined; never a webhook, key or VAPID value. */
export function describeDeliveryChannels(
  fanout: Pick<FanoutDispatcher, 'enabledChannels'>,
  webPush: Pick<WebPushDispatcher, 'isPushEnabled'>,
): { enabled: string; disabled: string } {
  const { slack, sendgrid } = fanout.enabledChannels();
  const channels: Array<[string, boolean]> = [
    ['slack', slack],
    ['sendgrid', sendgrid],
    ['push', webPush.isPushEnabled()],
  ];
  return {
    enabled: channels
      .filter(([, on]) => on)
      .map(([n]) => n)
      .join(','),
    disabled: channels
      .filter(([, on]) => !on)
      .map(([n]) => n)
      .join(','),
  };
}
