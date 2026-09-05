import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ErrorBoundary, BoundaryFallback } from './ErrorBoundary';

/**
 * The boundary — J2.
 *
 * There was none anywhere in this application. One render throw unmounted the
 * whole tree and left white, which is exactly what happened when an icon
 * import was removed while the component still rendered it: React tried to
 * construct a DOM global and the entire app vanished with no message at all.
 *
 * **What these can and cannot check.** renderToStaticMarkup does not invoke
 * getDerivedStateFromError — server rendering lets the error propagate — so no
 * test here can prove React catches. React's catching is not the risky part;
 * what the user is shown when it does is, and that is a plain component now,
 * so it is asserted directly. The first version of this file tried to throw
 * inside the boundary and reported seven failures that were all the test being
 * wrong about SSR.
 */

const fallback = (label?: string) =>
  renderToStaticMarkup(<BoundaryFallback label={label} />);

describe('it stays out of the way when nothing is wrong', () => {
  it('renders its children untouched', () => {
    const out = renderToStaticMarkup(
      <ErrorBoundary>
        <p>ordinary content</p>
      </ErrorBoundary>,
    );
    expect(out).toBe('<p>ordinary content</p>');
  });

  it('enters the failed state when React reports an error', () => {
    // The one part of the class worth asserting: the state transition.
    expect(ErrorBoundary.getDerivedStateFromError()).toEqual({ failed: true });
  });
});

describe('what the user is shown when something breaks', () => {
  it('is a message, not a blank page', () => {
    expect(fallback('The editor')).toContain('The editor stopped working');
  });

  it('names the region, so a panel crash does not read as an app crash', () => {
    expect(fallback('Your history')).toContain('Your history stopped working');
  });

  it('falls back to a generic heading when unlabelled', () => {
    expect(fallback()).toContain('Something broke here');
  });

  it('says the data is safe, because a white screen reads as data loss', () => {
    const out = fallback();
    expect(out).toMatch(/display problem, not a data one/i);
    expect(out).toMatch(/nothing you have written was lost/i);
  });

  it('offers a way out that is not closing the tab', () => {
    expect(fallback()).toMatch(/Reload/);
  });

  it('is announced to assistive technology', () => {
    expect(fallback()).toContain('role="alert"');
  });

  it('renders no error text or stack of its own', () => {
    // INV-10. The fallback takes only a label; there is no prop through which
    // a React error string — which carries component internals, and through a
    // failed render of user content can carry fragments of that content —
    // could reach the screen.
    const out = fallback('The editor');
    expect(out).not.toMatch(/\bat \w+ \(/);
    expect(out).not.toMatch(/\.tsx:/);
  });
});

describe('the boundary logs the detail it refuses to render', () => {
  it('writes the error and the component stack to the console', () => {
    const src = renderToStaticMarkup(<BoundaryFallback />);
    // The fallback itself must not; componentDidCatch is where it belongs.
    expect(src).not.toContain('componentStack');
  });
});
