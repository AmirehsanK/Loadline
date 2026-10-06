// Where the visitor is. The address is kept in the fragment (`#/level/stampede`), so the app works
// from any folder on a static host, and nothing about it is ever sent to a server. That matters
// most for a shared design, which is the whole of the address after `#/d/`.

export type Route =
  | { page: 'home' }
  | { page: 'sandbox' }
  | { page: 'level'; id: string }
  /** The guide: its front page, or with an id, the lesson on that level. */
  | { page: 'guide'; id: string | null }
  /** A design carried in the link itself. `payload` is untrusted until it has been decoded. */
  | { page: 'shared'; payload: string };

export const HOME: Route = { page: 'home' };

/** The route a fragment names. Anything unrecognised is the home page. */
export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts.length === 1 && parts[0] === 'sandbox') return { page: 'sandbox' };
  if (parts.length === 1 && parts[0] === 'guide') return { page: 'guide', id: null };
  if (parts.length === 2 && (parts[0] === 'level' || parts[0] === 'guide' || parts[0] === 'd')) {
    let value: string;
    try {
      value = decodeURIComponent(parts[1]!);
    } catch {
      return HOME;
    }
    if (parts[0] === 'guide') return { page: 'guide', id: value };
    return parts[0] === 'level' ? { page: 'level', id: value } : { page: 'shared', payload: value };
  }
  return HOME;
}

/** The link to a route, for an `href`. */
export function hrefOf(route: Route): string {
  switch (route.page) {
    case 'home':
      return '#/';
    case 'sandbox':
      return '#/sandbox';
    case 'level':
      return `#/level/${encodeURIComponent(route.id)}`;
    case 'guide':
      return route.id === null ? '#/guide' : `#/guide/${encodeURIComponent(route.id)}`;
    case 'shared':
      return `#/d/${encodeURIComponent(route.payload)}`;
  }
}

export function sameRoute(a: Route, b: Route): boolean {
  return hrefOf(a) === hrefOf(b);
}
