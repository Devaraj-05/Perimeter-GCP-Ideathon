import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SecurityPage } from './SecurityPage';
import { isPublicRoute } from '../lib/router';

/**
 * The security explainer is the page a reviewer reads before they trust
 * anything else. These assert it states the property the product actually
 * rests on, rather than a list of comforting nouns.
 */
const html = () => renderToStaticMarkup(<SecurityPage />);

describe('it states the airlock, not just that it is secure', () => {
  it('says the reader holds no tools', () => {
    // This is the whole architecture in one sentence. If it stops being said,
    // the page has become marketing.
    expect(html()).toMatch(/no tools/i);
  });

  it('names the separation between reading and acting', () => {
    const out = html();
    expect(out).toMatch(/Reader/i);
    expect(out).toMatch(/Planner/i);
    expect(out).toMatch(/never sees the document|Never the document/i);
  });

  it('says a tainted turn cannot write', () => {
    expect(html()).toMatch(/tainted turn cannot write/i);
  });

  it('says the boundary defaults to deny', () => {
    expect(html()).toMatch(/[Dd]efault deny|denied until you say otherwise/);
  });

  it('says the log is tamper-evident and how', () => {
    const out = html();
    expect(out).toMatch(/hash-chained/i);
    expect(out).toMatch(/breaks the chain/i);
  });
});

describe('it states the credential and data boundaries', () => {
  it('shows the owner-bound rule itself, not a description of one', () => {
    expect(html()).toContain('request.auth.uid == userId');
  });

  it('says keys never reach the browser', () => {
    expect(html()).toMatch(/Neither is ever sent to the browser/i);
  });

  it('says connection tokens are encrypted and excluded from exports', () => {
    const out = html();
    expect(out).toMatch(/AES-256-GCM/);
    expect(out).toMatch(/excluded even from your own data export/i);
  });

  it('does not claim passwords are stored safely — it claims they are not held', () => {
    expect(html()).toMatch(/never has|no password/i);
  });
});

describe('it claims structure, not model behaviour', () => {
  it('says outright that nothing here is a promise about a model', () => {
    // The distinction the whole project rests on: a model can be argued out of
    // an instruction; it cannot be argued into holding a tool it never had.
    expect(html()).toMatch(/Nothing on this page is a promise about a model/i);
  });

  it('names the fallback ladder rather than a single model string', () => {
    expect(html()).toMatch(/gemini-3\.6-flash/);
    expect(html()).toMatch(/gemini-3\.7-flash/);
  });
});

describe('it is a public page', () => {
  it('is routable without signing in', () => {
    // It was a modal on the signed-out landing page before this change. A
    // reviewer must not need an account to read the security argument.
    expect(isPublicRoute('/security')).toBe(true);
  });

  it('renders with no props and no data', () => {
    // Static by construction: no fetch, no auth, nothing to fail.
    expect(html().length).toBeGreaterThan(500);
  });

  it('does not paint a dialog backdrop', () => {
    expect(html()).not.toContain('fixed inset-0');
  });
});
