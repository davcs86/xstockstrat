// Readiness/queue state cue maps (feature 155, FR-1). Split out of `opportunityShared.tsx` so the
// **value** import of `@phosphor-icons/react` (which evaluates `createContext` at module scope)
// stays out of the server bundle: `opportunityShared` is transitively imported by server code
// (`traderBff.ts` → `copilot.ts` → `opportunityShared`), and pulling a client-only icon lib into
// that graph breaks the production build ("createContext is not a function" while collecting page
// data for /trader/api/[...connect]). Only the client cue consumers import this module; the shared
// data maps + `EnumBadge` stay in `opportunityShared` (which now imports the phosphor *type* only).

import { Lightning, Eye, Moon, Question, Stack } from '@phosphor-icons/react';
import type { EnumRender } from './opportunityShared';
import type { ReadinessState } from './readinessRollup';

/**
 * The shared readiness-state cue map — keyed by the `readinessState()` discriminant so
 * firing/watching/quiet/no-data render an identical icon + color everywhere. `label` is a fallback;
 * the Watchlists panel overrides it with the dynamic "N away" text.
 */
export const READINESS_CUE: Record<ReadinessState, EnumRender> = {
  firing: { label: 'firing', role: 'buy', icon: Lightning },
  watching: { label: 'watching', role: 'paper', icon: Eye },
  quiet: { label: 'quiet', role: 'secondary', icon: Moon },
  nodata: { label: 'no data', role: 'secondary', icon: Question },
};

/** The shared "in queue" cue — info color + a queue-stack glyph. */
export const IN_QUEUE_CUE: EnumRender = { label: 'in queue', role: 'info', icon: Stack };
