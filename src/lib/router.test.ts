import { describe, it, expect } from 'vitest';
import { normalisePath, isRoute, isPublicRoute, ROUTES, PUBLIC_ROUTES } from './router';

/**
 * The router is five flat paths. These pin the two things that would actually
 * hurt: a path resolving to the wrong screen, and the public/private split
 * drifting so a signed-out visitor reaches someone's journal statistics.
 */

describe('normalisePath', () => {
  it('passes the known routes through unchanged', () => {
    for (const route of ROUTES) {
      expect(normalisePath(route)).toBe(route);
    }
  });

  it('treats a trailing slash as the same place', () => {
    // Without this, "/insights/" fell through to the workspace — a link with a
    // stray slash silently showed the wrong screen.
    expect(normalisePath('/insights/')).toBe('/insights');
    expect(normalisePath('/settings/')).toBe('/settings');
    expect(normalisePath('/')).toBe('/');
  });

  it('ignores query strings and hashes', () => {
    // The landing page navigates by hash anchors. If a hash were read as part
    // of the route, clicking "How it works" would leave the page.
    expect(normalisePath('/security?ref=demo')).toBe('/security');
    expect(normalisePath('/#how-it-works')).toBe('/');
    expect(normalisePath('/?utm_source=x#invariants')).toBe('/');
  });

  it('sends an unknown path to the workspace rather than a 404', () => {
    // There are no user-generated URLs here, so an unknown path is a typo or a
    // stale link. The workspace is a better answer than an error screen.
    expect(normalisePath('/nope')).toBe('/');
    expect(normalisePath('/insights/deep/nested')).toBe('/');
    expect(normalisePath('/api/agent/chat')).toBe('/');
  });

  it('is total — never throws, whatever it is handed', () => {
    for (const bad of ['', undefined, null, 42, {}, []] as unknown[]) {
      expect(() => normalisePath(bad as string)).not.toThrow();
      expect(normalisePath(bad as string)).toBe('/');
    }
  });

  it('tolerates a path with no leading slash', () => {
    expect(normalisePath('insights')).toBe('/insights');
  });
});

describe('isRoute', () => {
  it('accepts exactly the five routes and nothing else', () => {
    expect(ROUTES).toHaveLength(5);
    for (const route of ROUTES) expect(isRoute(route)).toBe(true);
    for (const other of ['/insight', '/Activity', '/settings/', '', '/api']) {
      expect(isRoute(other)).toBe(false);
    }
  });

  it('is case sensitive', () => {
    // Paths are not case-insensitive on the server either; accepting "/Insights"
    // here would render a screen at a URL that a refresh would not reproduce.
    expect(isRoute('/Insights')).toBe(false);
  });
});

describe('the public/private split', () => {
  it('only the landing page and the security explainer are public', () => {
    expect([...PUBLIC_ROUTES].sort()).toEqual(['/', '/security']);
  });

  it('every route that reads a person’s data requires signing in', () => {
    // This is the assertion that matters. If someone adds a route and forgets
    // the gate, this fails rather than shipping an open page.
    for (const route of ['/insights', '/activity', '/settings'] as const) {
      expect(isPublicRoute(route)).toBe(false);
    }
  });

  it('the security page stays reachable signed out', () => {
    // It was a modal on the signed-out landing page before this change, and it
    // is part of the pitch. A judge must not need an account to read it.
    expect(isPublicRoute('/security')).toBe(true);
  });

  it('every public route is a real route', () => {
    for (const route of PUBLIC_ROUTES) expect(isRoute(route)).toBe(true);
  });
});
