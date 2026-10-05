// Where the visitor is. The address is kept in the fragment (`#/level/stampede`), so the app works
// from any folder on a static host, and nothing about it is ever sent to a server.

export type Route = { page: 'home' } | { page: 'sandbox' } | { page: 'level'; id: string };

export const HOME: Route = { page: 'home' };

/** The route a fragment names. Anything unrecognised is the home page. */
export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts.length === 1 && parts[0] === 'sandbox') return { page: 'sandbox' };
  if (parts.length === 2 && parts[0] === 'level') {
    try {
      return { page: 'level', id: decodeURIComponent(parts[1]!) };
    } catch {
      return HOME;
    }
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
  }
}

export function sameRoute(a: Route, b: Route): boolean {
  return hrefOf(a) === hrefOf(b);
}
