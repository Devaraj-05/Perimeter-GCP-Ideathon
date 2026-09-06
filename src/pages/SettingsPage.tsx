import React, { useState } from 'react';
import { Download, Trash2, ShieldCheck, AlertTriangle, Loader2, FileJson, KeyRound } from 'lucide-react';
import { downloadAccountExport, deleteAccount } from '../lib/accountApi';
import { PageShell, Band } from './PageShell';

/**
 * Settings — Amendment N.
 *
 * Three things live here, and the third is the reason the screen exists: this
 * application ingests people's email, their web reading, their repositories
 * and their private journal, and until now there was no way to take any of it
 * back or to leave. Holding that with no exit is a position, and not one this
 * project would have defended if it had been written down.
 *
 * The privacy section is plain statement, not reassurance. Every line is
 * something a reader could check against the code, because a privacy notice
 * that cannot be verified is marketing.
 *
 * It was a dialog until now. A page that tells someone what is held about them,
 * and offers the only irreversible action in the product, should not be
 * something you dismiss by clicking beside it.
 */

const FACTS = [
  'Your entries, sources and audit log are stored in Firestore under your user ID. Security rules deny every other account read and write access, and the server checks your identity from a verified token on every request — never from anything a page or a model supplied.',
  'Documents you attach — emails, web pages, PDFs, images — are sent to Google’s Gemini API to be read. That is how the product works, and it means the text leaves this server. It is not used to train models.',
  'Connected Gmail and GitHub tokens are encrypted before storage and never leave the server. They are excluded even from your own export, because an export is a file and the token inside one would still be live.',
  'Nothing you write is shared with other users. There is no sharing feature, so there is no setting to get wrong.',
  'Your journal entries are kept until you delete them — a timer never removes your own writing. Ingested sources (emails, pages, PDFs, scanned repositories) age out on this deployment’s retention window, or are kept indefinitely if none is set. Either way, deleting your account removes everything.',
];

export const SettingsPage: React.FC<{ onDeleted: () => void }> = ({ onDeleted }) => {
  const [busy, setBusy] = useState<null | 'export' | 'delete'>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState('');

  const runExport = async () => {
    setBusy('export');
    setError(null);
    setNotice(null);
    try {
      await downloadAccountExport();
      setNotice('Your archive has been downloaded.');
    } catch (err: any) {
      setError(err?.message ?? 'Could not build your export.');
    } finally {
      setBusy(null);
    }
  };

  const runDelete = async () => {
    setBusy('delete');
    setError(null);
    try {
      const result = await deleteAccount();
      // Reported honestly. If the sign-in record survived, the user can still
      // sign in to an empty workspace and should be told rather than discover
      // it (INV-23).
      if (!result.authUserDeleted) {
        setError(
          'Your data was deleted, but the sign-in record could not be removed. You can still sign in; the workspace will be empty. Please try again or contact support.',
        );
        setBusy(null);
        return;
      }
      onDeleted();
    } catch (err: any) {
      setError(err?.message ?? 'Deletion did not complete.');
      setBusy(null);
    }
  };

  return (
    <PageShell
      title="Settings"
      subtitle="Your data, and what happens to it."
      width="prose"
    >
      <Band
        title="What this app holds"
        hint="Stated plainly, and every line is checkable against the source. A privacy notice you cannot verify is marketing."
      >
        <ul className="divide-y divide-[#f0f0f0] border-y border-[#e5e5e5]">
          {FACTS.map((fact) => (
            <li key={fact.slice(0, 24)} className="flex gap-3 py-4">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#1a1a1a]" />
              <p className="text-sm leading-relaxed text-[#525252]">{fact}</p>
            </li>
          ))}
        </ul>
      </Band>

      <Band title="Download your data">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-md">
            <p className="flex items-center gap-2 text-sm font-semibold text-[#1a1a1a]">
              <FileJson className="h-4 w-4" />
              Everything, as one JSON file
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-[#525252]">
              Entries, ingested sources, tool calls, permissions and the full audit log.
              Connected-account tokens are deliberately excluded.
            </p>
          </div>
          <button
            onClick={() => void runExport()}
            disabled={busy !== null}
            className="inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-[#e5e5e5] px-4 py-2.5 text-xs font-medium text-[#1a1a1a] transition-colors hover:bg-[#f7f7f8] disabled:opacity-50"
          >
            {busy === 'export' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            {busy === 'export' ? 'Preparing…' : 'Export everything'}
          </button>
        </div>
      </Band>

      <Band title="Connected accounts">
        {/* The icon and the prose are siblings in a flex row; the prose itself
            is one block. Making the <p> the flex container turned the inline
            "+" into a flex ITEM, which broke the sentence into three columns. */}
        <div className="flex items-start gap-2.5">
          <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-[#1a1a1a]" />
          <p className="text-sm leading-relaxed text-[#525252]">
            Gmail and GitHub connections are managed from the composer’s{' '}
            <span className="font-medium text-[#1a1a1a]">+</span> menu, where the toggle that
            connects them is also the one that disconnects them. Deleting your account below revokes
            both at the provider.
          </p>
        </div>
      </Band>

      {/* Deletion. The only irreversible action in the product, and the only
          one that gets a typed confirmation (§10 reserves those for exactly
          this). */}
      <section className="mt-14">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-rose-700">
          Delete your account
        </h2>
        <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50/50 p-5 sm:p-6">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-rose-700" />
            <h3 className="text-sm font-semibold text-rose-900">This cannot be undone</h3>
          </div>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-rose-900/80">
            Removes every entry, source, permission and log entry, revokes your Gmail and GitHub
            connections at those providers, and deletes your sign-in. There is no backup. Export
            first if you want a copy.
          </p>

          <label className="mt-5 block max-w-xs text-[11px] font-medium text-rose-900">
            Type DELETE to confirm
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE"
              className="mt-1.5 w-full rounded-lg border border-rose-300 bg-white px-3 py-2 text-xs text-[#1a1a1a] placeholder:text-rose-300 focus:border-rose-500 focus:outline-hidden"
            />
          </label>

          <button
            onClick={() => void runDelete()}
            disabled={confirmText !== 'DELETE' || busy !== null}
            className="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-lg bg-rose-600 px-4 py-2.5 text-xs font-medium text-white transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:bg-rose-200"
          >
            {busy === 'delete' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
            {busy === 'delete' ? 'Deleting…' : 'Delete my account permanently'}
          </button>
        </div>
      </section>

      {error && (
        <p role="alert" className="mt-6 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="mt-6 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
          {notice}
        </p>
      )}
    </PageShell>
  );
};
