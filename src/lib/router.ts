import { useCallback, useSyncExternalStore } from 'react';

/**
 * A router, sized to what this application actually has.
 *
 * Five flat paths, no parameters, no nesting, no lazy boundaries. `react-router`
 * would be a dependency carrying a matcher, a data layer and an outlet system
 * for a problem that is `switch (path)`.
 *
 * The server side already works: `server.ts` serves `index.html` for any
 * non-`/api` path in both dev (`appType: 'spa'`) and production, so a deep link
 * or a refresh on `/insights` reaches this file rather than a 404.
 *
 * What this deliberately does NOT do is decide who may see a path. Route
 * *identity* is here; route *permission* is in App.tsx, where the auth state
 * lives. A router that reads auth is a router that can be wrong about it.
 */

export const ROUTES = ['/', '/insights', '/activity', '/settings', '/security'] as const;
export type Route = (typeof ROUTES)[number];

/**
 * Paths reachable without signing in.
 *
 * `/security` is public because the security explainer is part of the pitch —
 * it was already rendered on the signed-out landing page as a modal, and a page
 * that a judge cannot open without an account is a page that does not do its
 * job. Everything else reads or writes a specific person's data.
 */
export const PUBLIC_ROUTES: readonly Route[] = ['/', '/security'];

export function isRoute(value: string): value is Route {
  return (ROUTES as readonly string[]).includes(value);
}

export function isPublicRoute(route: Route): boolean {
  return PUBLIC_ROUTES.includes(route);
}

/**
 * A URL path reduced to one of our five routes.
 *
 * Unknown paths resolve to `/` rather than rendering a not-found screen: this
 * app has no user-generated URLs, so an unknown path is a typo or a stale link,
 * and the workspace is a better answer than an error.
 */
export function normalisePath(raw: string): Route {
  if (typeof raw !== 'string' || !raw) return '/';

  // Query and hash are not part of route identity. The landing page uses hash
  // anchors (#how-it-works) heavily, and those must not be read as routes.
  let path = raw.split('?')[0]!.split('#')[0]!;
  if (!path.startsWith('/')) path = `/${path}`;
  // A trailing slash is the same place. "/insights/" must not fall through to
  // the workspace.
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);

  return isRoute(path) ? path : '/';
}

/**
 * Fired after a programmatic navigation.
 *
 * `history.pushState` deliberately does not emit `popstate` — only the back and
 * forward buttons do. Without our own event, clicking a link would change the
 * URL and render nothing.
 */
const NAVIGATE_EVENT = 'perimeter:navigate';

const subscribe = (onChange: () => void): (() => void) => {
  window.addEventListener('popstate', onChange);
  window.addEventListener(NAVIGATE_EVENT, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(NAVIGATE_EVENT, onChange);
  };
};

const getSnapshot = (): Route => normalisePath(window.location.pathname);

/** Server render and any non-DOM environment start at the workspace. */
const getServerSnapshot = (): Route => '/';

/** Goes to a path, adding a history entry. */
export function navigate(to: Route): void {
  if (normalisePath(window.location.pathname) === to) return;
  window.history.pushState(null, '', to);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
  // A new page starts at the top. Without this, opening Settings from halfway
  // down a long conversation lands halfway down Settings.
  window.scrollTo(0, 0);
}

/**
 * Rewrites the URL without adding a history entry.
 *
 * Used when a path is not available to this visitor — a signed-out deep link to
 * `/insights` shows the landing page, and the URL has to stop claiming
 * otherwise. `pushState` here would trap the back button: pressing back would
 * return to the path we just refused.
 */
export function replacePath(to: Route): void {
  if (normalisePath(window.location.pathname) === to) return;
  window.history.replaceState(null, '', to);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}

/** The current route, re-rendering the caller when it changes. */
export function useRoute(): Route {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** A stable `navigate`, so it can sit in a dependency array. */
export function useNavigate(): (to: Route) => void {
  return useCallback((to: Route) => navigate(to), []);
}
