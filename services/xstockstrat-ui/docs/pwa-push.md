# xstockstrat-ui — PWA & Push Notifications (feature 165)

The UI is an installable PWA that can receive OS-level Web Push notifications even when closed.

- **Served at the domain root** (no `basePath`): `manifest.webmanifest` comes from the dynamic route
  `src/app/manifest.webmanifest/route.ts` (`display: standalone`, `start_url: /trader`, 192/512 +
  maskable icons, `theme_color`/`background_color` = the build theme's background, feature 307); the
  three `icon-*.png` and a hand-written `sw.js` (no `next-pwa`) are in `public/`.
- **`sw.js`** handles `push` (always `showNotification` — the `userVisibleOnly` obligation — with a
  fallback on parse failure, and a deterministic `tag` for OS coalescing) and `notificationclick`
  (focus an existing window or open one). Its two decisions (parse-with-fallback, focus-vs-open) are
  the pure, unit-tested helpers in `src/lib/swHelpers.ts`, mirrored (inlined) into `sw.js` because a
  service worker can't import from the Next bundle.
- **`ServiceWorkerRegistrar`** (mounted in the root layout) registers `/sw.js` at root scope, covering
  all four segments.
- **Enable/disable control** at `/accounts/notifications` (Settings group — the rendered shell reads
  `NAV_GROUPS`, whose `Notifications` entry matches by prefix; `PLATFORM_SUBNAV.accounts` is the legacy
  list, kept in step but ignored by `PlatformHeader`). `PushToggle` requests permission, subscribes via the
  Push API with the VAPID **public** key, and calls `notifyClient.registerPushSubscription` /
  `unregisterPushSubscription`. Its four states (unsupported/blocked/enabled/default) route through
  `EmptyState`/`CardNotice`/`Switch` (C-17).
- **Alert inbox** (feature 203): the same page renders `AlertInbox` (`notifyClient.listAlerts`/`markAlertRead` via the
  `/trader/api` BFF `forward()`), its list a `useQuery` on `['alerts', 'list']`; "Mark all read" covers only the loaded page.
- **Bell** (feature 344): `components/shared/AlertStream.tsx` is mounted once in `PlatformHeaderInner`, so it is on every
  page of every segment. Its stored-unread list (`listAlerts({ unreadOnly: true, limit: 50 })`) is a `useQuery` on
  `ALERT_UNREAD_COUNT_KEY`; the badge is that list merged with streamed alerts (feature 339). Every mark-read path —
  alert page, inbox, drawer row and Clear all — calls `invalidateAlertReadModels` (`src/lib/alertShared.ts`), which
  cancels then invalidates the `['alerts']` prefix (a plain invalidate reuses an in-flight first fetch that predates the
  mark). The cache is per segment (each segment layout has its own `Providers`), so a segment switch refetches. The
  bell refetches on window focus and retries once (`queryClient.ts` defaults). Every open tab holds one `StreamAlerts`
  stream and runs the unread query — accepted.
- **Alert page** (feature 344): `/accounts/notifications/<alert_id>` (`[alert_id]/AlertDetail.tsx`) calls `GetAlert`
  through the `traderBff` `forward()`, and marks the server-returned id read only after a successful load (a failed
  mark-read is silent, `meta: { errorHandled: true }`). `Code.NotFound` renders "Alert not found"; any other error
  "Could not load alert". It is linked from the inbox row title, the drawer row title (`SheetClose asChild`, so the
  drawer closes) and the Web Push payload `url` that notify sets, which `notificationclick` opens.
- **BFF**: `traderBff` `registerPushSubscription`/`unregisterPushSubscription` are plain `forward()`s —
  the notify service resolves the subscription owner from the propagated `x-user-id` header
  (`backendHeaders`, applied by `forward`; the request body carries no `user_id`), matching the
  header-identity convention (#1040/#1041, C-03); unregister is by endpoint only. The `/accounts` page reuses the
  root-relative `notifyClient` (`/trader/api`) per the "Sanctioned exception" (four facts re-verified).
- **`VAPID_PUBLIC_KEY`** crosses server→client via `src/app/accounts/VapidKeyContext.tsx` (mirrors
  `AgentUrlContext`; the `/accounts` layout is already `force-dynamic`) — never `NEXT_PUBLIC_*`. The
  private key is notify-only.
- **iOS** requires adding the app to the Home Screen before Web Push works (standard behavior; not
  separately engineered).
