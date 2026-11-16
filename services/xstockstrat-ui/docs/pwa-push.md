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
- **Enable/disable control** at `/accounts/notifications` (Settings group — registered in **both**
  `PLATFORM_SUBNAV.accounts` and `NAV_GROUPS`). `PushToggle` requests permission, subscribes via the
  Push API with the VAPID **public** key, and calls `notifyClient.registerPushSubscription` /
  `unregisterPushSubscription`. Its four states (unsupported/blocked/enabled/default) route through
  `EmptyState`/`CardNotice`/`Switch` (C-17).
- **Alert inbox** (feature 203): the same page renders `AlertInbox` (`notifyClient.listAlerts`/`markAlertRead` via the
  `/trader/api` BFF `forward()`). The `/trader` bell badge (`AlertStream`) shows the server `unreadCount` fetched once on
  mount — it does not refresh after mark-read or on a streamed alert — and "Mark all read" covers only the loaded page (50).
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
