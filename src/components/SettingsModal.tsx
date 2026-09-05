import React, { useState } from 'react';
import { X, Download, Trash2, ShieldCheck, AlertTriangle, Loader2 } from 'lucide-react';
import { downloadAccountExport, deleteAccount } from '../lib/accountApi';

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
 */

const FACTS = [
  'Your entries, sources and audit log are stored in Firestore under your user ID. Security rules deny every other account read and write access, and the server checks your identity from a verified token on every request — never from anything a page or a model supplied.',
  'Documents you attach — emails, web pages, PDFs, images — are sent to Google’s Gemini API to be read. That is how the product works, and it means the text leaves this server. It is not used to train models.',
  'Connected Gmail and GitHub tokens are encrypted before storage and never leave the server. They are excluded even from your own export, because an export is a file and the token inside one would still be live.',
  'Nothing you write is shared with other users. There is no sharing feature, so there is no setting to get wrong.',
  'There is no retention limit yet. Everything you have ever ingested is still here until you delete it, and saying otherwise would be untrue.',
];

export const SettingsModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onDeleted: () => void;
}> = ({ isOpen, onClose, onDeleted }) => {
  const [busy, setBusy] = useState<null | 'export' | 'delete'>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState('');

  if (!isOpen) return null;

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
    <div className="anim-backdrop fixed inset-0 z-50 flex items-center justify-center bg-[#1a1a1a]/50 p-4 backdrop-blur-xs">
      <div className="anim-panel relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[#e5e5e5] bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between border-b border-[#e5e5e5] pb-4">
          <div>
            <h2 className="font-serif text-lg font-semibold text-[#1a1a1a]">Settings</h2>
            <p className="mt-0.5 text-xs text-[#6b6b6b]">
              Your data, and what happens to it
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer rounded-lg p-1.5 text-[#6b6b6b] hover:bg-[#f7f7f8] hover:text-[#1a1a1a]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* What is true, stated plainly. */}
        <section className="mt-5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[#1a1a1a]" />
            <h3 className="text-sm font-semibold text-[#1a1a1a]">What this app holds</h3>
          </div>
          <ul className="mt-3 space-y-2.5">
            {FACTS.map((fact) => (
              <li
                key={fact.slice(0, 24)}
                className="border-l-2 border-[#e5e5e5] pl-3 text-xs leading-relaxed text-[#525252]"
              >
                {fact}
              </li>
            ))}
          </ul>
        </section>

        {/* Export */}
        <section className="mt-6 rounded-xl border border-[#e5e5e5] p-4">
          <h3 className="text-sm font-semibold text-[#1a1a1a]">Download your data</h3>
          <p className="mt-1 text-xs leading-relaxed text-[#525252]">
            Everything this app holds for you, as one JSON file: entries, ingested sources, tool
            calls, permissions and the full audit log. Connected-account tokens are deliberately
            excluded.
          </p>
          <button
            onClick={() => void runExport()}
            disabled={busy !== null}
            className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[#e5e5e5] px-3 py-2 text-xs font-medium text-[#1a1a1a] transition-colors hover:bg-[#f7f7f8] disabled:opacity-50"
          >
            {busy === 'export' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            {busy === 'export' ? 'Preparing…' : 'Export everything'}
          </button>
        </section>

        {/* Deletion. The only irreversible action in the product, and the only
            one that gets a typed confirmation (§10 reserves those for exactly
            this). */}
        <section className="mt-4 rounded-xl border border-rose-200 bg-rose-50/50 p-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-rose-700" />
            <h3 className="text-sm font-semibold text-rose-900">Delete your account</h3>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-rose-900/80">
            Removes every entry, source, permission and log entry, revokes your Gmail and GitHub
            connections at those providers, and deletes your sign-in. This cannot be undone and
            there is no backup. Export first if you want a copy.
          </p>

          <label className="mt-3 block text-[11px] font-medium text-rose-900">
            Type DELETE to confirm
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE"
              className="mt-1 w-full rounded-lg border border-rose-300 bg-white px-3 py-2 text-xs text-[#1a1a1a] placeholder:text-rose-300 focus:border-rose-500 focus:outline-hidden"
            />
          </label>

          <button
            onClick={() => void runDelete()}
            disabled={confirmText !== 'DELETE' || busy !== null}
            className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-lg bg-rose-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:bg-rose-200"
          >
            {busy === 'delete' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
            {busy === 'delete' ? 'Deleting…' : 'Delete my account permanently'}
          </button>
        </section>

        {error && (
          <p role="alert" className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800">
            {error}
          </p>
        )}
        {notice && (
          <p
            role="status"
            className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800"
          >
            {notice}
          </p>
        )}
      </div>
    </div>
  );
};
