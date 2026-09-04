import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { PushToggle } from './PushToggle';

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
