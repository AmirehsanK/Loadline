import { designSchema } from '@loadline/engine';
import { findLevel } from '@loadline/scenarios';
import type { Scenario } from '@loadline/scenarios';
import { ShareError, decodeShare } from '@loadline/share';
import type { ShareErrorCode } from '@loadline/share';
import { create } from 'zustand';
import { STARTER } from './design/model.ts';
import { SANDBOX_SLOT, levelSlot, useDesign } from './design/store.ts';
import { HOME, hrefOf, parseRoute, sameRoute } from './route.ts';
import type { Route } from './route.ts';
import { pause } from './sim/controller.ts';

// Follows the address bar. Arriving at a level or the sandbox opens its design, which is all the
// rest of the app needs to know: the design store carries the level whose rules apply.

/** The key a design from a link is held under. Nothing is ever saved there. */
const SHARED_SLOT = 'loadline:shared';

/** How a design from a link is coming along: it has to be unpacked and checked before it is shown. */
export type Shared =
  | { status: 'opening' }
  /** Open. `level` is the level it is an answer to, if this build has that level. */
  | { status: 'open'; level: string | null }
  | { status: 'refused'; code: ShareErrorCode };

interface SessionState {
  route: Route;
  /** Set while the route is a shared design. */
  shared: Shared | null;
}

export const useRoute = create<SessionState>(() => ({ route: HOME, shared: null }));

async function openShared(route: Route & { page: 'shared' }): Promise<void> {
  let shared: Shared;
  try {
    const share = await decodeShare(route.payload);
    // The visitor may have moved on while it was being unpacked.
    if (!sameRoute(useRoute.getState().route, route)) return;
    // An answer to a level this build does not have is still a design to look at.
    const level = share.level === undefined ? undefined : findLevel(share.level);
    useDesign.getState().open(SHARED_SLOT, share.design, level ?? null, { seed: share.seed, workload: share.workload, transient: true });
    shared = { status: 'open', level: level?.id ?? null };
  } catch (error) {
    if (!sameRoute(useRoute.getState().route, route)) return;
    shared = { status: 'refused', code: error instanceof ShareError ? error.code : 'corrupt' };
  }
  useRoute.setState({ shared });
}

function arrive(requested: Route): void {
  const level = requested.page === 'level' ? findLevel(requested.id) : undefined;
  // A link to a level that does not exist lands on the list of the ones that do.
  const route = requested.page === 'level' && !level ? HOME : requested;

  if (route.page === 'sandbox') useDesign.getState().open(SANDBOX_SLOT, designSchema.parse(STARTER), null);
  else if (level) useDesign.getState().open(levelSlot(level.id), level.starter, level);
  // Nothing is on show at the list of levels, or until a shared design has been checked, so
  // nothing runs behind it.
  else pause();

  useRoute.setState({ route, shared: route.page === 'shared' ? { status: 'opening' } : null });
  if (route.page === 'shared') void openShared(route);
}

window.addEventListener('hashchange', () => {
  arrive(parseRoute(window.location.hash));
});
arrive(parseRoute(window.location.hash));

export function go(route: Route): void {
  window.location.hash = hrefOf(route);
}

/**
 * Opens a level with its reference design on the canvas, as "show a solution" would leave it. The
 * guide uses it, for a reader who wants to see the answer run.
 */
export function openWithAnswer(level: Scenario): void {
  // The level's own design is opened when the address changes. The answer goes on after that, as
  // an edit like any other, so undo brings back what was there.
  window.addEventListener(
    'hashchange',
    () => {
      useDesign.getState().replace(level.reference);
    },
    { once: true },
  );
  go({ page: 'level', id: level.id });
}

/**
 * Makes the shared design that is open the visitor's own: their design for the level it answers,
 * or their sandbox design. It replaces what they had there.
 */
export function keepShared(): void {
  const { shared } = useRoute.getState();
  if (shared?.status !== 'open') return;
  useDesign.getState().saveAs(shared.level === null ? SANDBOX_SLOT : levelSlot(shared.level));
  go(shared.level === null ? { page: 'sandbox' } : { page: 'level', id: shared.level });
}
