import { designSchema } from '@loadline/engine';
import { findLevel } from '@loadline/scenarios';
import { create } from 'zustand';
import { STARTER } from './design/model.ts';
import { SANDBOX_SLOT, levelSlot, useDesign } from './design/store.ts';
import { HOME, hrefOf, parseRoute } from './route.ts';
import type { Route } from './route.ts';
import { pause } from './sim/controller.ts';

// Follows the address bar. Arriving at a level or the sandbox opens its design, which is all the
// rest of the app needs to know: the design store carries the level whose rules apply.

export const useRoute = create<{ route: Route }>(() => ({ route: HOME }));

function arrive(requested: Route): void {
  const level = requested.page === 'level' ? findLevel(requested.id) : undefined;
  // A link to a level that does not exist lands on the list of the ones that do.
  const route = requested.page === 'level' && !level ? HOME : requested;

  if (route.page === 'sandbox') useDesign.getState().open(SANDBOX_SLOT, designSchema.parse(STARTER), null);
  else if (level) useDesign.getState().open(levelSlot(level.id), level.starter, level);
  // Nothing is on show at the list of levels, so nothing runs behind it.
  else pause();
  useRoute.setState({ route });
}

window.addEventListener('hashchange', () => {
  arrive(parseRoute(window.location.hash));
});
arrive(parseRoute(window.location.hash));

export function go(route: Route): void {
  window.location.hash = hrefOf(route);
}
