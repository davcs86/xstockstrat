import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { PushToggle } from './PushToggle';

// Settings-group page (feature 163): enable/disable OS push notifications for this device. The VAPID
// public key is provided by the accounts layout (server→client context), so this stays a server
// component and delegates the browser Push API work to the client PushToggle.
export default function NotificationsPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>Push notifications</CardTitle>
          <CardDescription>
            Install xstockstrat and enable notifications to receive alerts on this device even when
            the app is closed. Notifications are per-device — enable it on each device you want
            alerts on.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PushToggle />
        </CardContent>
      </Card>
    </div>
  );
}
