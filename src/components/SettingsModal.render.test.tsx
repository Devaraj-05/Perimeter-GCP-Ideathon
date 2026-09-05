import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SettingsModal } from './SettingsModal';

/**
 * Settings — Amendment N.
 *
 * The privacy section is a set of claims about this system. These assert the
 * claims are actually present and, more importantly, that the uncomfortable
 * ones have not quietly been softened: a privacy notice that only lists
 * reassurances is marketing.
 */
const html = () =>
  renderToStaticMarkup(<SettingsModal isOpen onClose={() => {}} onDeleted={() => {}} />);

describe('it renders nothing when closed', () => {
  it('returns empty markup', () => {
    expect(
      renderToStaticMarkup(<SettingsModal isOpen={false} onClose={() => {}} onDeleted={() => {}} />),
    ).toBe('');
  });
});

describe('the privacy statement says the uncomfortable parts', () => {
  it('admits document text is sent to Google', () => {
    // The single fact a user is most entitled to know and least likely to
    // guess. It was in the README and nowhere the user would see it.
    expect(html()).toMatch(/sent to Google/i);
  });

  it('states the retention policy honestly: entries kept, sources age out', () => {
    // Amendment O. The guarantee — a timer never removes the user's own
    // writing — is true regardless of the configured window, and that is what
    // the statement promises.
    const out = html();
    expect(out).toMatch(/kept until you delete them/i);
    expect(out).toMatch(/age out/i);
  });

  it('explains why tokens are excluded from the user’s own export', () => {
    expect(html()).toMatch(/excluded even from your own export/i);
    expect(html()).toMatch(/still be live/i);
  });

  it('states that identity is checked server-side, not from the page', () => {
    expect(html()).toMatch(/verified token/i);
  });
});

describe('deletion is guarded and honest about what it does', () => {
  it('requires the typed word', () => {
    expect(html()).toMatch(/Type DELETE to confirm/);
  });

  it('the delete button starts disabled', () => {
    // The confirmation is empty on open, so the irreversible control must not
    // be pressable yet.
    const out = html();
    // The <button> element that contains the label, not a window of bytes
    // near it — the first attempt sliced backwards and landed inside an SVG.
    const label = out.indexOf('Delete my account permanently');
    const openTag = out.lastIndexOf('<button', label);
    const tag = out.slice(openTag, out.indexOf('>', openTag) + 1);
    expect(tag).toContain('disabled');
  });

  it('says it revokes third-party connections, not just local data', () => {
    expect(html()).toMatch(/revokes your Gmail and GitHub connections/i);
  });

  it('says it cannot be undone and there is no backup', () => {
    expect(html()).toMatch(/cannot be undone/i);
    expect(html()).toMatch(/no backup/i);
  });

  it('tells the user to export first', () => {
    expect(html()).toMatch(/Export first/i);
  });
});

describe('export describes what it does and does not contain', () => {
  it('names what is included', () => {
    const out = html();
    for (const part of ['entries', 'audit log', 'permissions']) {
      expect(out, part).toMatch(new RegExp(part, 'i'));
    }
  });

  it('names what is excluded', () => {
    expect(html()).toMatch(/tokens are deliberately\s*\n?\s*excluded|deliberately excluded/i);
  });
});
